import "server-only";

import { cache } from "react";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  BET_TYPE_KEYS,
  betLockDefaults,
  settings,
  type BetTypeKey,
} from "@/db/schema";

// Betting deadlines resolver. Resolution priority for every bet type:
//   1. per-bet override        - match.lock_at_override (1/X/2) OR
//                                custom_bets.lock_at (custom bets, always set)
//   2. per-matchday override   - matchdays.lock_offset_override_minutes
//                                (only for match-score, custom_match, custom_day)
//   3. per-type default        - bet_lock_defaults.offset_minutes
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
// migration 0021.
export const FALLBACK_OFFSET_MINUTES: Record<BetTypeKey, number> = {
  match_score: 5,
  custom_match: 5,
  custom_day: 5,
  custom_stage: 60,
  custom_group: 60,
  custom_tournament: 60,
};

export interface DeadlineContext {
  // bet_type -> minutes-before-anchor
  defaults: Record<BetTypeKey, number>;
  // Admin-chosen tournament start (settings.tournament_start_at). May be null.
  tournamentStartAt: Date | null;
  // Fallback: MIN(matches.kickoff_at). Used when tournamentStartAt is null.
  derivedTournamentStartAt: Date | null;
}

// Loads the context every resolver needs. Cached per request via React
// `cache()` so a page rendering 30 bets does one DB roundtrip, not 30.
export const getDeadlineContext = cache(async (): Promise<DeadlineContext> => {
  try {
    const [defaultsRows, settingsRow, derivedRow] = await Promise.all([
      db
        .select({
          betType: betLockDefaults.betType,
          offsetMinutes: betLockDefaults.offsetMinutes,
        })
        .from(betLockDefaults),
      db
        .select({ tournamentStartAt: settings.tournamentStartAt })
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

    const tournamentStartAt = settingsRow[0]?.tournamentStartAt ?? null;
    const derivedRaw =
      (derivedRow as unknown as Array<{ kickoff_at: string | null }>)[0]
        ?.kickoff_at ?? null;
    const derivedTournamentStartAt = derivedRaw ? new Date(derivedRaw) : null;

    console.info("[deadline context load]", {
      defaults,
      tournamentStartAt: tournamentStartAt
        ? new Date(tournamentStartAt).toISOString()
        : null,
      derivedTournamentStartAt: derivedTournamentStartAt
        ? derivedTournamentStartAt.toISOString()
        : null,
    });

    return {
      defaults,
      tournamentStartAt: tournamentStartAt ? new Date(tournamentStartAt) : null,
      derivedTournamentStartAt,
    };
  } catch (err) {
    console.warn("[deadline context load failed]", { err });
    return {
      defaults: { ...FALLBACK_OFFSET_MINUTES },
      tournamentStartAt: null,
      derivedTournamentStartAt: null,
    };
  }
});

export type DeadlineSource =
  | "per_bet_override"
  | "matchday_override"
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
  // Per-bet absolute override; wins over everything when set.
  lockAtOverride: Date | null;
  // Per-day offset override; null = no override, fall through to type default.
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
  const offset =
    input.matchdayLockOffsetMinutes ?? context.defaults.match_score;
  const source: DeadlineSource =
    input.matchdayLockOffsetMinutes != null
      ? "matchday_override"
      : "type_default";
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
  const dayOverride =
    input.scope === "match" || input.scope === "day"
      ? input.matchdayLockOffsetMinutes ?? null
      : null;
  const offset = dayOverride ?? context.defaults[typeKey];
  const source: DeadlineSource =
    dayOverride != null ? "matchday_override" : "type_default";
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
