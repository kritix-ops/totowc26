import { describe, expect, it } from "vitest";
import {
  syncTouchedFixtures,
  syncTouchedLeaderboard,
  type SyncReport,
} from "./sync";

// Unit tests for the two report->cache-tag predicates that drive the
// cron route's and admin sync's revalidateTag/updateTag calls. They are
// pure, so they pin the exact conditions under which each global cache
// tag is busted: getting these wrong either leaves the leaderboard stale
// after a grade or churns the cache on every no-op 5-minute tick.

function report(overrides: Partial<SyncReport> = {}): SyncReport {
  return {
    fetched: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    scoredBets: 0,
    scoredMatches: 0,
    scoredAutoCustomBets: 0,
    cancelledDuels: 0,
    settledAutoDuels: 0,
    lockedExpiredCustomBets: 0,
    remindersSent: 0,
    unknownTeams: [],
    ...overrides,
  };
}

describe("syncTouchedFixtures", () => {
  it("is false for a no-op sync that changed nothing", () => {
    expect(syncTouchedFixtures(report())).toBe(false);
  });

  it("is true when a fixture was updated (score/status changed)", () => {
    expect(syncTouchedFixtures(report({ updated: 1 }))).toBe(true);
  });

  it("is true when a new fixture was inserted", () => {
    expect(syncTouchedFixtures(report({ inserted: 3 }))).toBe(true);
  });

  it("ignores scoring-only changes (those drive the leaderboard tag)", () => {
    expect(syncTouchedFixtures(report({ scoredBets: 5 }))).toBe(false);
  });
});

describe("syncTouchedLeaderboard", () => {
  it("is false for a no-op sync that graded nothing", () => {
    expect(syncTouchedLeaderboard(report())).toBe(false);
  });

  it("is false when only fixture metadata refreshed (no grading)", () => {
    expect(syncTouchedLeaderboard(report({ updated: 4, fetched: 72 }))).toBe(
      false,
    );
  });

  it.each([
    ["scoredBets", { scoredBets: 1 }],
    ["scoredMatches", { scoredMatches: 1 }],
    ["scoredAutoCustomBets", { scoredAutoCustomBets: 1 }],
    ["settledAutoDuels", { settledAutoDuels: 1 }],
  ])("is true when %s moved the standings", (_label, overrides) => {
    expect(syncTouchedLeaderboard(report(overrides))).toBe(true);
  });
});
