import "server-only";
import { execRows, sql } from "@/db/helpers";

// Enumerate the bets a user could still place a pick on — the shared spine of
// both the per-user "Surprise me" bulk fill and the monkey bot's cron fill.
//
// Deliberately LOOSE: we return bets that are open and have no pick from this
// user yet, with a coarse lock_at > now() filter. The authoritative,
// race-safe deadline + status + never-overwrite checks happen inside the
// write-core's locked transaction (see _plans/2026-06-01-monkey-bot-and-random-fill.md
// §Phase 2). Enumerating slightly stale rows is fine — the writer skips any
// that have since locked or been filled.

// Custom-bet scopes grouped by the surface that renders them. Used to scope
// the per-user "Surprise me" button to the page the player is on. The monkey
// passes ALL_CUSTOM_SCOPES to sweep everything.
export const SURFACE_SCOPES = {
  live: ["match", "day"],
  tournament: ["tournament", "stage"],
  groups: ["group"],
} as const;

export type FillSurface = keyof typeof SURFACE_SCOPES;

export const ALL_CUSTOM_SCOPES: readonly string[] = [
  ...SURFACE_SCOPES.live,
  ...SURFACE_SCOPES.tournament,
  ...SURFACE_SCOPES.groups,
];

export type FillableCustomBet = {
  id: string;
  scope: string;
  answerType: "yes_no" | "number" | "multi_choice" | "free_text";
  answerConfig: unknown;
  stakeSnapshot: number;
  payoutSnapshot: number;
};

export type FillableMatch = {
  matchId: string;
};

// Open custom bets in the given scopes that this user has not picked yet.
export async function listFillableCustomBets(
  userId: string,
  scopes: readonly string[],
): Promise<FillableCustomBet[]> {
  if (scopes.length === 0) return [];
  const scopeList = sql.join(
    scopes.map((s) => sql`${s}`),
    sql`, `,
  );
  return execRows<FillableCustomBet>(sql`
    select
      cb.id::text          as "id",
      cb.scope::text       as "scope",
      cb.answer_type::text as "answerType",
      cb.answer_config     as "answerConfig",
      cb.stake_snapshot    as "stakeSnapshot",
      cb.payout_snapshot   as "payoutSnapshot"
    from public.custom_bets cb
    left join public.user_custom_bet_picks pk
      on pk.custom_bet_id = cb.id and pk.user_id = ${userId}
    where cb.status = 'open'
      and cb.scope::text in (${scopeList})
      and cb.lock_at > now()
      and pk.id is null
    order by cb.lock_at asc
  `);
}

// Live-bet variant scoped to one matchday date. The /bets/live/[date] surface
// is per-date, so its "Surprise me" must fill only that day's match + day
// bets — mirrors the scope filter in getPlayDayDetail.
export async function listFillableLiveBetsForDate(
  userId: string,
  date: string,
): Promise<FillableCustomBet[]> {
  return execRows<FillableCustomBet>(sql`
    select
      cb.id::text          as "id",
      cb.scope::text       as "scope",
      cb.answer_type::text as "answerType",
      cb.answer_config     as "answerConfig",
      cb.stake_snapshot    as "stakeSnapshot",
      cb.payout_snapshot   as "payoutSnapshot"
    from public.custom_bets cb
    left join public.matches   m  on m.id = cb.match_id
    left join public.matchdays md on md.id = cb.matchday_id
    left join public.user_custom_bet_picks pk
      on pk.custom_bet_id = cb.id and pk.user_id = ${userId}
    where cb.status = 'open'
      and cb.lock_at > now()
      and pk.id is null
      and (
        (cb.scope = 'day'   and md.date = ${date}::date) or
        (cb.scope = 'match' and (m.kickoff_at at time zone 'Asia/Jerusalem')::date = ${date}::date)
      )
    order by cb.lock_at asc
  `);
}

// Scheduled matches this user has not placed a 1/X/2 pick on yet. The precise
// per-match deadline (the stage/matchday/global cascade) is resolved by the
// write-core, so this only filters on match status + missing pick.
export async function listFillableMatches(
  userId: string,
): Promise<FillableMatch[]> {
  return execRows<FillableMatch>(sql`
    select m.id::text as "matchId"
    from public.matches m
    left join public.match_bets mb
      on mb.match_id = m.id and mb.user_id = ${userId}
    where m.status = 'scheduled'
      and mb.id is null
    order by m.kickoff_at asc
  `);
}
