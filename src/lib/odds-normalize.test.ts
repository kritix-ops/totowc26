import { describe, expect, it } from "vitest";
import { normalizeOdds, normalizeOutrightOdds } from "./odds-normalize";

// Pure-function tests for the two odds-to-payout transforms.
//
// `normalizeOdds` powers live (match/day) bets — the player puts down
// a real stake and gets stake+payout on a correct pick.
//
// `normalizeOutrightOdds` powers tournament/stage/group bets — the
// player puts down NOTHING. The notional stake is only the multiplier
// in the formula. See _plans/2026-05-31-free-tournament-bets-and-rescaled-payouts.md.

describe("normalizeOdds (live bets)", () => {
  it("applies house edge and rounds half-up", () => {
    // 3 × 2.0 × 0.95 = 5.7 → 6 (half-up).
    const r = normalizeOdds(2.0, { baseStake: 3, maxPayout: 25, houseEdgePct: 5 });
    expect(r).toEqual({ stake: 3, payout: 6 });
  });

  it("caps at maxPayout for longshots", () => {
    const r = normalizeOdds(100, { baseStake: 3, maxPayout: 25, houseEdgePct: 5 });
    expect(r.payout).toBe(25);
  });

  it("floors at stake + 1 even for a heavy favourite", () => {
    // 3 × 1.05 × 0.95 = 2.99 → 3. Floor pushes to stake + 1 = 4.
    const r = normalizeOdds(1.05, { baseStake: 3, maxPayout: 25, houseEdgePct: 5 });
    expect(r.payout).toBe(4);
  });
});

describe("normalizeOutrightOdds (free tournament picks)", () => {
  // Anchor archetypes from the rescale rationale in
  // _plans/2026-05-31-free-tournament-bets-and-rescaled-payouts.md §1.
  // Notional unit 1, cap 25, 5 % edge.

  const config = { notionalStake: 1, maxPayout: 25, houseEdgePct: 5 };

  it("Mbappé favourite (~6:1) → 6", () => {
    // 1 × 6.0 × 0.95 = 5.7 → 6 half-up.
    expect(normalizeOutrightOdds(6.0, config).payout).toBe(6);
  });

  it("Haaland tier (~15:1) → 14", () => {
    // 1 × 15.0 × 0.95 = 14.25 → 14.
    expect(normalizeOutrightOdds(15.0, config).payout).toBe(14);
  });

  it("longshot (~30:1) caps at 25", () => {
    // 1 × 30 × 0.95 = 28.5 → 29, capped at 25.
    expect(normalizeOutrightOdds(30.0, config).payout).toBe(25);
  });

  it("deep longshot (80:1) stays at the cap", () => {
    expect(normalizeOutrightOdds(80.0, config).payout).toBe(25);
  });

  it("floors at notional + 1 for a near-guaranteed favourite", () => {
    // 1 × 1.05 × 0.95 = 0.9975 → 1. Floor pushes to notional + 1 = 2.
    expect(normalizeOutrightOdds(1.05, config).payout).toBe(2);
  });

  it("degenerate decimalOdds=1 returns the minimum", () => {
    // Internal safe-odds branch swaps to 1.01; payout floors at 2.
    expect(normalizeOutrightOdds(1.0, config).payout).toBe(2);
  });

  it("respects a tighter cap when admin lowers maxPayout", () => {
    const r = normalizeOutrightOdds(30, { ...config, maxPayout: 15 });
    expect(r.payout).toBe(15);
  });

  it("zero house edge inflates the payout per the formula", () => {
    // 1 × 6 × 1.0 = 6 → 6 (no edge change at this odds level).
    const r = normalizeOutrightOdds(6, { ...config, houseEdgePct: 0 });
    expect(r.payout).toBe(6);
  });
});
