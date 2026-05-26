// Convert a bookmaker's decimal odds into the stake / payout pair our
// point system uses.
//
// Inputs:
//   decimalOdds  - what the bookmaker pays per unit staked. 2.50 means
//                  bet 1 unit, win 2.50 units (1.50 profit on a win).
//   config       - the three settings.liveOdds* knobs (admin tunable).
//
// Output:
//   { stake, payout } - integer stake the user puts down and integer
//                       gross payout (stake + winnings) when the bet
//                       resolves correctly. Net change is payout − stake.
//
// Pure function - no side effects, no DB calls, no fetch. Safe to run
// in client OR server contexts. Tests can call it directly with
// hard-coded inputs.
//
// See _plans/2026-05-27-betting-overhaul.md §6.2 for the formula and
// the rationale behind the house-edge / cap / floor adjustments.

export type OddsNormConfig = {
  // Base stake in points. Default 3.
  baseStake: number;
  // Hard ceiling on gross payout. Default 25. Stops longshot markets
  // (odds 50.0+) from offering 150-point payouts that distort the bank
  // in one bet.
  maxPayout: number;
  // Percentage trimmed off the bookmaker's raw payout. Default 5.
  // Builds in a small house edge so the pool's expected value sums to
  // less than 100% over many bets - keeps the bank from inflating.
  houseEdgePct: number;
};

export type NormalisedPrice = {
  stake: number;
  payout: number;
};

export function normalizeOdds(
  decimalOdds: number,
  config: OddsNormConfig,
): NormalisedPrice {
  const stake = clampPositiveInt(config.baseStake, 1);
  // Bookmaker decimal odds are always > 1; guard the rare degenerate
  // case (1.0 means a guaranteed-pay market) by returning the minimum
  // viable payout instead of throwing.
  const safeOdds = decimalOdds > 1 ? decimalOdds : 1.01;
  const houseEdgeFactor =
    (100 - clampInRange(config.houseEdgePct, 0, 50)) / 100;
  const rawPayout = stake * safeOdds * houseEdgeFactor;

  // Round half-up so a fair odds of 2.0 with stake 3 yields a payout
  // of 6 rather than 5 (Math.round handles .5 → next even on some
  // engines; we use a fixed +0.5 floor for predictability).
  let payout = Math.floor(rawPayout + 0.5);

  const cap = clampPositiveInt(config.maxPayout, stake + 1);
  if (payout > cap) payout = cap;
  // Floor at stake + 1 so even a heavy favourite still pays at least
  // +1 net on a correct pick. The minimum-1 net keeps every market
  // meaningful even after the house edge crunches the payout.
  if (payout <= stake) payout = stake + 1;

  return { stake, payout };
}

function clampPositiveInt(value: number, min: number): number {
  if (!Number.isFinite(value)) return min;
  const n = Math.floor(value);
  return n < min ? min : n;
}

function clampInRange(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
