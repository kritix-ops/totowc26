import "server-only";

import { sql } from "drizzle-orm";
import { execRows } from "@/db/helpers";

// Smart-hub dismissals live in user_moment_dismissals. Helpers below
// keep both the read path (ranker filter) and the write path (the
// dismiss API route) in one file so the timezone math for "tomorrow
// 04:00 Asia/Jerusalem" is defined exactly once.
//
// See _plans/2026-05-30-smart-reminders.md.

// Returns the set of moment_keys currently dismissed for this user
// (dismissed_until is still in the future). Used by the ranker as a
// filter BEFORE applying scoring + diversity penalties so a dismissed
// moment never even competes for a slot.
export async function getActiveDismissals(
  userId: string,
): Promise<Set<string>> {
  const rows = await execRows<{ moment_key: string }>(sql`
    select moment_key
    from public.user_moment_dismissals
    where user_id = ${userId}::uuid
      and dismissed_until > now()
  `);
  return new Set(rows.map((r) => r.moment_key));
}

// Compute the next 04:00 IL boundary AFTER `now`. We dismiss a moment
// until the next IL morning so the same nudge does not re-surface
// inside the current betting day, but the player gets a fresh deck
// the next time they open the app the following morning.
//
// Implementation note: Intl.DateTimeFormat is the canonical way to
// translate UTC into IL local calendar fields without a tz library.
// We rebuild the timestamp from those fields, force it back to UTC
// via `Date.UTC`, and then offset by the IL offset that the formatter
// gave us. Doing it in pure JS keeps this helper synchronous and
// testable from Vitest without DB access.
export function nextIlMorning(now: Date): Date {
  // Pull IL local Y/M/D/H and the offset for `now` so we can compute
  // "the next 04:00 IL" from any current moment, including across DST
  // boundaries.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(now).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour);

  // "Today at 04:00 IL" expressed as a UTC instant. Use noon as a probe
  // to read the IL offset for this calendar date, then subtract it
  // from the would-be local time. Probe at noon so we never sample a
  // tz-transition boundary.
  const probeUtc = Date.UTC(year, month - 1, day, 12, 0, 0);
  const probeIlString = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jerusalem",
    hour: "2-digit",
    hour12: false,
  }).format(new Date(probeUtc));
  const probeIlHour = Number(probeIlString);
  // offset (minutes east of UTC) = (IL hour at probe) - (UTC hour at probe)
  const offsetMinutes = (probeIlHour - 12) * 60;
  const target = Date.UTC(year, month - 1, day, 4, 0, 0) - offsetMinutes * 60_000;
  let targetDate = new Date(target);
  // If 04:00 IL today has already passed, roll to tomorrow.
  if (targetDate.getTime() <= now.getTime() || hour >= 4) {
    targetDate = new Date(targetDate.getTime() + 24 * 60 * 60 * 1000);
  }
  return targetDate;
}

export type DismissResult =
  | { ok: true; dismissedUntil: string }
  | { ok: false; error: "invalid_key" | "unauthorized" | "db" };

// Stable shape so the API route stays small.
export function isValidMomentKey(key: string): boolean {
  return typeof key === "string" && /^[a-z_]+(:[a-zA-Z0-9_-]+)?$/.test(key);
}
