"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { getUser } from "@/lib/supabase/auth";
import { sendEmail } from "@/lib/email/client";
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

  const subjectAndReact =
    template === "admin_notification"
      ? {
          subject: `[בדיקה] בקשת הרשמה חדשה - ${sample.displayName}`,
          react: AdminSignupNotification({
            displayName: sample.displayName,
            phone: sample.phone,
            email: sample.email,
            adminUrl: sample.adminUrl,
          }),
        }
      : template === "user_confirmation"
        ? {
            subject: "[בדיקה] קיבלנו את הבקשה שלך לטוטו מונדיאל",
            react: UserSignupConfirmation({
              displayName: sample.displayName,
            }),
          }
        : {
            subject: "[בדיקה] ברוך הבא לטוטו מונדיאל",
            react: UserApprovalEmail({
              displayName: sample.displayName,
              recoveryUrl: sample.recoveryUrl,
            }),
          };

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
