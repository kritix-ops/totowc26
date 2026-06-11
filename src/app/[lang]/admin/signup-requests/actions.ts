"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { signupRequests, profiles } from "@/db/schema";
import { isAdmin } from "@/lib/admin";
import { buildAuthConfirmUrl, getUser } from "@/lib/supabase/auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email/client";
import { getEmailCopy, interpolate } from "@/lib/email/copy";
import { UserApprovalEmail } from "@/lib/email/templates/UserApprovalEmail";

type Ok = { ok: true };
type Err = { ok: false; error: string };
type Result = Ok | Err;

async function assertAdmin(): Promise<{ adminId: string } | Err> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauthorized" };
  if (!(await isAdmin(user.id))) return { ok: false, error: "forbidden" };
  return { adminId: user.id };
}

// Approve a pending signup request:
//   1) Load row, verify status='pending'.
//   2) Create the Supabase auth user (email_confirmed) with metadata that
//      the on_auth_user_created trigger uses to seed the profile row.
//   3) Belt-and-suspenders upsert into profiles in case the trigger races.
//   4) Generate a recovery link so the registrant can set their password.
//   5) Update the signup_requests row to approved + audit fields.
//   6) Email the registrant with the recovery link. Best-effort - failure
//      is logged but does not roll back the approval (the admin can
//      always re-send via the existing resendMagicLink action).
export async function approveSignupRequest(
  requestId: string,
): Promise<Result> {
  const guard = await assertAdmin();
  if ("ok" in guard && guard.ok === false) return guard;
  const adminId = (guard as { adminId: string }).adminId;

  const [row] = await db
    .select()
    .from(signupRequests)
    .where(eq(signupRequests.id, requestId))
    .limit(1);
  if (!row) return { ok: false, error: "not_found" };
  if (row.status !== "pending") return { ok: false, error: "already_decided" };

  const admin = getSupabaseAdmin();

  // 2) Create the auth user. If one already exists (e.g. the registrant
  //    tried Google sign-in before approval and the callback cleanup
  //    did not run) we adopt it instead of failing: set the metadata
  //    fields the on_auth_user_created trigger uses, then continue.
  let userId: string;
  const created = await admin.auth.admin.createUser({
    email: row.email,
    email_confirm: true,
    user_metadata: { display_name: row.displayName, phone: row.phone },
  });
  if (created.error) {
    const msg = created.error.message.toLowerCase();
    if (!(msg.includes("already") || msg.includes("exists"))) {
      console.error("[signup approve] createUser failed:", created.error);
      return { ok: false, error: created.error.message };
    }

    const existing = await findAuthUserByEmail(row.email);
    if (!existing) {
      console.error("[signup approve] createUser said exists but lookup failed", {
        email: row.email,
      });
      return { ok: false, error: "create_failed" };
    }
    userId = existing.id;
    const { error: updErr } = await admin.auth.admin.updateUserById(userId, {
      email_confirm: true,
      user_metadata: { display_name: row.displayName, phone: row.phone },
    });
    if (updErr) {
      console.error("[signup approve] updateUserById on existing failed:", updErr);
    }
    console.info("[signup approve] adopted existing auth user", {
      requestId,
      userId,
    });
  } else {
    const newId = created.data.user?.id;
    if (!newId) return { ok: false, error: "create_failed" };
    userId = newId;
  }

  // 3) Safety-net profile upsert.
  await db
    .insert(profiles)
    .values({ id: userId, displayName: row.displayName, phone: row.phone })
    .onConflictDoUpdate({
      target: profiles.id,
      set: { displayName: row.displayName, phone: row.phone },
    });

  // 4) Recovery link so the registrant can set a password on first visit.
  const h = await headers();
  const origin =
    h.get("origin") ??
    (h.get("host") ? `https://${h.get("host")}` : "http://localhost:3000");
  const link = await admin.auth.admin.generateLink({
    type: "recovery",
    email: row.email,
  });
  if (link.error) {
    console.error("[signup approve] generateLink failed:", link.error);
    return { ok: false, error: link.error.message };
  }
  const hashedToken = link.data.properties?.hashed_token;
  if (!hashedToken) return { ok: false, error: "no_link" };
  const recoveryUrl = buildAuthConfirmUrl({
    origin,
    hashedToken,
    type: "recovery",
    next: "/he/set-password",
  });

  // 5) Update the request row.
  await db
    .update(signupRequests)
    .set({
      status: "approved",
      decidedAt: new Date(),
      decidedBy: adminId,
      createdUserId: userId,
    })
    .where(eq(signupRequests.id, requestId));
  console.info("[signup approved]", { requestId, userId, by: adminId });

  // 6) Approval email.
  const emails = await getEmailCopy("he");
  const approvalCopy = emails.userApproval;
  const r = await sendEmail({
    to: row.email,
    subject: approvalCopy.preview,
    react: UserApprovalEmail({
      preview: approvalCopy.preview,
      heading: interpolate(approvalCopy.heading, {
        displayName: row.displayName,
      }),
      body: approvalCopy.body,
      buttonText: approvalCopy.buttonText,
      fallbackHint: approvalCopy.fallbackHint,
      footer: approvalCopy.footer,
      recoveryUrl,
    }),
  });
  console.info("[signup email] user_approval", {
    requestId,
    ok: r.ok,
    messageId: r.ok ? r.messageId : null,
  });

  // Signup-requests panel and users panel are the only admin surfaces
  // that show this row. Narrowed from `revalidatePath("/", "layout")`
  // so the approve/reject buttons release the moment the row is in
  // the DB instead of waiting on the whole shell to re-render.
  revalidatePath("/[lang]/admin", "page");
  return { ok: true };
}

// Look up an auth.users row by email. The admin API has no direct
// filter so we page through listUsers - cheap because a friends pool
// never has more than a couple hundred accounts.
async function findAuthUserByEmail(
  email: string,
): Promise<{ id: string } | null> {
  const admin = getSupabaseAdmin();
  const target = email.toLowerCase();
  const { data, error } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (error) {
    console.error("[signup approve] listUsers failed:", error);
    return null;
  }
  const hit = data.users.find((u) => u.email?.toLowerCase() === target);
  return hit ? { id: hit.id } : null;
}

export async function rejectSignupRequest(
  requestId: string,
  note?: string,
): Promise<Result> {
  const guard = await assertAdmin();
  if ("ok" in guard && guard.ok === false) return guard;
  const adminId = (guard as { adminId: string }).adminId;

  const [row] = await db
    .select({ status: signupRequests.status })
    .from(signupRequests)
    .where(eq(signupRequests.id, requestId))
    .limit(1);
  if (!row) return { ok: false, error: "not_found" };
  if (row.status !== "pending") return { ok: false, error: "already_decided" };

  await db
    .update(signupRequests)
    .set({
      status: "rejected",
      decidedAt: new Date(),
      decidedBy: adminId,
      note: note?.trim() || null,
    })
    .where(eq(signupRequests.id, requestId));

  console.info("[signup rejected]", { requestId, by: adminId, note: note ?? null });
  // Signup-requests panel and users panel are the only admin surfaces
  // that show this row. Narrowed from `revalidatePath("/", "layout")`
  // so the approve/reject buttons release the moment the row is in
  // the DB instead of waiting on the whole shell to re-render.
  revalidatePath("/[lang]/admin", "page");
  return { ok: true };
}
