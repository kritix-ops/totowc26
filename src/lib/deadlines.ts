import "server-only";

import { cache } from "react";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  BET_TYPE_KEYS,
  STAGE_KEYS,
  betLockDefaults,
  settings,
  stageLockDefaults,
  type BetTypeKey,
  type StageKey,
} from "@/db/schema";

// Betting deadlines resolver. Resolution priority for every bet type:
//   1. per-bet override        - match.lock_at_override (1/X/2) OR
//                                custom_bets.lock_at (custom bets, always set)
//   2. global match-picks cap  - settings.match_picks_global_lock_at
//                                (match_score only — single absolute cutoff
//                                for every 1/X/2 pick across the tournament)
//   3. per-matchday override   - matchdays.lock_offset_override_minutes
//                                (only for match_score, custom_match, custom_day)
//   4. per-stage default       - stage_lock_defaults[match.stage]
//                                (only for match_score, custom_match, custom_day)
//                                Lets the admin set "all R16 days lock 90 min
//                                before kickoff" without walking the matchday
//                                list. See _plans/2026-05-28-stage-default-layer.md.
//   5. per-type default        - bet_lock_defaults.offset_minutes
//
// The anchor that the offset is subtracted from depends on the bet type:
//   match_score / custom_match  -> match.kickoff_at
//   custom_day                  -> earliest kickoff on the matchday
//   custom_stage                -> earliest kickoff in that stage
//   custom_group                -> earliest kickoff in that group
//   custom_tournament           -> settings.tournament_start_at, falling
//                                  back to MIN(matches.kickoff_at) so a
//                                  fresh install (admin hasn't set it) still
//                                  produces a sane time.
//
// Custom bets always carry a concrete `lock_at` on the row (per-bet
// override is layer 3 and required by the schema), so resolveCustomBetLock
// echoes that back. The "use defaults" admin checkbox uses previewCustomBetLock
// to compute what the time *would* be, then writes it onto the bet.
// See _plans/2026-05-27-betting-deadlines.md.

// Fallback defaults if bet_lock_defaults is empty (never expected post-
// migration but defends against a truncated table). Mirrors the seed in
// migrations 0021 + 0029. match_score is rarely consulted in practice
// because matchPicksGlobalLockAt overrides it for the whole tournament;
// the 60-minute value is the safety net for an admin who clears the
// global cap.
export const FALLBACK_OFFSET_MINUTES: Record<BetTypeKey, number> = {
  match_score: 60,
  custom_match: 60,
  custom_day: 60,
  custom_stage: 60,
  custom_group: 60,
  custom_tournament: 60,
};

export interface DeadlineContext {
  // bet_type -> minutes-before-anchor
  defaults: Record<BetTypeKey, number>;
  // stage -> minutes-before-anchor. Sparse: only stages an admin has
  // saved a value for appear here. Affects match_score / custom_match /
  // custom_day; sits between matchday override and type default.
  stageDefaults: Partial<Record<StageKey, number>>;
  // Admin-chosen tournament start (settings.tournament_start_at). May be null.
  tournamentStartAt: Date | null;
  // Fallback: MIN(matches.kickoff_at). Used when tournamentStartAt is null.
  derivedTournamentStartAt: Date | null;
  // Single absolute cutoff for every 1/X/2 match pick. When set, wins
  // over matchday overrides and the per-type default (per-bet override
  // on the match row still wins above it). Null = fall back to cascade.
  matchPicksGlobalLockAt: Date | null;
}

