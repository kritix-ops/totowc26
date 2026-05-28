"use server";

import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { profiles, pushSubscriptions } from "@/db/schema";
import { isAdmin } from "@/lib/admin";
import { isPushConfigured, sendPush } from "@/lib/push";
import { getUser } from "@/lib/supabase/auth";

// Admin-facing test sender for the push pipeline. Bypasses the
// reminder window + dedup table; this is a smoke test, not a real
// notification. Returns per-subscription counts so the admin can tell
// at a glance whether anything actually delivered.
//
// Targeting modes:
//   { kind: "user", userId } - just that one user, regardless of
//     push_opt_in. Useful for admin self-tests where the toggle may
//     have been flipped off recently.
//   { kind: "all-opted-in" } - everyone with push_opt_in=true.
//     Honors the opt-in flag - players who paused notifications stay
//     out of the smoke test the same way they stay out of real ones.
//
// See _plans/2026-05-28-lock-reminders.md §5.

export type PushTarget =
  | { kind: "user"; userId: string }
  | { kind: "all-opted-in" };

export type SendTestPushResult =
  | {
      ok: true;
      attempted: number;
      sent: number;
      failed: number;
      expired: number;
    }
  | {
      ok: false;
      error:
        | "unauthorized"
        | "forbidden"
        | "vapid_missing"
        | "no_subscriptions"
        | "invalid"
        | "db";
    };

export type PushTestPayload = {
  title?: string;
  body?: string;
};

export async function sendTestPush(
  target: PushTarget,
  payload: PushTestPayload = {},
): Promise<SendTestPushResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauthorized" };
  if (!(await isAdmin(user.id))) return { ok: false, error: "forbidden" };
  if (!isPushConfigured()) return { ok: false, error: "vapid_missing" };

  // Resolve recipients. The query already filters out rows whose
  // user has been deleted (FK cascade), but we re-check user_id to
  // be explicit for the targeted variant.
  const baseSelect = db
    .select({
      id: pushSubscriptions.id,
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
    })
    .from(pushSubscriptions);

  let subs;
  if (target.kind === "user") {
    if (!target.userId || typeof target.userId !== "string") {
      return { ok: false, error: "invalid" };
    }
    subs = await baseSelect.where(eq(pushSubscriptions.userId, target.userId));
  } else {
    // Join profiles to filter by opt-in. Using a separate query
    // rather than a where-subquery so the shape stays clear.
    subs = await db
      .select({
        id: pushSubscriptions.id,
        endpoint: pushSubscriptions.endpoint,
        p256dh: pushSubscriptions.p256dh,
        auth: pushSubscriptions.auth,
      })
      .from(pushSubscriptions)
      .innerJoin(profiles, eq(profiles.id, pushSubscriptions.userId))
      .where(and(eq(profiles.pushOptIn, true), isNotNull(profiles.id)));
  }

  if (subs.length === 0) {
    return { ok: false, error: "no_subscriptions" };
  }

  const title = payload.title?.trim() || "טוטו מונדיאל — בדיקה";
  const body = payload.body?.trim() || "התראת בדיקה. אם רואים את זה, push עובד.";

  let sent = 0;
  let failed = 0;
  let expired = 0;
  for (const s of subs) {
    const res = await sendPush(s, {
      title,
      body,
      url: "/he",
      tag: "admin-push-test",
    });
    if (res.ok) {
      sent += 1;
      console.info("[push test send]", {
        adminId: user.id,
        subscriptionId: s.id,
      });
      continue;
    }
    if (res.error === "expired") {
      // Delete the dead row so the operator gets an accurate count
      // on the next test run and the cron stops trying.
      await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
      expired += 1;
      console.info("[push test expired]", {
        adminId: user.id,
        subscriptionId: s.id,
      });
      continue;
    }
    failed += 1;
    console.warn("[push test failed]", {
      adminId: user.id,
      subscriptionId: s.id,
      error: res.error,
    });
  }

  return { ok: true, attempted: subs.length, sent, failed, expired };
}
