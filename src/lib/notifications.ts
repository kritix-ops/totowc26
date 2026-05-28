import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  profiles,
  pushSubscriptions,
  userNotifications,
  type NotificationKind,
} from "@/db/schema";
import { isPushConfigured, sendPush } from "./push";

// Unified notify helper. Inserts one user_notifications row per target
// user and (optionally) fires a web-push to each opted-in subscription
// they own. Returns counts so the caller can surface them in the UI.
//
// Callers:
//   - /admin/broadcast (admin announcements)
//   - sync.ts grading passes (bet_graded / match_final auto-events)
//
// Push is best-effort: failures from web-push don't block the insert,
// so the player still sees the event in the in-app feed even if their
// device push channel was broken. See migration 0026.

export type NotifyTarget =
  | { kind: "user"; userId: string }
  | { kind: "users"; userIds: string[] }
  | { kind: "all-opted-in" }
  | { kind: "all-players" };

export type NotifyPayload = {
  kind: NotificationKind;
  title: string;
  body: string;
  url?: string;
  // false -> only persist in the in-app feed, don't fire push.
  // true  -> also send push to every opted-in subscription owned by
  //          each recipient. The pushed flag is set per row on
  //          successful delivery so the broadcast UI can report
  //          which players got the push vs feed-only.
  push?: boolean;
  createdBy?: string;
};

export type NotifyResult = {
  recipients: number;
  inserted: number;
  pushAttempted: number;
  pushSent: number;
  pushFailed: number;
  pushExpired: number;
};

// Resolve a NotifyTarget to a set of profile ids. The "all" variants
// exclude rows that lack an email and the admin themselves is NOT
// excluded - admin who broadcasts to all sees the message in their
// own feed too, which is the right mental model for "send to everyone".
async function resolveRecipients(target: NotifyTarget): Promise<string[]> {
  switch (target.kind) {
    case "user":
      return target.userId ? [target.userId] : [];
    case "users":
      return target.userIds.filter((id) => typeof id === "string" && id.length > 0);
    case "all-opted-in": {
      const rows = await db
        .select({ id: profiles.id })
        .from(profiles)
        .where(eq(profiles.pushOptIn, true));
      return rows.map((r) => r.id);
    }
    case "all-players": {
      const rows = await db.select({ id: profiles.id }).from(profiles);
      return rows.map((r) => r.id);
    }
  }
}

export async function notifyUsers(
  target: NotifyTarget,
  payload: NotifyPayload,
): Promise<NotifyResult> {
  const recipients = await resolveRecipients(target);
  const result: NotifyResult = {
    recipients: recipients.length,
    inserted: 0,
    pushAttempted: 0,
    pushSent: 0,
    pushFailed: 0,
    pushExpired: 0,
  };
  if (recipients.length === 0) return result;

  // 1. Insert one feed row per recipient. The bulk insert is one
  // round-trip and the inserted count drives the UI.
  const rows = recipients.map((userId) => ({
    userId,
    kind: payload.kind,
    title: payload.title,
    body: payload.body,
    url: payload.url ?? null,
    pushed: false,
    createdBy: payload.createdBy ?? null,
  }));
  const inserted = await db
    .insert(userNotifications)
    .values(rows)
    .returning({ id: userNotifications.id, userId: userNotifications.userId });
  result.inserted = inserted.length;
  console.info("[notify insert]", {
    target: target.kind,
    kind: payload.kind,
    inserted: inserted.length,
  });

  // 2. Optional push. Skip silently when VAPID isn't configured or the
  // caller opted out.
  if (!payload.push || !isPushConfigured()) return result;

  // Look up every push subscription whose owner is BOTH in our
  // recipient set AND has the opt-in flag on. The flag is the
  // user-side "pause" lever; we always honor it for push even when
  // the broadcast explicitly targets a non-opted-in person.
  const subs = await db
    .select({
      id: pushSubscriptions.id,
      userId: pushSubscriptions.userId,
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
    })
    .from(pushSubscriptions)
    .innerJoin(profiles, eq(profiles.id, pushSubscriptions.userId))
    .where(
      and(
        eq(profiles.pushOptIn, true),
        inArray(pushSubscriptions.userId, recipients),
      ),
    );
  result.pushAttempted = subs.length;

  // Track which user_ids actually got a push so we can flip the
  // pushed flag in their feed rows.
  const pushedUserIds = new Set<string>();
  for (const s of subs) {
    const res = await sendPush(
      { endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth },
      {
        title: payload.title,
        body: payload.body,
        url: payload.url ?? "/he",
        tag: `notif-${payload.kind}-${s.userId}`,
      },
    );
    if (res.ok) {
      result.pushSent += 1;
      pushedUserIds.add(s.userId);
      continue;
    }
    if (res.error === "expired") {
      result.pushExpired += 1;
      // Prune the dead subscription; the next pass won't retry it.
      await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
      continue;
    }
    result.pushFailed += 1;
  }

  if (pushedUserIds.size > 0) {
    // Mark the feed rows we just inserted as also-pushed.
    const ids = inserted
      .filter((r) => pushedUserIds.has(r.userId))
      .map((r) => r.id);
    if (ids.length > 0) {
      await db
        .update(userNotifications)
        .set({ pushed: true })
        .where(inArray(userNotifications.id, ids));
    }
  }

  console.info("[notify sweep]", {
    target: target.kind,
    kind: payload.kind,
    recipients: result.recipients,
    inserted: result.inserted,
    pushAttempted: result.pushAttempted,
    pushSent: result.pushSent,
    pushFailed: result.pushFailed,
    pushExpired: result.pushExpired,
  });

  return result;
}

// Mark every unread notification for a user as read. The /he/notifications
// page calls this on load so a visit naturally clears the badge.
export async function markAllNotificationsRead(userId: string): Promise<number> {
  const updated = await db
    .update(userNotifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(userNotifications.userId, userId),
        sql`${userNotifications.readAt} is null`,
      ),
    )
    .returning({ id: userNotifications.id });
  return updated.length;
}

export async function countUnreadNotifications(userId: string): Promise<number> {
  const rows = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from public.user_notifications
    where user_id = ${userId}::uuid and read_at is null
  `);
  return (rows as unknown as Array<{ n: number }>)[0]?.n ?? 0;
}