// Loads the context every resolver needs. Cached per request via React
// `cache()` so a page rendering 30 bets does one DB roundtrip, not 30.
export const getDeadlineContext = cache(async (): Promise<DeadlineContext> => {
  try {
    const [defaultsRows, stageRows, settingsRow, derivedRow] = await Promise.all([
      db
        .select({
          betType: betLockDefaults.betType,
          offsetMinutes: betLockDefaults.offsetMinutes,
        })
        .from(betLockDefaults),
      db
        .select({
          stage: stageLockDefaults.stage,
          offsetMinutes: stageLockDefaults.offsetMinutes,
        })
        .from(stageLockDefaults),
      db
        .select({
          tournamentStartAt: settings.tournamentStartAt,
          matchPicksGlobalLockAt: settings.matchPicksGlobalLockAt,
        })
        .from(settings)
        .where(eq(settings.id, 1))
        .limit(1),
      db.execute<{ kickoff_at: string | null }>(sql`
        select min(kickoff_at) as kickoff_at from public.matches
      `),
    ]);

    const defaults: Record<BetTypeKey, number> = { ...FALLBACK_OFFSET_MINUTES };
    for (const r of defaultsRows) {
      if ((BET_TYPE_KEYS as readonly string[]).includes(r.betType)) {
        defaults[r.betType] = r.offsetMinutes;
      }
    }

    const stageDefaults: Partial<Record<StageKey, number>> = {};
    for (const r of stageRows) {
      if ((STAGE_KEYS as readonly string[]).includes(r.stage)) {
        stageDefaults[r.stage as StageKey] = r.offsetMinutes;
      }
    }

    const tournamentStartAt = settingsRow[0]?.tournamentStartAt ?? null;
    const matchPicksGlobalLockAt =
      settingsRow[0]?.matchPicksGlobalLockAt ?? null;
    const derivedRaw =
      (derivedRow as unknown as Array<{ kickoff_at: string | null }>)[0]
        ?.kickoff_at ?? null;
    const derivedTournamentStartAt = derivedRaw ? new Date(derivedRaw) : null;

    console.info("[deadline context load]", {
      defaults,
      stageDefaults,
      tournamentStartAt: tournamentStartAt
        ? new Date(tournamentStartAt).toISOString()
        : null,
      matchPicksGlobalLockAt: matchPicksGlobalLockAt
        ? new Date(matchPicksGlobalLockAt).toISOString()
        : null,
      derivedTournamentStartAt: derivedTournamentStartAt
        ? derivedTournamentStartAt.toISOString()
        : null,
    });

    return {
      defaults,
      stageDefaults,
      tournamentStartAt: tournamentStartAt ? new Date(tournamentStartAt) : null,
      matchPicksGlobalLockAt: matchPicksGlobalLockAt
        ? new Date(matchPicksGlobalLockAt)
        : null,
      derivedTournamentStartAt,
    };
  } catch (err) {
    console.warn("[deadline context load failed]", { err });
    return {
      defaults: { ...FALLBACK_OFFSET_MINUTES },
      stageDefaults: {},
      tournamentStartAt: null,
      matchPicksGlobalLockAt: null,
      derivedTournamentStartAt: null,
    };
  }
});

export type DeadlineSource =
  | "per_bet_override"
  | "global_match_picks_cap"
  | "matchday_override"
  | "stage_default"
  | "type_default";

export interface ResolveResult {
  effectiveLockAt: Date;
  source: DeadlineSource;
  // null when source is per_bet_override (the time is absolute, no offset applied).
  appliedOffsetMinutes: number | null;
  anchor: Date;
}

// 1/X/2 score bet on this match.
export interface MatchScoreResolveInput {
  matchId: string;
  kickoffAt: Date;
  // Tournament stage of this match. Used to look up
  // context.stageDefaults; passing it always (vs. only when a stage
  // default exists) keeps callers stateless — they don't need to know
  // whether any stage row is set.
  stage: StageKey;
  // Per-bet absolute override; wins over everything when set.
  lockAtOverride: Date | null;
  // Per-day offset override; null = no override, fall through to stage
  // default and then type default.
  matchdayLockOffsetMinutes: number | null;
}

export function resolveMatchScoreLock(
  input: MatchScoreResolveInput,
  context: DeadlineContext,
): ResolveResult {
  if (input.lockAtOverride) {
    const result: ResolveResult = {
      effectiveLockAt: input.lockAtOverride,
      source: "per_bet_override",
      appliedOffsetMinutes: null,
      anchor: input.kickoffAt,
    };
    logResolve("match_score", input.matchId, result);
    return result;
  }
  // Global cap wins over matchday + stage + type-default cascades. The
  // pool's rule is "all match picks close at one absolute moment" — the
  // per-day, per-stage, and per-type offsets only kick in when an admin
  // has cleared the global value.
  if (context.matchPicksGlobalLockAt) {
    const result: ResolveResult = {
      effectiveLockAt: context.matchPicksGlobalLockAt,
      source: "global_match_picks_cap",
      appliedOffsetMinutes: null,
      anchor: input.kickoffAt,
    };
    logResolve("match_score", input.matchId, result);
    return result;
  }
  const { offset, source } = pickOffsetForMatchOrDay({
    matchdayOverride: input.matchdayLockOffsetMinutes,
    stage: input.stage,
    context,
    typeKey: "match_score",
  });
  const effectiveLockAt = new Date(
    input.kickoffAt.getTime() - offset * 60_000,
  );
  const result: ResolveResult = {
    effectiveLockAt,
    source,
    appliedOffsetMinutes: offset,
    anchor: input.kickoffAt,
  };
  logResolve("match_score", input.matchId, result);
  return result;
}

