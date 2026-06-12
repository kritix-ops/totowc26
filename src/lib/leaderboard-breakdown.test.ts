import { describe, expect, it } from "vitest";
import {
  jerusalemDateKey,
  summarizeLeaderboardEvents,
} from "./leaderboard-breakdown";
import type { LeaderboardEvent } from "@/db/queries";

const event = (
  overrides: Partial<LeaderboardEvent> & { eventAt: string; delta: number },
): LeaderboardEvent => ({
  kind: "match",
  titleHe: "",
  titleEn: "",
  detailHe: null,
  detailEn: null,
  ...overrides,
});

describe("jerusalemDateKey", () => {
  it("returns the local day in Asia/Jerusalem regardless of UTC offset", () => {
    // 2026-06-13 23:30Z is already 2026-06-14 02:30 in Jerusalem (UTC+3).
    expect(jerusalemDateKey(new Date("2026-06-13T23:30:00Z"))).toBe(
      "2026-06-14",
    );
  });

  it("agrees on calendar dates that are unambiguous", () => {
    expect(jerusalemDateKey(new Date("2026-06-13T12:00:00Z"))).toBe(
      "2026-06-13",
    );
  });
});

describe("summarizeLeaderboardEvents", () => {
  const now = new Date("2026-06-13T18:00:00+03:00"); // 18:00 Jerusalem

  it("falls back to the most recent event when nothing graded today", () => {
    const events = [
      event({ eventAt: "2026-06-10T19:00:00+03:00", delta: 7 }),
      event({ eventAt: "2026-06-09T19:00:00+03:00", delta: -3 }),
    ];
    const s = summarizeLeaderboardEvents(events, 50, now);
    expect(s.headlineIsToday).toBe(false);
    expect(s.headlineDelta).toBe(7);
    expect(s.headlineEvents).toHaveLength(1);
    expect(s.previousPoints).toBe(43);
    expect(s.todayEvents).toHaveLength(0);
    expect(s.earlierEvents).toHaveLength(2);
  });

  it("sums today's events into the headline delta", () => {
    const events = [
      event({ eventAt: "2026-06-13T15:00:00+03:00", delta: 5 }),
      event({ eventAt: "2026-06-13T10:00:00+03:00", delta: 10 }),
      event({ eventAt: "2026-06-10T19:00:00+03:00", delta: -2 }),
    ];
    const s = summarizeLeaderboardEvents(events, 100, now);
    expect(s.headlineIsToday).toBe(true);
    expect(s.headlineDelta).toBe(15);
    expect(s.headlineEvents).toHaveLength(2);
    expect(s.previousPoints).toBe(85);
    expect(s.earlierEvents).toHaveLength(1);
  });

  it("treats a negative-delta day as today's change, not a fallback to past", () => {
    const events = [
      event({ eventAt: "2026-06-13T11:00:00+03:00", delta: -4 }),
      event({ eventAt: "2026-06-05T11:00:00+03:00", delta: 12 }),
    ];
    const s = summarizeLeaderboardEvents(events, 20, now);
    expect(s.headlineIsToday).toBe(true);
    expect(s.headlineDelta).toBe(-4);
    expect(s.previousPoints).toBe(24);
  });

  it("returns zeros and empty arrays for a player with no events", () => {
    const s = summarizeLeaderboardEvents([], 30, now);
    expect(s.todayEvents).toHaveLength(0);
    expect(s.earlierEvents).toHaveLength(0);
    expect(s.headlineDelta).toBe(0);
    expect(s.headlineIsToday).toBe(false);
    expect(s.previousPoints).toBe(30);
  });

  it("attributes a late-night-UTC event to the correct Jerusalem day", () => {
    // 22:30Z on June 13 = 01:30 Jerusalem on June 14 — belongs to "today"
    // only if `now` is also June 14 in Jerusalem.
    const events = [event({ eventAt: "2026-06-13T22:30:00Z", delta: 9 })];
    const lateNow = new Date("2026-06-14T01:45:00+03:00");
    const s = summarizeLeaderboardEvents(events, 50, lateNow);
    expect(s.headlineIsToday).toBe(true);
    expect(s.todayEvents).toHaveLength(1);
  });
});
