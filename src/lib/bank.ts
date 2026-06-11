import "server-only";

import { sql, type SQL } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { db } from "@/db";
import { execFirstRow } from "@/db/helpers";

// Cache tag used by every action that can change this user's bank
// (match bet placement, custom-bet pick, duel open/join/cancel, admin
// point adjustment). Existing revalidatePath("/", "layout") calls also
// invalidate Data Cache entries so adding revalidateTag is additive
// precision rather than required correctness.
export function bankCacheTag(userId: string): string {
  return `bank:${userId}`;
}

// Points bank helper. The bank is computed live from existing tables - there
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

// Per-row SQL CASE that resolves a single duel to this user's net point
// change. The CASE references `d.*` columns so the caller must select
// from `public.duels d`. `userRef` accepts either a JS string (a literal
// userId, parameterised by drizzle) or a raw SQL fragment (e.g. `p.id`
// inside a CTE that joins profiles). See
// _plans/2026-05-27-betting-overhaul.md §7.3 for the rule table.
//
// Exported because the leaderboard, profile-stats, my-duels and
// bank-stats queries all embed the same arithmetic — keeping a single
// source of truth means the netting rules cannot drift between surfaces.
export function duelCaseSql(userRef: string | SQL): SQL {
  return sql`case
    when d.status = 'open' and d.opener_id = ${userRef} then -d.stake
    when d.status = 'matched' and (d.opener_id = ${userRef} or d.joiner_id = ${userRef}) then -d.stake
    when d.status = 'settled' and d.opener_id = ${userRef}
      then case when d.resolved_value = d.opener_answer then d.stake else -d.stake end
    when d.status = 'settled' and d.joiner_id = ${userRef}
      then case when d.resolved_value = d.opener_answer then -d.stake else d.stake end
    else 0
  end`;
}

// Aggregate variant of `duelCaseSql`: sums the per-duel deltas across
// every duel the user is on either side of, excluding cancelled rows
// (cancelled = refunded → 0). Returns 0 if the user has no duels.
export function duelDeltaSql(userRef: string | SQL): SQL {
  return sql`coalesce((
    select sum(${duelCaseSql(userRef)})::int
    from public.duels d
    where (d.opener_id = ${userRef} or d.joiner_id = ${userRef})
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

// The actual SQL of the bank breakdown. Pulled out so it can run both
// uncached (for actions that just mutated and need the latest number)
// and cached (for the bank pill in the layout that re-renders on
// every navigation).
async function loadBankBreakdownFromDb(userId: string): Promise<BankBreakdown> {
  const r = await execFirstRow<{
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

// Public read: cached across requests per-userId. The bank pill in the
// header asks for this on every navigation; without caching that was 6
// sub-queries (settings + match_bets + custom_bets + duels both sides +
// adjustments) per nav. The cache survives until a bet/duel/adjust
// mutation triggers revalidatePath, which busts the Data Cache entry
// along with the route cache. Short revalidate window as a backstop
// in case a mutation path is ever missed.
export async function getBankBreakdown(userId: string): Promise<BankBreakdown> {
  const cached = unstable_cache(
    async () => loadBankBreakdownFromDb(userId),
    ["bank-breakdown", userId],
    { tags: [bankCacheTag(userId)], revalidate: 120 },
  );
  return cached();
}

// Single placement guard used by every stake-bearing path
// (live custom-bet picks, duel open, duel join). Rules:
//
//   1. If the bank is already negative AND the kill-switch is on, reject —
//      the player must recover to >= 0 via free bets / admin adjustment
//      before placing more live-bet / duel stakes.
//   2. Otherwise the bet is allowed as long as `balance - stake >= -maxOverdraft`,
//      i.e. a single placement may push the bank to at most -maxOverdraft.
//
// When `lockWhenNegative` is false the legacy behavior wins: any bet that
// would drop the bank below -maxOverdraft is rejected; balance < 0 by itself
// is NOT a lock condition. Setting `maxOverdraft = 0` collapses this to the
// pre-feature "balance >= stake" rule.
//
// Pure function so it's unit-testable without spinning a DB. Callers pass
// the already-read balance + the snapshot settings.
//
// See _plans/2026-06-11-negative-balance-lock.md.
export type BettingGuardResult =
  | { ok: true }
  | { ok: false; reason: "negative_balance_locked"; balance: number }
  | { ok: false; reason: "overdraft_exceeded"; balance: number; cap: number; needed: number };

export function assertBettingAllowed(opts: {
  balance: number;
  stake: number;
  maxOverdraft: number;
  lockWhenNegative: boolean;
}): BettingGuardResult {
  const { balance, stake, maxOverdraft, lockWhenNegative } = opts;
  if (lockWhenNegative && balance < 0) {
    return { ok: false, reason: "negative_balance_locked", balance };
  }
  // After this placement the bank would sit at `balance - stake`. Allowed
  // floor is `-maxOverdraft`. Anything deeper is rejected.
  const after = balance - stake;
  if (after < -maxOverdraft) {
    return {
      ok: false,
      reason: "overdraft_exceeded",
      balance,
      cap: maxOverdraft,
      needed: -maxOverdraft - after,
    };
  }
  return { ok: true };
}

// Read the two negative-balance knobs in one query. Cheap enough to call
// inside the placement txn — same row already read by other settings
// helpers, but kept separate so this file stays the bank source of truth.
export type OverdraftConfig = {
  maxOverdraft: number;
  lockBetsWhenNegative: boolean;
};

export async function getOverdraftConfig(): Promise<OverdraftConfig> {
  const row = await execFirstRow<OverdraftConfig>(sql`
    select
      max_overdraft           as "maxOverdraft",
      lock_bets_when_negative as "lockBetsWhenNegative"
    from public.settings where id = 1
  `);
  return row ?? { maxOverdraft: 30, lockBetsWhenNegative: true };
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
  const row = await execFirstRow<StakeConfig>(sql`
    select
      starting_bank     as "startingBank",
      scoring_exact     as "scoringExact",
      scoring_outcome   as "scoringOutcome",
      stake_main        as "stakeMain"
    from public.settings where id = 1
  `);
  // The settings row is seeded by migration 0000 and never deleted, so
  // a null here would mean the DB is in an unrecoverable state.
  return row!;
}

// Player-chosen stake config for live (match/day) bets. The bet card
// uses this to render the pill row and mirror the server's payout
// calculation byte-for-byte (so the "potential win" preview on the
// pill matches what gets snapshotted on submit). See migration 0047
// and _plans/2026-06-11-variable-live-bet-stake.md.
export type LiveStakeUiConfig = {
  baseStake: number;
  minStake: number;
  maxStake: number;
  maxPayoutRatio: number;
  maxPayoutCeiling: number;
  houseEdgePct: number;
};

export async function getLiveStakeConfig(): Promise<LiveStakeUiConfig> {
  const row = await execFirstRow<LiveStakeUiConfig>(sql`
    select
      live_odds_base_stake            as "baseStake",
      live_odds_min_stake             as "minStake",
      live_odds_max_stake             as "maxStake",
      live_odds_max_payout_ratio      as "maxPayoutRatio",
      live_odds_max_payout_ceiling    as "maxPayoutCeiling",
      live_odds_house_edge_pct        as "houseEdgePct"
    from public.settings where id = 1
  `);
  // Settings row 1 is seeded at db init; defaults match migration 0047.
  return row ?? {
    baseStake: 3,
    minStake: 1,
    maxStake: 30,
    maxPayoutRatio: 8,
    maxPayoutCeiling: 100,
    houseEdgePct: 5,
  };
}
