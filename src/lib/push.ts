import "server-only";

import webpush from "web-push";

// Thin wrapper around web-push for the lock-reminder sender. Lazy-
// configures the library on first send and caches the configured
// state, mirroring the email/client.ts pattern.
//
// Env (all required for push to work):
//   VAPID_PUBLIC_KEY    - same value /api/push/public-key returns
//   VAPID_PRIVATE_KEY   - server-only signing key
//   VAPID_SUBJECT       - mailto: contact, required by the VAPID spec
//
// See _plans/2026-05-28-lock-reminders.md §5.

let configured = false;
let configurable: boolean | null = null;

function ensureConfigured(): boolean {
  if (configurable === false) return false;
  if (configured) return true;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    configurable = false;
    return false;
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  configurable = true;
  return true;
}

export type PushSubscriptionKeys = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type PushPayload = {
  title: string;
  body: string;
  url: string;
  tag?: string;
};

export type SendPushResult =
  | { ok: true }
  | { ok: false; error: "not_configured" | "expired" | "send_failed"; status?: number };

// Send one push to one subscription. Caller decides what to do with
// each result; in particular `expired` (HTTP 404/410 from the push
// service) means the subscription is dead and should be deleted.
export async function sendPush(
  sub: PushSubscriptionKeys,
  payload: PushPayload,
): Promise<SendPushResult> {
  if (!ensureConfigured()) {
    return { ok: false, error: "not_configured" };
  }
  try {
    await webpush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      },
      JSON.stringify(payload),
      { TTL: 60 * 60 }, // 1 hour — reminders are useless if delivered later
    );
    return { ok: true };
  } catch (err) {
    const status =
      err && typeof err === "object" && "statusCode" in err
        ? Number((err as { statusCode: unknown }).statusCode)
        : undefined;
    if (status === 404 || status === 410) {
      return { ok: false, error: "expired", status };
    }
    console.error("[push send failed]", {
      endpoint: sub.endpoint.slice(0, 60),
      status,
      err: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: "send_failed", status };
  }
}

export function isPushConfigured(): boolean {
  return ensureConfigured();
}
