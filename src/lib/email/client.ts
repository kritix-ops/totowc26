import "server-only";
import { Resend } from "resend";
import type { ReactElement } from "react";

// Thin wrapper around the Resend SDK so call sites stay short and the
// envelope (from / reply-to / logging shape) is consistent across every
// transactional email the app sends.
//
// Configuration (env):
//   RESEND_API_KEY   — required for actually sending. When missing in dev
//                      we log a warning and return { ok: false, error:
//                      "not_configured" }. The caller decides whether
//                      that's fatal; sign-up best-effort flows shrug it
//                      off so devs can run /signup without Resend wired.
//   EMAIL_FROM       — e.g. "Toto Mundial <noreply@kritix.io>". Required.
//   EMAIL_REPLY_TO   — e.g. "yoav@kritix.io". Optional. When set, every
//                      send threads replies back to the admin inbox so a
//                      registrant who hits Reply lands in the right place.

type SendArgs = {
  to: string | string[];
  subject: string;
  react: ReactElement;
  replyTo?: string;
};

type SendResult =
  | { ok: true; messageId: string }
  | { ok: false; error: "not_configured" | "send_failed"; detail?: string };

let cached: Resend | null = null;

function getClient(): Resend | null {
  if (cached) return cached;
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  cached = new Resend(key);
  return cached;
}

export async function sendEmail({
  to,
  subject,
  react,
  replyTo,
}: SendArgs): Promise<SendResult> {
  const from = process.env.EMAIL_FROM;
  if (!from) {
    console.warn("[email] EMAIL_FROM not set — skipping send", { to, subject });
    return { ok: false, error: "not_configured" };
  }
  const client = getClient();
  if (!client) {
    console.warn("[email] RESEND_API_KEY not set — skipping send", {
      to,
      subject,
    });
    return { ok: false, error: "not_configured" };
  }

  const { data, error } = await client.emails.send({
    from,
    to,
    subject,
    react,
    replyTo: replyTo ?? process.env.EMAIL_REPLY_TO,
  });

  if (error || !data) {
    console.error("[email send failed]", {
      to,
      subject,
      error: error?.message ?? "unknown",
    });
    return {
      ok: false,
      error: "send_failed",
      detail: error?.message,
    };
  }

  console.info("[email sent]", { to, subject, messageId: data.id });
  return { ok: true, messageId: data.id };
}
