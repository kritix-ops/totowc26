"use server";

import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { signupRequests, settings } from "@/db/schema";
import { allow } from "@/lib/rate-limit";
import { sendEmail } from "@/lib/email/client";
import { getEmailCopy, interpolate } from "@/lib/email/copy";
import { AdminSignupNotification } from "@/lib/email/templates/AdminSignupNotification";
import { UserSignupConfirmation } from "@/lib/email/templates/UserSignupConfirmation";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export type SignupErrorCode =
  | "invalid"
  | "duplicate"
  | "rate_limited"
  | "closed"
  | "unknown";

export type SignupResult = { ok: true } | { ok: false; error: SignupErrorCode };

// Public self-service signup. The flow:
//   1) Honeypot - bots typically fill every field; humans skip the hidden
//      one. If "website" is non-empty we silently succeed without writing
//      a row so the bot has nothing to retry.
//   2) Rate limit - 10 attempts per hour per IP. Stops a single source
//      from flooding the admin queue.
//   3) Validate - name >= 2, phone >= 7, email contains "@". Mirrors the
//      invitePlayer admin action validation exactly.
//   4) Settings gate - if publicSignupOpen is false, refuse politely.
//   5) Duplicate guard - refuse if the email is already a Supabase auth
//      user (already a member) OR is already pending. Error code stays
//      generic ("duplicate") to avoid leaking account enumeration.
//   6) Insert + fire admin notification + fire registrant confirmation.
//      Email failures are logged but do not fail the request - the row
//      is the source of truth and the admin can still see and act on it.
export async function submitSignupRequest(
  formData: FormData,
): Promise<SignupResult> {
  // 1) Honeypot. Pretend success - do not give the bot a signal.
  const honey = String(formData.get("website") ?? "").trim();
  if (honey.length > 0) {
    console.info("[signup honeypot tripped]", { length: honey.length });
    return { ok: true };
  }

  // 2) Rate limit by IP. headers() reads the request-bound headers in a
  // server action; Vercel populates x-forwarded-for.
  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    h.get("x-real-ip") ??
    "unknown";
  if (!allow(`signup:${ip}`, { capacity: 10, tokensPerHour: 10 })) {
    console.warn("[signup rate limited]", { ip });
    return { ok: false, error: "rate_limited" };
  }

  // 3) Validate.
  const displayName = String(formData.get("displayName") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  if (displayName.length < 2 || phone.length < 7 || !email.includes("@")) {
    return { ok: false, error: "invalid" };
  }

  // 4) Settings gate. The toggle lives on the singleton settings row.
  try {
    const [s] = await db
      .select({ open: settings.publicSignupOpen })
      .from(settings)
      .where(eq(settings.id, 1))
      .limit(1);
    if (s && !s.open) {
      return { ok: false, error: "closed" };
    }
  } catch (err) {
    console.error("[signup] settings read failed:", err);
    return { ok: false, error: "unknown" };
  }

  // 5a) Duplicate - already a Supabase auth user?
  try {
    const admin = getSupabaseAdmin();
    // listUsers does not have a "filter by email" param in v2; we use the
    // explicit per-email lookup instead. Cheap because the user-table is
    // small for a friends pool.
    const { data: existing, error: lookupErr } =
      await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (lookupErr) {
      console.error("[signup] auth lookup failed:", lookupErr);
      return { ok: false, error: "unknown" };
    }
    if (existing.users.some((u) => u.email?.toLowerCase() === email)) {
      console.info("[signup duplicate auth user]", { email });
      return { ok: false, error: "duplicate" };
    }
  } catch (err) {
    console.error("[signup] auth lookup threw:", err);
    return { ok: false, error: "unknown" };
  }

  // 5b) Duplicate - already a pending request?
  try {
    const [pending] = await db
      .select({ id: signupRequests.id })
      .from(signupRequests)
      .where(
        and(
          eq(signupRequests.email, email),
          eq(signupRequests.status, "pending"),
        ),
      )
      .limit(1);
    if (pending) {
      console.info("[signup duplicate pending request]", { email });
      return { ok: false, error: "duplicate" };
    }
  } catch (err) {
    console.error("[signup] pending lookup failed:", err);
    return { ok: false, error: "unknown" };
  }

  // 6) Insert. The partial unique index will throw on a concurrent dupe
  // - we map the postgres unique-violation code to "duplicate".
  let requestId: string;
  try {
    const [row] = await db
      .insert(signupRequests)
      .values({ displayName, phone, email })
      .returning({ id: signupRequests.id });
    if (!row) {
      return { ok: false, error: "unknown" };
    }
    requestId = row.id;
    console.info("[signup request submitted]", { requestId, email, displayName });
  } catch (err: unknown) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "23505"
    ) {
      console.info("[signup race-condition duplicate]", { email });
      return { ok: false, error: "duplicate" };
    }
    console.error("[signup] insert failed:", err);
    return { ok: false, error: "unknown" };
  }

  // 6a) Fire admin notification email - best effort.
  const origin =
    h.get("origin") ??
    (h.get("host") ? `https://${h.get("host")}` : "http://localhost:3000");
  const adminUrl = `${origin}/he/admin/users?tab=requests`;
  const adminTo =
    process.env.ADMIN_NOTIFICATION_EMAIL ??
    process.env.EMAIL_REPLY_TO ??
    "";
  const emails = await getEmailCopy("he");
  if (adminTo) {
    const adminCopy = emails.adminSignupNotification;
    const r = await sendEmail({
      to: adminTo,
      subject: interpolate(adminCopy.preview, { displayName }),
      react: AdminSignupNotification({
        preview: interpolate(adminCopy.preview, { displayName }),
        heading: adminCopy.heading,
        body: adminCopy.body,
        nameLabel: adminCopy.nameLabel,
        phoneLabel: adminCopy.phoneLabel,
        emailLabel: adminCopy.emailLabel,
        buttonText: adminCopy.buttonText,
        footer: adminCopy.footer,
        displayName,
        phone,
        email,
        adminUrl,
      }),
    });
    console.info("[signup email] admin_notification", {
      requestId,
      ok: r.ok,
      messageId: r.ok ? r.messageId : null,
    });
  } else {
    console.warn("[signup] ADMIN_NOTIFICATION_EMAIL not set - skipped admin email");
  }

  // 6b) Fire registrant confirmation email - best effort.
  const userCopy = emails.userSignupConfirmation;
  const r2 = await sendEmail({
    to: email,
    subject: userCopy.preview,
    react: UserSignupConfirmation({
      preview: userCopy.preview,
      heading: interpolate(userCopy.heading, { displayName }),
      body1: userCopy.body1,
      body2: userCopy.body2,
      footer: userCopy.footer,
    }),
  });
  console.info("[signup email] user_confirmation", {
    requestId,
    ok: r2.ok,
    messageId: r2.ok ? r2.messageId : null,
  });

  return { ok: true };
}
