"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { getUser } from "@/lib/supabase/auth";
import { sendEmail } from "@/lib/email/client";
import { getEmailCopy, interpolate } from "@/lib/email/copy";
import { AdminSignupNotification } from "@/lib/email/templates/AdminSignupNotification";
import { UserSignupConfirmation } from "@/lib/email/templates/UserSignupConfirmation";
import { UserApprovalEmail } from "@/lib/email/templates/UserApprovalEmail";

export type EmailTemplate =
  | "admin_notification"
  | "user_confirmation"
  | "user_approval";

export type EnvSummary = {
  resendApiKey: "set" | "missing";
  emailFrom: string | null;
  emailReplyTo: string | null;
  adminNotificationEmail: string | null;
};

export type SendTestEmailResult =
  | {
      ok: true;
      messageId: string;
      env: EnvSummary;
    }
  | {
      ok: false;
      error:
        | "unauthorized"
        | "forbidden"
        | "invalid_email"
        | "not_configured"
        | "send_failed";
      detail?: string;
      env: EnvSummary;
    };

function readEnv(): EnvSummary {
  return {
    resendApiKey: process.env.RESEND_API_KEY ? "set" : "missing",
    emailFrom: process.env.EMAIL_FROM ?? null,
    emailReplyTo: process.env.EMAIL_REPLY_TO ?? null,
    adminNotificationEmail: process.env.ADMIN_NOTIFICATION_EMAIL ?? null,
  };
}

export async function sendTestEmail(
  to: string,
  template: EmailTemplate,
): Promise<SendTestEmailResult> {
  const env = readEnv();

  const user = await getUser();
  if (!user) return { ok: false, error: "unauthorized", env };

  const [me] = await db
    .select({ role: profiles.role })
    .from(profiles)
    .where(eq(profiles.id, user.id))
    .limit(1);
  if (!me || me.role !== "admin") {
    return { ok: false, error: "forbidden", env };
  }

  const target = to.trim().toLowerCase();
  if (!target.includes("@") || target.length < 5) {
    return { ok: false, error: "invalid_email", env };
  }

  console.info("[email test submit]", {
    to: target,
    template,
    byAdminId: user.id,
  });

  const sample = {
    displayName: "Yoav Test",
    phone: "0501234567",
    email: target,
    adminUrl: "https://example.com/he/admin/signup-requests",
    recoveryUrl: "https://example.com/he/set-password?token=test",
  };

  const emails = await getEmailCopy("he");
  let subjectAndReact: { subject: string; react: React.ReactElement };
  if (template === "admin_notification") {
    const c = emails.adminSignupNotification;
    subjectAndReact = {
      subject: `[בדיקה] ${interpolate(c.preview, { displayName: sample.displayName })}`,
      react: AdminSignupNotification({
        preview: interpolate(c.preview, { displayName: sample.displayName }),
        heading: c.heading,
        body: c.body,
        nameLabel: c.nameLabel,
        phoneLabel: c.phoneLabel,
        emailLabel: c.emailLabel,
        buttonText: c.buttonText,
        footer: c.footer,
        displayName: sample.displayName,
        phone: sample.phone,
        email: sample.email,
        adminUrl: sample.adminUrl,
      }),
    };
  } else if (template === "user_confirmation") {
    const c = emails.userSignupConfirmation;
    subjectAndReact = {
      subject: `[בדיקה] ${c.preview}`,
      react: UserSignupConfirmation({
        preview: c.preview,
        heading: interpolate(c.heading, { displayName: sample.displayName }),
        body1: c.body1,
        body2: c.body2,
        footer: c.footer,
      }),
    };
  } else {
    const c = emails.userApproval;
    subjectAndReact = {
      subject: `[בדיקה] ${c.preview}`,
      react: UserApprovalEmail({
        preview: c.preview,
        heading: interpolate(c.heading, { displayName: sample.displayName }),
        body: c.body,
        buttonText: c.buttonText,
        fallbackHint: c.fallbackHint,
        footer: c.footer,
        recoveryUrl: sample.recoveryUrl,
      }),
    };
  }

  const result = await sendEmail({
    to: target,
    subject: subjectAndReact.subject,
    react: subjectAndReact.react,
  });

  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      detail: "detail" in result ? result.detail : undefined,
      env,
    };
  }

  return { ok: true, messageId: result.messageId, env };
}
