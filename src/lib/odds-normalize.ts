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
  const payout = computeOddsPayout(decimalOdds, {
    notionalStake: stake,
    maxPayout: config.maxPayout,
    houseEdgePct: config.houseEdgePct,
  });
  return { stake, payout };
}

// Outright/free-pick variant. Same formula as normalizeOdds but the
// caller charges nothing (stake 0) — `notionalStake` is only the
// multiplier feeding the odds calculation. Used by tournament/stage/group
// scope bets where the player puts no points down. See
// _plans/2026-05-31-free-tournament-bets-and-rescaled-payouts.md.
export type OutrightNormConfig = {
  notionalStake: number;
  maxPayout: number;
  houseEdgePct: number;
};

export function normalizeOutrightOdds(
  decimalOdds: number,
  config: OutrightNormConfig,
): { payout: number } {
  return { payout: computeOddsPayout(decimalOdds, config) };
}

// Surface-level payout curve for free-pick outright bets (top scorer,
// golden ball, champion, runner-up, third, group winners). Unlike
// normalizeOutrightOdds — a per-option multiplicative price — this maps
// every option's decimal odds onto a [floor, ceiling] band by its
// position on a LOGARITHMIC odds scale spanning the surface's own
// min..max priced odds. The favourite (lowest odds) earns `floor`, the
// longest priced shot earns `ceiling`, and everything between is
// interpolated on ln(odds) so the heavy skew of outright markets (a 7.0
// favourite next to a 500.0 longshot) spreads smoothly instead of
// bunching every realistic pick near the floor.
//
// Players absent from the snapshot (the long tail with no odds) are the
// deepest longshots; they are not passed here and resolve to the
// bet-level fallback, which callers set to `ceiling`.
//
// Returns a closure so a caller prices a whole surface against one
// shared min/max. See _plans/2026-06-01-tournament-payout-curve.md.
export type OutrightCurveConfig = {
  // Payout for the surface favourite (lowest odds). E.g. 20.
  floor: number;
  // Payout for the longest priced shot (highest odds). E.g. 100 for
  // player/tournament surfaces, 50 for group winners.
  ceiling: number;
};

export function buildOutrightCurve(
  allDecimalOdds: number[],
  config: OutrightCurveConfig,
): (decimalOdds: number) => number {
  const floor = Math.round(config.floor);
  const ceiling = Math.round(config.ceiling);
  const valid = allDecimalOdds.filter((o) => Number.isFinite(o) && o > 1);
  const minOdds = valid.length > 0 ? Math.min(...valid) : 0;
  const maxOdds = valid.length > 0 ? Math.max(...valid) : 0;
  const lnMin = Math.log(minOdds);
  const lnSpan = Math.log(maxOdds) - lnMin;

  return (decimalOdds: number): number => {
    // Degenerate surfaces (no valid odds → lnSpan is NaN, or a single
    // distinct value → lnSpan is 0) and any sub-1 odds collapse to the
    // favourite price. `!(lnSpan > 0)` catches NaN, 0 and negatives.
    if (!(lnSpan > 0) || !Number.isFinite(decimalOdds) || decimalOdds <= 1) {
      return floor;
    }
    const t = (Math.log(decimalOdds) - lnMin) / lnSpan;
    const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.round(floor + (ceiling - floor) * clamped);
  };
}

// Shared payout math. Pulled out so normalizeOdds (live, charges stake)
// and normalizeOutrightOdds (free-pick, charges nothing) cannot drift in
// their floor/cap/edge handling.
function computeOddsPayout(
  decimalOdds: number,
  config: { notionalStake: number; maxPayout: number; houseEdgePct: number },
): number {
  const notional = clampPositiveInt(config.notionalStake, 1);
  // Bookmaker decimal odds are always > 1; guard the rare degenerate
  // case (1.0 means a guaranteed-pay market) by returning the minimum
  // viable payout instead of throwing.
  const safeOdds = decimalOdds > 1 ? decimalOdds : 1.01;
  const houseEdgeFactor =
    (100 - clampInRange(config.houseEdgePct, 0, 50)) / 100;
  const rawPayout = notional * safeOdds * houseEdgeFactor;

  // Round half-up so a fair odds of 2.0 with notional 3 yields a payout
  // of 6 rather than 5 (Math.round handles .5 → next even on some
  // engines; we use a fixed +0.5 floor for predictability).
  let payout = Math.floor(rawPayout + 0.5);

  const cap = clampPositiveInt(config.maxPayout, notional + 1);
  if (payout > cap) payout = cap;
  // Floor at notional + 1 so even a heavy favourite still pays at least
  // +1 net on a correct pick. The minimum-1 net keeps every market
  // meaningful even after the house edge crunches the payout.
  if (payout <= notional) payout = notional + 1;

  return payout;
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
