import "server-only";

import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";

// Points bank helper. The bank is computed live from existing tables — there
// is no materialised balance column. Every read is one SQL roundtrip.
//
// balance = settings.starting_bank
//         + Σ match_bets.points_earned                 (1/X/2 scoring)
//         + Σ user_custom_bet_picks(payout − stake)    (live-bet net)
//         + duelDelta                                  (see §7.3)
//         + Σ point_adjustments.delta
//
// duelDelta sums every duel the user is on either side of:
//   open + opener=me                    →  -stake (in-flight debit)
//   matched + (opener=me OR joiner=me)  →  -stake (in-flight debit)
//   settled, opener=me  + resolved=opener_answer →  +stake
//                       + resolved!=opener_answer →  −stake
//   settled, joiner=me  + resolved=opener_answer →  −stake
//                       + resolved!=opener_answer →  +stake
//   cancelled  →  0 (refunded)
//
// See _plans/2026-05-25-points-bank-system.md §5 and
// _plans/2026-05-27-betting-overhaul.md §7.3 for the design rationale.

export type BankBreakdown = {
  starting: number;
  payoutsEarned: number;
  stakesPaid: number;
  duelDelta: number;
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
        select sum(coalesce(mb.points_earned, 0))::int
        from public.match_bets mb where mb.user_id = ${userId}
      ), 0)
    + coalesce((
        select sum(coalesce(pk.points_earned, 0) - pk.stake_paid)::int
        from public.user_custom_bet_picks pk where pk.user_id = ${userId}
      ), 0)
    + ${duelDeltaSql(userId)}
    + coalesce((
        select sum(pa.delta)::int
        from public.point_adjustments pa where pa.user_id = ${userId}
      ), 0)
  )::int`;
}

// SQL expression returning the user's net change from every duel they
// are on either side of. See _plans/2026-05-27-betting-overhaul.md §7.3
// for the rule table this CASE mirrors.
function duelDeltaSql(userId: string): SQL {
  return sql`coalesce((
    select sum(
      case
        when d.status = 'open' and d.opener_id = ${userId} then -d.stake
        when d.status = 'matched' and (d.opener_id = ${userId} or d.joiner_id = ${userId}) then -d.stake
        when d.status = 'settled' and d.opener_id = ${userId}
          then case when d.resolved_value = d.opener_answer then d.stake else -d.stake end
        when d.status = 'settled' and d.joiner_id = ${userId}
          then case when d.resolved_value = d.opener_answer then -d.stake else d.stake end
        else 0
      end
    )::int
    from public.duels d
    where (d.opener_id = ${userId} or d.joiner_id = ${userId})
      and d.status <> 'cancelled'
  ), 0)`;
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
    duel_delta: number;
    adjustments: number;
  }>(sql`
    select
      (select starting_bank from public.settings where id = 1)::int as "starting",

      coalesce((
        select sum(coalesce(mb.points_earned, 0))::int
        from public.match_bets mb where mb.user_id = ${userId}
      ), 0)
      + coalesce((
          select sum(coalesce(pk.points_earned, 0))::int
          from public.user_custom_bet_picks pk where pk.user_id = ${userId}
        ), 0)
      as "payouts",

      coalesce((
        select sum(pk.stake_paid)::int
        from public.user_custom_bet_picks pk where pk.user_id = ${userId}
      ), 0) as "stakes",

      ${duelDeltaSql(userId)} as "duel_delta",

      coalesce((
        select sum(pa.delta)::int
        from public.point_adjustments pa where pa.user_id = ${userId}
      ), 0) as "adjustments"
  `);
  const r = (rows as unknown as Array<{
    starting: number;
    payouts: number;
    stakes: number;
    duel_delta: number;
    adjustments: number;
  }>)[0];

  const starting = Number(r?.starting ?? 0);
  const payouts = Number(r?.payouts ?? 0);
  const stakes = Number(r?.stakes ?? 0);
  const duelDelta = Number(r?.duel_delta ?? 0);
  const adjustments = Number(r?.adjustments ?? 0);
  return {
    starting,
    payoutsEarned: payouts,
    stakesPaid: stakes,
    duelDelta,
    adjustments,
    balance: starting + payouts - stakes + duelDelta + adjustments,
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

// Settings snapshot used by the main-bet form and the bank widget.
// After the legacy cleanup the only knobs left here are the starting
// bank and the main 1/X/2 scoring values; per-bet pricing lives on
// custom_bets.stake_snapshot / payout_snapshot instead.
export type StakeConfig = {
  startingBank: number;
  scoringExact: number;
  scoringOutcome: number;
  stakeMain: number;
};

export async function getStakeConfig(): Promise<StakeConfig> {
  const rows = await db.execute<StakeConfig>(sql`
    select
      starting_bank     as "startingBank",
      scoring_exact     as "scoringExact",
      scoring_outcome   as "scoringOutcome",
      stake_main        as "stakeMain"
    from public.settings where id = 1
  `);
  const list = rows as unknown as StakeConfig[];
  return list[0];
}
