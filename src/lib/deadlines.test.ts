import { describe, expect, it } from "vitest";
import {
  FALLBACK_OFFSET_MINUTES,
  previewCustomBetLock,
  resolveCustomBetLock,
  resolveMatchScoreLock,
  type DeadlineContext,
} from "./deadlines";

// Pure-function tests for the deadline resolver. Skips
// getDeadlineContext (the DB loader) since vitest aliases
// `server-only` to an empty stub but the db() client itself would
// still need a Postgres connection. The pure resolvers are the
// load-bearing logic; the loader is a thin SELECT.

const baseContext: DeadlineContext = {
  defaults: { ...FALLBACK_OFFSET_MINUTES },
  stageDefaults: {},
  tournamentStartAt: null,
  derivedTournamentStartAt: null,
  matchPicksGlobalLockAt: null,
};

const KICKOFF = new Date("2026-06-15T18:00:00Z");

describe("resolveMatchScoreLock", () => {
  it("returns per-bet override verbatim when set, ignoring everything else", () => {
    const override = new Date("2026-06-15T15:30:00Z");
    const r = resolveMatchScoreLock(
      {
        matchId: "m1",
        kickoffAt: KICKOFF,
        stage: "group",
        lockAtOverride: override,
        matchdayLockOffsetMinutes: 999,
      },
      { ...baseContext, defaults: { ...baseContext.defaults, match_score: 999 } },
    );
    expect(r.source).toBe("per_bet_override");
    expect(r.effectiveLockAt.toISOString()).toBe(override.toISOString());
    expect(r.appliedOffsetMinutes).toBeNull();
  });

  it("uses matchday override when per-bet is null", () => {
    const r = resolveMatchScoreLock(
      {
        matchId: "m1",
        kickoffAt: KICKOFF,
        stage: "group",
        lockAtOverride: null,
        matchdayLockOffsetMinutes: 30,
      },
      baseContext,
    );
    expect(r.source).toBe("matchday_override");
    expect(r.appliedOffsetMinutes).toBe(30);
    // 30 min before kickoff
    expect(r.effectiveLockAt.getTime()).toBe(KICKOFF.getTime() - 30 * 60_000);
  });

  it("falls back to the per-type default when both overrides are null", () => {
    const r = resolveMatchScoreLock(
      {
        matchId: "m1",
        kickoffAt: KICKOFF,
        stage: "group",
        lockAtOverride: null,
        matchdayLockOffsetMinutes: null,
      },
      baseContext,
    );
    expect(r.source).toBe("type_default");
    expect(r.appliedOffsetMinutes).toBe(FALLBACK_OFFSET_MINUTES.match_score);
    expect(r.effectiveLockAt.getTime()).toBe(
      KICKOFF.getTime() - FALLBACK_OFFSET_MINUTES.match_score * 60_000,
    );
  });

  it("handles matchday override of 0 (lock at exact kickoff)", () => {
    const r = resolveMatchScoreLock(
      {
        matchId: "m1",
        kickoffAt: KICKOFF,
        stage: "group",
        lockAtOverride: null,
        matchdayLockOffsetMinutes: 0,
      },
      baseContext,
    );
    expect(r.source).toBe("matchday_override");
    expect(r.effectiveLockAt.getTime()).toBe(KICKOFF.getTime());
  });

  it("global match-picks cap wins over matchday + type default", () => {
    const cap = new Date("2026-06-10T20:59:00Z");
    const r = resolveMatchScoreLock(
      {
        matchId: "m1",
        kickoffAt: KICKOFF,
        stage: "group",
        lockAtOverride: null,
        matchdayLockOffsetMinutes: 30,
      },
      { ...baseContext, matchPicksGlobalLockAt: cap },
    );
    expect(r.source).toBe("global_match_picks_cap");
    expect(r.effectiveLockAt.toISOString()).toBe(cap.toISOString());
    expect(r.appliedOffsetMinutes).toBeNull();
  });

  it("per-bet override still beats the global cap", () => {
    const override = new Date("2026-06-12T10:00:00Z");
    const cap = new Date("2026-06-10T20:59:00Z");
    const r = resolveMatchScoreLock(
      {
        matchId: "m1",
        kickoffAt: KICKOFF,
        stage: "group",
        lockAtOverride: override,
        matchdayLockOffsetMinutes: null,
      },
      { ...baseContext, matchPicksGlobalLockAt: cap },
    );
    expect(r.source).toBe("per_bet_override");
    expect(r.effectiveLockAt.toISOString()).toBe(override.toISOString());
  });

  it("uses the per-stage default when matchday override is null", () => {
    const r = resolveMatchScoreLock(
      {
        matchId: "m1",
        kickoffAt: KICKOFF,
        stage: "r16",
        lockAtOverride: null,
        matchdayLockOffsetMinutes: null,
      },
      { ...baseContext, stageDefaults: { r16: 90 } },
    );
    expect(r.source).toBe("stage_default");
    expect(r.appliedOffsetMinutes).toBe(90);
    expect(r.effectiveLockAt.getTime()).toBe(KICKOFF.getTime() - 90 * 60_000);
  });

  it("matchday override wins over the per-stage default", () => {
    const r = resolveMatchScoreLock(
      {
        matchId: "m1",
        kickoffAt: KICKOFF,
        stage: "r16",
        lockAtOverride: null,
        matchdayLockOffsetMinutes: 45,
      },
      { ...baseContext, stageDefaults: { r16: 90 } },
    );
    expect(r.source).toBe("matchday_override");
    expect(r.appliedOffsetMinutes).toBe(45);
  });

  it("global cap wins over the per-stage default", () => {
    const cap = new Date("2026-06-10T20:59:00Z");
    const r = resolveMatchScoreLock(
      {
        matchId: "m1",
        kickoffAt: KICKOFF,
        stage: "r16",
        lockAtOverride: null,
        matchdayLockOffsetMinutes: null,
      },
      {
        ...baseContext,
        matchPicksGlobalLockAt: cap,
        stageDefaults: { r16: 90 },
      },
    );
    expect(r.source).toBe("global_match_picks_cap");
    expect(r.effectiveLockAt.toISOString()).toBe(cap.toISOString());
  });

  it("per-stage default for an unrelated stage doesn't apply", () => {
    const r = resolveMatchScoreLock(
      {
        matchId: "m1",
        kickoffAt: KICKOFF,
        stage: "group",
        lockAtOverride: null,
        matchdayLockOffsetMinutes: null,
      },
      { ...baseContext, stageDefaults: { r16: 90 } },
    );
    expect(r.source).toBe("type_default");
    expect(r.appliedOffsetMinutes).toBe(FALLBACK_OFFSET_MINUTES.match_score);
  });
});

