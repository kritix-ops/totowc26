// Scopes whose bets carry no stake (free picks) and use the rescaled
// outright payout system instead of the live-odds path.
//
// Three bet scopes share this behaviour:
//   - tournament — single one-shot pick across the whole World Cup
//                  (Champion, top scorer, golden ball, …)
//   - stage      — bets resolving at the end of one stage (e.g.
//                  knockout-round specials, "stage with most goals")
//   - group      — per-group bets (group A winner, group B runner-up, …)
//
// All three are single-option picks that lock early. The 3-point stake
// the live-odds path imposes throttles nothing on a single pick, so we
// drop it. The payouts are rescaled via OUTRIGHT_NOTIONAL_STAKE +
// OUTRIGHT_MAX_PAYOUT so the contribution to total points stays in the
// ~5-20% band (see _plans/2026-05-31-free-tournament-bets-and-rescaled-payouts.md).
//
// Match / day bets remain on the live-odds path (settings.liveOdds*).

export const FREE_PICK_SCOPES = ["tournament", "stage", "group"] as const;

export type FreePickScope = (typeof FREE_PICK_SCOPES)[number];

export function isFreePickScope(scope: string): scope is FreePickScope {
  return (FREE_PICK_SCOPES as readonly string[]).includes(scope);
}

// Outright payout scale. Notional stake is what feeds the
// odds-multiplication step in normalizeOutrightOdds; the actual cost
// charged to the player is always 0. Cap is the same as the default
// settings.liveOddsMaxPayout (25) so a longshot fallback pays no more
// than the live-odds default.
//
// Promote to settings columns only when admin tuning becomes necessary —
// see plan §6 (Settings audit).
export const OUTRIGHT_NOTIONAL_STAKE = 1;
export const OUTRIGHT_MAX_PAYOUT = 25;
export const OUTRIGHT_HOUSE_EDGE_PCT = 5;

// Continuous odds-curve scale (see buildOutrightCurve in
// src/lib/odds-normalize.ts). The favourite of a surface earns the
// floor, the longest priced shot earns the ceiling, interpolated on a
// log-odds scale. Player + tournament-wide team surfaces (top scorer,
// golden ball, champion, runner-up, third) span the wide 20→100 band;
// group winners span 20→50 normalised within each group. See
// _plans/2026-06-01-tournament-payout-curve.md.
export const OUTRIGHT_CURVE_FLOOR = 20;
export const OUTRIGHT_PLAYER_CEILING = 100;
export const OUTRIGHT_GROUP_CEILING = 50;

// Ceiling for a surface's payout curve. Group surfaces (group_A..group_L)
// use the tighter 50-point ceiling; every other outright surface uses 100.
export function outrightCurveCeiling(surface: string): number {
  return surface.startsWith("group_")
    ? OUTRIGHT_GROUP_CEILING
    : OUTRIGHT_PLAYER_CEILING;
}
