import type { LeaderboardEvent } from "@/db/queries";

// Pure helpers behind the leaderboard accordion. Kept out of the React
// component so they can be unit-tested without rendering and so the
// "today vs yesterday" partition follows a single explicit rule.

const ASIA_JERUSALEM_TZ = "Asia/Jerusalem";

// YYYY-MM-DD key in Asia/Jerusalem regardless of the runtime's TZ. We
// intentionally use the Intl machinery directly here — formatDateTime is
// for user-facing display strings, not for grouping keys.
export function jerusalemDateKey(date: Date): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: ASIA_JERUSALEM_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(date);
}

// The Jerusalem calendar day immediately before `key` (a YYYY-MM-DD string).
// Pure calendar arithmetic in UTC so a DST shift in Israel can't move the
// result off by a day: we anchor the key at midnight UTC, step back 24h,
// and re-read the date part. (Midnight-UTC minus a day is always the prior
// date regardless of timezone.)
function previousDateKey(key: string): string {
  const anchor = new Date(`${key}T00:00:00Z`);
  anchor.setUTCDate(anchor.getUTCDate() - 1);
  return anchor.toISOString().slice(0, 10);
}

export type LeaderboardSummary = {
  todayEvents: LeaderboardEvent[];
  // Events graded on the previous Jerusalem calendar day, newest-first.
  // These populate the collapsed "yesterday" accordion. The most-recent
  // event is removed when it's also the headline fallback (see below) so it
  // never appears twice.
  yesterdayEvents: LeaderboardEvent[];
  // When at least one event landed today, the headline shows the day's
  // net delta. Otherwise we fall back to the single most recent event
  // so the accordion still anchors to "what happened last".
  headlineDelta: number;
  headlineIsToday: boolean;
  headlineEvents: LeaderboardEvent[];
  // Net of yesterday's events — drives the at-a-glance up/down pill on the
  // collapsed accordion so the previous day's swing is visible without
  // expanding it.
  yesterdayDelta: number;
  // currentPoints minus headlineDelta — what their score was before the
  // headline events fired.
  previousPoints: number;
};

export function summarizeLeaderboardEvents(
  events: LeaderboardEvent[],
  currentPoints: number,
  now: Date,
): LeaderboardSummary {
  const todayKey = jerusalemDateKey(now);
  const yesterdayKey = previousDateKey(todayKey);
  const todayEvents = events.filter(
    (e) => jerusalemDateKey(new Date(e.eventAt)) === todayKey,
  );
  const todayDelta = todayEvents.reduce((acc, e) => acc + e.delta, 0);
  const lastEventDelta = events[0]?.delta ?? 0;
  const headlineIsToday = todayEvents.length > 0;
  const headlineDelta = headlineIsToday ? todayDelta : lastEventDelta;
  const headlineEvents = headlineIsToday ? todayEvents : events.slice(0, 1);
  // Yesterday's events, minus anything already promoted into the headline
  // (the fallback case borrows the single most recent event, which can be
  // a yesterday event — without this filter it would render twice).
  const headlineSet = new Set(headlineEvents);
  const yesterdayEvents = events.filter(
    (e) =>
      jerusalemDateKey(new Date(e.eventAt)) === yesterdayKey &&
      !headlineSet.has(e),
  );
  const yesterdayDelta = yesterdayEvents.reduce((acc, e) => acc + e.delta, 0);
  return {
    todayEvents,
    yesterdayEvents,
    headlineDelta,
    headlineIsToday,
    headlineEvents,
    yesterdayDelta,
    previousPoints: currentPoints - headlineDelta,
  };
}
