"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { signupRequests, profiles } from "@/db/schema";
import { getUser } from "@/lib/supabase/auth";
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
  const [me] = await db
    .select({ role: profiles.role })
    .from(profiles)
    .where(eq(profiles.id, user.id))
    .limit(1);
  if (!me || me.role !== "admin") return { ok: false, error: "forbidden" };
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

  // 2) Create the auth user.
  const created = await admin.auth.admin.createUser({
    email: row.email,
    email_confirm: true,
    user_metadata: { display_name: row.displayName, phone: row.phone },
  });
  if (created.error) {
    const msg = created.error.message.toLowerCase();
    if (msg.includes("already") || msg.includes("exists")) {
      return { ok: false, error: "email_taken" };
    }
    console.error("[signup approve] createUser failed:", created.error);
    return { ok: false, error: created.error.message };
  }
  const userId = created.data.user?.id;
  if (!userId) return { ok: false, error: "create_failed" };

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
    options: {
      redirectTo: `${origin}/auth/callback?next=/he/set-password`,
    },
  });
  if (link.error) {
    console.error("[signup approve] generateLink failed:", link.error);
    return { ok: false, error: link.error.message };
  }
  const recoveryUrl = link.data.properties?.action_link;
  if (!recoveryUrl) return { ok: false, error: "no_link" };

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

  revalidatePath("/", "layout");
  return { ok: true };
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
  revalidatePath("/", "layout");
  return { ok: true };
}
