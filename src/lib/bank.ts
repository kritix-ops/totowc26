import "server-only";

import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";

// Points bank helper. The bank is computed live from existing tables — there
// is no materialised balance column. Every read is one SQL roundtrip.
//
// balance = settings.starting_bank
//         + Σ scoring payouts (match_bets, group_predictions,
//           bracket_predictions, special_bets)
//         − Σ stake_paid_* snapshots from the same tables
//         + Σ point_adjustments.delta
//
// See _plans/2026-05-25-points-bank-system.md §5 for the design rationale.

export type BankBreakdown = {
  starting: number;
  payoutsEarned: number;
  stakesPaid: number;
  adjustments: number;
  balance: number;
};

// Drizzle's tx and the top-level db both expose `execute`. We use a
// structural type so callers can pass either without importing internal
// transaction types.
type DBExec = {
  execute: (query: SQL) => Promise<unknown>;
};

// SQL expression returning the user's current bank balance as a single
// integer. Embedded inside `select ${bankBalanceSql(userId)} as balance`
// so the same formula can run on the top-level db or inside a transaction.
export function bankBalanceSql(userId: string): SQL {
  return sql`(
    (select starting_bank from public.settings where id = 1)::int
    + coalesce((
        select sum(
          coalesce(mb.points_earned,      0) +
          coalesce(mb.points_btts,        0) +
          coalesce(mb.points_over_25,     0) +
          coalesce(mb.points_ht,          0) -
          coalesce(mb.stake_paid_btts,    0) -
          coalesce(mb.stake_paid_over_25, 0) -
          coalesce(mb.stake_paid_ht,      0)
        )::int
        from public.match_bets mb where mb.user_id = ${userId}
      ), 0)
    + coalesce((
        select sum(coalesce(gp.points_earned, 0) - gp.stake_paid)::int
        from public.group_predictions gp where gp.user_id = ${userId}
      ), 0)
    + coalesce((
        select sum(coalesce(bp.points_earned, 0) - bp.stake_paid)::int
        from public.bracket_predictions bp where bp.user_id = ${userId}
      ), 0)
    + coalesce((
        select sum(coalesce(sb.points_earned, 0) - sb.stake_paid)::int
        from public.special_bets sb where sb.user_id = ${userId}
      ), 0)
    + coalesce((
        select sum(coalesce(pk.points_earned, 0) - pk.stake_paid)::int
        from public.user_custom_bet_picks pk where pk.user_id = ${userId}
      ), 0)
    + coalesce((
        select sum(pa.delta)::int
        from public.point_adjustments pa where pa.user_id = ${userId}
      ), 0)
  )::int`;
}

// Read the user's current balance using whichever client is passed (db or
// a tx returned by db.transaction). Inside a transaction this sees in-flight
// stake debits so race conditions cannot let a user double-spend.
export async function getBankBalanceWith(
  client: DBExec,
  userId: string,
): Promise<number> {
  const rows = await client.execute(
    sql`select ${bankBalanceSql(userId)} as balance`,
  );
  const list = rows as unknown as Array<{ balance: number }>;
  return Number(list[0]?.balance ?? 0);
}

export async function getBankBalance(userId: string): Promise<number> {
  return getBankBalanceWith(db, userId);
}