// Shared cascade for match_score / custom_match / custom_day. Returns
// the offset and which layer it came from. Centralized so a future
// change to the matchday/stage/type ordering only edits one spot.
function pickOffsetForMatchOrDay(args: {
  matchdayOverride: number | null;
  stage: StageKey | null;
  context: DeadlineContext;
  typeKey: BetTypeKey;
}): { offset: number; source: DeadlineSource } {
  if (args.matchdayOverride != null) {
    return { offset: args.matchdayOverride, source: "matchday_override" };
  }
  const stageOffset =
    args.stage != null ? args.context.stageDefaults[args.stage] : undefined;
  if (stageOffset != null) {
    return { offset: stageOffset, source: "stage_default" };
  }
  return { offset: args.context.defaults[args.typeKey], source: "type_default" };
}

// Custom bets always carry a concrete lockAt (NOT NULL in the schema),
// so this is a thin pass-through with logging. The indirection is what
// lets the rest of the codebase target a single resolver API instead of
// reaching into `bet.lockAt` directly, and gives us one place to log.
export function resolveCustomBetLock(bet: {
  id: string;
  scope: "match" | "day" | "stage" | "group" | "tournament";
  lockAt: Date;
}): ResolveResult {
  const result: ResolveResult = {
    effectiveLockAt: bet.lockAt,
    source: "per_bet_override",
    appliedOffsetMinutes: null,
    anchor: bet.lockAt,
  };
  logResolve(`custom_${bet.scope}`, bet.id, result);
  return result;
}

// Used by the admin BetForm to suggest a lock time when creating or
// editing a custom bet. The admin can accept the suggestion or override
// manually; either way the chosen value is what lands on bet.lockAt.
export interface PreviewInput {
  scope: "match" | "day" | "stage" | "group" | "tournament";
  // Pre-computed anchor for this scope. Caller queries the relevant
  // MIN(kickoff_at) once. null = anchor not yet known (e.g. stage has
  // no fixtures); preview returns null too.
  anchor: Date | null;
  // Only meaningful for scope='match' and scope='day'. Ignored otherwise.
  matchdayLockOffsetMinutes?: number | null;
  // Only meaningful for scope='match' (the match's stage) and
  // scope='day' (stage of the earliest match on that day). Ignored for
  // stage/group/tournament — those scopes already have their own
  // per-type anchor and don't fall through stage defaults. Optional so
  // older callers that haven't been updated still type-check.
  stage?: StageKey | null;
}

export interface PreviewResult {
  effectiveLockAt: Date | null;
  offsetMinutesApplied: number;
  source: DeadlineSource;
  anchor: Date | null;
}

export function previewCustomBetLock(
  input: PreviewInput,
  context: DeadlineContext,
): PreviewResult {
  const typeKey = scopeToTypeKey(input.scope);
  // Stage default + matchday override only apply to match/day scopes.
  // Stage/group/tournament scopes have their own per-type anchor and
  // skip straight to the type default.
  const isMatchOrDay = input.scope === "match" || input.scope === "day";
  const { offset, source } = isMatchOrDay
    ? pickOffsetForMatchOrDay({
        matchdayOverride: input.matchdayLockOffsetMinutes ?? null,
        stage: input.stage ?? null,
        context,
        typeKey,
      })
    : { offset: context.defaults[typeKey], source: "type_default" as const };
  const anchor =
    input.scope === "tournament"
      ? context.tournamentStartAt ?? context.derivedTournamentStartAt
      : input.anchor;
  const effectiveLockAt = anchor
    ? new Date(anchor.getTime() - offset * 60_000)
    : null;
  return { effectiveLockAt, offsetMinutesApplied: offset, source, anchor };
}

function scopeToTypeKey(
  scope: "match" | "day" | "stage" | "group" | "tournament",
): BetTypeKey {
  switch (scope) {
    case "match":
      return "custom_match";
    case "day":
      return "custom_day";
    case "stage":
      return "custom_stage";
    case "group":
      return "custom_group";
    case "tournament":
      return "custom_tournament";
  }
}

function logResolve(type: string, id: string, r: ResolveResult): void {
  console.info("[deadline resolve]", {
    type,
    id,
    source: r.source,
    appliedOffsetMinutes: r.appliedOffsetMinutes,
    effectiveLockAt: r.effectiveLockAt.toISOString(),
    anchor: r.anchor.toISOString(),
  });
}
