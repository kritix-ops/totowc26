import type { LeaderboardEvent } from "@/db/queries";

// Pure helpers behind the leaderboard accordion. Kept out of the React
// component so they can be unit-tested without rendering and so the
// "today vs earlier" partition follows a single explicit rule.

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

export type LeaderboardSummary = {
  todayEvents: LeaderboardEvent[];
  earlierEvents: LeaderboardEvent[];
  // When at least one event landed today, the headline shows the day's
  // net delta. Otherwise we fall back to the single most recent event
  // so the accordion still anchors to "what happened last".
  headlineDelta: number;
  headlineIsToday: boolean;
  headlineEvents: LeaderboardEvent[];
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
  const todayEvents = events.filter(
    (e) => jerusalemDateKey(new Date(e.eventAt)) === todayKey,
  );
  const earlierEvents = events.filter(
    (e) => jerusalemDateKey(new Date(e.eventAt)) !== todayKey,
  );
  const todayDelta = todayEvents.reduce((acc, e) => acc + e.delta, 0);
  const lastEventDelta = events[0]?.delta ?? 0;
  const headlineIsToday = todayEvents.length > 0;
  const headlineDelta = headlineIsToday ? todayDelta : lastEventDelta;
  const headlineEvents = headlineIsToday ? todayEvents : events.slice(0, 1);
  return {
    todayEvents,
    earlierEvents,
    headlineDelta,
    headlineIsToday,
    headlineEvents,
    previousPoints: currentPoints - headlineDelta,
  };
}