export async function getBankBreakdown(
  userId: string,
): Promise<BankBreakdown> {
  const rows = await db.execute<{
    starting: number;
    payouts: number;
    stakes: number;
    adjustments: number;
  }>(sql`
    select
      (select starting_bank from public.settings where id = 1)::int as "starting",

      coalesce((
        select sum(
          coalesce(mb.points_earned,   0) +
          coalesce(mb.points_btts,     0) +
          coalesce(mb.points_over_25,  0) +
          coalesce(mb.points_ht,       0)
        )::int
        from public.match_bets mb where mb.user_id = ${userId}
      ), 0)
      + coalesce((
          select sum(coalesce(gp.points_earned, 0))::int
          from public.group_predictions gp where gp.user_id = ${userId}
        ), 0)
      + coalesce((
          select sum(coalesce(bp.points_earned, 0))::int
          from public.bracket_predictions bp where bp.user_id = ${userId}
        ), 0)
      + coalesce((
          select sum(coalesce(sb.points_earned, 0))::int
          from public.special_bets sb where sb.user_id = ${userId}
        ), 0)
      + coalesce((
          select sum(coalesce(pk.points_earned, 0))::int
          from public.user_custom_bet_picks pk where pk.user_id = ${userId}
        ), 0)
      as "payouts",

      coalesce((
        select sum(
          coalesce(mb.stake_paid_btts,    0) +
          coalesce(mb.stake_paid_over_25, 0) +
          coalesce(mb.stake_paid_ht,      0)
        )::int
        from public.match_bets mb where mb.user_id = ${userId}
      ), 0)
      + coalesce((
          select sum(gp.stake_paid)::int
          from public.group_predictions gp where gp.user_id = ${userId}
        ), 0)
      + coalesce((
          select sum(bp.stake_paid)::int
          from public.bracket_predictions bp where bp.user_id = ${userId}
        ), 0)
      + coalesce((
          select sum(sb.stake_paid)::int
          from public.special_bets sb where sb.user_id = ${userId}
        ), 0)
      + coalesce((
          select sum(pk.stake_paid)::int
          from public.user_custom_bet_picks pk where pk.user_id = ${userId}
        ), 0)
      as "stakes",

      coalesce((
        select sum(pa.delta)::int
        from public.point_adjustments pa where pa.user_id = ${userId}
      ), 0) as "adjustments"
  `);
  const r = (rows as unknown as Array<{
    starting: number;
    payouts: number;
    stakes: number;
    adjustments: number;
  }>)[0];

  const starting = Number(r?.starting ?? 0);
  const payouts = Number(r?.payouts ?? 0);
  const stakes = Number(r?.stakes ?? 0);
  const adjustments = Number(r?.adjustments ?? 0);
  return {
    starting,
    payoutsEarned: payouts,
    stakesPaid: stakes,
    adjustments,
    balance: starting + payouts - stakes + adjustments,
  };
}

// Take the per-user advisory lock that all bet-submission server actions
// hold while reading the balance and writing the stake snapshot. Without
// this two tabs could race and spend more than the bank holds.
export async function lockUserForBetting(
  client: DBExec,
  userId: string,
): Promise<void> {
  await client.execute(
    sql`select pg_advisory_xact_lock(hashtext(${userId}))`,
  );
}

// All stake costs and gross payouts in one shot, snapshotted for a page
// render. The bet forms use this to show "cost X, +Y if right" labels
// without needing to know which DB column maps to which UI element.
export type StakeConfig = {
  startingBank: number;
  stakeBtts: number;
  stakeOver25: number;
  stakeHt: number;
  stakeGroupTeam: number;
  stakeBracketChampion: number;
  stakeBracketRunnerUp: number;
  stakeBracketThird: number;
  stakeBracketFourth: number;
  stakeTopScorer: number;
  stakeFinalPenalties: number;
  scoringBtts: number;
  scoringOver25: number;
  scoringHtExact: number;
  scoringHtOutcome: number;
  scoringGroupTeam: number;
  scoringGroupPerfect: number;
  scoringChampion: number;
  scoringRunnerUp: number;
  scoringThird: number;
  scoringFourth: number;
  scoringTopScorer: number;
  scoringFinalPenalties: number;
};

export async function getStakeConfig(): Promise<StakeConfig> {
  const rows = await db.execute<StakeConfig>(sql`
    select
      starting_bank             as "startingBank",
      stake_btts                as "stakeBtts",
      stake_over_25             as "stakeOver25",
      stake_ht                  as "stakeHt",
      stake_group_team          as "stakeGroupTeam",
      stake_bracket_champion    as "stakeBracketChampion",
      stake_bracket_runner_up   as "stakeBracketRunnerUp",
      stake_bracket_third       as "stakeBracketThird",
      stake_bracket_fourth      as "stakeBracketFourth",
      stake_top_scorer          as "stakeTopScorer",
      stake_final_penalties     as "stakeFinalPenalties",
      scoring_btts              as "scoringBtts",
      scoring_over_25           as "scoringOver25",
      scoring_ht_exact          as "scoringHtExact",
      scoring_ht_outcome        as "scoringHtOutcome",
      scoring_group_team        as "scoringGroupTeam",
      scoring_group_perfect     as "scoringGroupPerfect",
      scoring_champion          as "scoringChampion",
      scoring_runner_up         as "scoringRunnerUp",
      scoring_third             as "scoringThird",
      scoring_fourth            as "scoringFourth",
      scoring_top_scorer        as "scoringTopScorer",
      scoring_final_penalties   as "scoringFinalPenalties"
    from public.settings where id = 1
  `);
  const list = rows as unknown as StakeConfig[];
  return list[0];
}