describe("resolveCustomBetLock", () => {
  it("echoes the bet's lockAt verbatim", () => {
    const lockAt = new Date("2026-06-11T19:00:00Z");
    const r = resolveCustomBetLock({
      id: "bet1",
      scope: "tournament",
      lockAt,
    });
    expect(r.source).toBe("per_bet_override");
    expect(r.effectiveLockAt.toISOString()).toBe(lockAt.toISOString());
  });
});

describe("previewCustomBetLock", () => {
  const tournamentStart = new Date("2026-06-11T18:00:00Z");

  it("tournament scope uses settings.tournament_start_at when present", () => {
    const r = previewCustomBetLock(
      { scope: "tournament", anchor: null },
      { ...baseContext, tournamentStartAt: tournamentStart },
    );
    expect(r.anchor?.toISOString()).toBe(tournamentStart.toISOString());
    expect(r.offsetMinutesApplied).toBe(
      FALLBACK_OFFSET_MINUTES.custom_tournament,
    );
    expect(r.effectiveLockAt?.getTime()).toBe(
      tournamentStart.getTime() -
        FALLBACK_OFFSET_MINUTES.custom_tournament * 60_000,
    );
  });

  it("tournament scope falls back to the derived earliest kickoff", () => {
    const derived = new Date("2026-06-11T20:00:00Z");
    const r = previewCustomBetLock(
      { scope: "tournament", anchor: null },
      {
        ...baseContext,
        tournamentStartAt: null,
        derivedTournamentStartAt: derived,
      },
    );
    expect(r.anchor?.toISOString()).toBe(derived.toISOString());
  });

  it("returns null effectiveLockAt when no anchor is available", () => {
    const r = previewCustomBetLock(
      { scope: "stage", anchor: null },
      baseContext,
    );
    expect(r.effectiveLockAt).toBeNull();
    expect(r.anchor).toBeNull();
  });

  it("matchday override beats the type default for match-scope preview", () => {
    const anchor = new Date("2026-06-15T18:00:00Z");
    const r = previewCustomBetLock(
      { scope: "match", anchor, matchdayLockOffsetMinutes: 45 },
      baseContext,
    );
    expect(r.source).toBe("matchday_override");
    expect(r.offsetMinutesApplied).toBe(45);
    expect(r.effectiveLockAt?.getTime()).toBe(anchor.getTime() - 45 * 60_000);
  });

  it("matchday override is ignored for stage scope (anchored elsewhere)", () => {
    const anchor = new Date("2026-07-10T18:00:00Z");
    const r = previewCustomBetLock(
      // matchdayLockOffsetMinutes shouldn't apply outside match/day
      { scope: "stage", anchor, matchdayLockOffsetMinutes: 45 },
      baseContext,
    );
    expect(r.source).toBe("type_default");
    expect(r.offsetMinutesApplied).toBe(FALLBACK_OFFSET_MINUTES.custom_stage);
  });

  it("per-stage default applies to match-scope preview when matchday override is null", () => {
    const anchor = new Date("2026-07-05T18:00:00Z");
    const r = previewCustomBetLock(
      { scope: "match", anchor, stage: "qf" },
      { ...baseContext, stageDefaults: { qf: 75 } },
    );
    expect(r.source).toBe("stage_default");
    expect(r.offsetMinutesApplied).toBe(75);
    expect(r.effectiveLockAt?.getTime()).toBe(anchor.getTime() - 75 * 60_000);
  });

  it("per-stage default applies to day-scope preview when matchday override is null", () => {
    const anchor = new Date("2026-07-05T18:00:00Z");
    const r = previewCustomBetLock(
      { scope: "day", anchor, stage: "qf" },
      { ...baseContext, stageDefaults: { qf: 75 } },
    );
    expect(r.source).toBe("stage_default");
    expect(r.offsetMinutesApplied).toBe(75);
  });

  it("per-stage default is ignored for stage/group/tournament scopes", () => {
    const anchor = new Date("2026-07-05T18:00:00Z");
    // Stage-scope bet uses the custom_stage type default, not the
    // per-stage default — even when one happens to be set for the same
    // stage. The per-stage layer is for match/day-anchored bets only.
    const r = previewCustomBetLock(
      { scope: "stage", anchor, stage: "qf" },
      { ...baseContext, stageDefaults: { qf: 75 } },
    );
    expect(r.source).toBe("type_default");
    expect(r.offsetMinutesApplied).toBe(FALLBACK_OFFSET_MINUTES.custom_stage);
  });

  it("matchday override beats the per-stage default in preview", () => {
    const anchor = new Date("2026-07-05T18:00:00Z");
    const r = previewCustomBetLock(
      {
        scope: "match",
        anchor,
        stage: "qf",
        matchdayLockOffsetMinutes: 30,
      },
      { ...baseContext, stageDefaults: { qf: 75 } },
    );
    expect(r.source).toBe("matchday_override");
    expect(r.offsetMinutesApplied).toBe(30);
  });
});
