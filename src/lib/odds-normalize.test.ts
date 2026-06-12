import { describe, expect, it } from "vitest";
import {
  buildOutrightCurve,
  liveStakeCap,
  normalizeOdds,
  normalizeOutrightOdds,
} from "./odds-normalize";

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

describe("buildOutrightCurve (continuous log-odds payout)", () => {
  // The favourite (lowest odds) earns the floor, the longest priced shot
  // earns the ceiling, interpolated on ln(odds). Player/team surfaces use
  // [20,100]; group winners use [20,50]. See
  // _plans/2026-06-01-tournament-payout-curve.md.

  it("maps the favourite to the floor and the longest shot to the ceiling", () => {
    const curve = buildOutrightCurve([10, 100, 1000], { floor: 20, ceiling: 100 });
    expect(curve(10)).toBe(20);
    expect(curve(1000)).toBe(100);
  });

  it("places the geometric-mean odds at the band midpoint", () => {
    // ln(100) is exactly halfway between ln(10) and ln(1000), so t = 0.5
    // → 20 + (100-20) × 0.5 = 60.
    const curve = buildOutrightCurve([10, 100, 1000], { floor: 20, ceiling: 100 });
    expect(curve(100)).toBe(60);
  });

  it("is monotonic non-decreasing across rising odds", () => {
    const curve = buildOutrightCurve([7, 501], { floor: 20, ceiling: 100 });
    const sample = [7, 13, 19, 36, 51, 81, 151, 501];
    for (let i = 1; i < sample.length; i += 1) {
      expect(curve(sample[i])).toBeGreaterThanOrEqual(curve(sample[i - 1]));
    }
  });

  it("matches the published top_scorer anchors (7..501)", () => {
    // Real snapshot range. Mbappé 7 → 20, Yamal 19 → 39, Foster 501 → 100.
    const curve = buildOutrightCurve([7, 19, 501], { floor: 20, ceiling: 100 });
    expect(curve(7)).toBe(20);
    expect(curve(19)).toBe(39);
    expect(curve(501)).toBe(100);
  });

  it("honours the tighter group band (20→50)", () => {
    // Group C real odds: Brazil 1.2 → 20, Scotland 25.253 → 50.
    const curve = buildOutrightCurve([1.2, 7.258, 23.993, 25.253], {
      floor: 20,
      ceiling: 50,
    });
    expect(curve(1.2)).toBe(20);
    expect(curve(25.253)).toBe(50);
    expect(curve(7.258)).toBeGreaterThan(20);
    expect(curve(7.258)).toBeLessThan(50);
  });

  it("collapses to the floor when there is a single distinct odds", () => {
    const curve = buildOutrightCurve([5], { floor: 20, ceiling: 100 });
    expect(curve(5)).toBe(20);
    expect(curve(999)).toBe(20);
  });

  it("collapses to the floor for an empty odds set", () => {
    const curve = buildOutrightCurve([], { floor: 20, ceiling: 100 });
    expect(curve(50)).toBe(20);
  });

  it("clamps odds outside the priced range to the band edges", () => {
    const curve = buildOutrightCurve([10, 1000], { floor: 20, ceiling: 100 });
    expect(curve(5)).toBe(20); // below min → floor
    expect(curve(5000)).toBe(100); // above max → ceiling
  });

  it("returns the floor for degenerate sub-1 odds", () => {
    const curve = buildOutrightCurve([10, 1000], { floor: 20, ceiling: 100 });
    expect(curve(1)).toBe(20);
    expect(curve(0.5)).toBe(20);
  });
});

// Variable-stake payout cap. Cap = min(stake * ratio, ceiling). The
// 8/100 defaults come from _plans/2026-06-11-variable-live-bet-stake.md.
describe("liveStakeCap (variable stake)", () => {
  const cfg = { maxPayoutRatio: 8, maxPayoutCeiling: 100 };

  it("scales linearly while below the ceiling", () => {
    expect(liveStakeCap(1, cfg)).toBe(8);
    expect(liveStakeCap(3, cfg)).toBe(24);
    expect(liveStakeCap(10, cfg)).toBe(80);
  });

  it("clamps to the absolute ceiling at the upper end", () => {
    expect(liveStakeCap(13, cfg)).toBe(100); // 104 → 100
    expect(liveStakeCap(20, cfg)).toBe(100);
    expect(liveStakeCap(30, cfg)).toBe(100);
  });

  it("treats sub-1 stake as 1 (no negative caps)", () => {
    expect(liveStakeCap(0, cfg)).toBe(8);
    expect(liveStakeCap(-5, cfg)).toBe(8);
  });

  it("respects a tighter ratio when admin lowers it", () => {
    expect(liveStakeCap(10, { maxPayoutRatio: 5, maxPayoutCeiling: 100 })).toBe(50);
    expect(liveStakeCap(30, { maxPayoutRatio: 5, maxPayoutCeiling: 100 })).toBe(100);
  });

  it("respects a tighter ceiling when admin lowers it", () => {
    expect(liveStakeCap(10, { maxPayoutRatio: 8, maxPayoutCeiling: 50 })).toBe(50);
    expect(liveStakeCap(3, { maxPayoutRatio: 8, maxPayoutCeiling: 50 })).toBe(24);
  });

  // ceiling = 0 is the "no absolute cap" sentinel (migration 0055): the
  // ratio guard becomes the only ceiling, so a bigger stake always wins
  // proportionally more instead of two stakes colliding on one flat number.
  it("treats ceiling 0 as no absolute cap (ratio guard only)", () => {
    const noCeiling = { maxPayoutRatio: 8, maxPayoutCeiling: 0 };
    expect(liveStakeCap(20, noCeiling)).toBe(160); // 20 * 8, not 100
    expect(liveStakeCap(30, noCeiling)).toBe(240); // 30 * 8, not 100
    expect(liveStakeCap(3, noCeiling)).toBe(24); // small stake unchanged
  });

  it("treats a malformed (negative / non-finite) ceiling as disabled", () => {
    expect(liveStakeCap(30, { maxPayoutRatio: 8, maxPayoutCeiling: -1 })).toBe(240);
    expect(
      liveStakeCap(30, { maxPayoutRatio: 8, maxPayoutCeiling: NaN }),
    ).toBe(240);
  });
});

// End-to-end: player-chosen stake fed through normalizeOdds with the
// matching cap. Validates the corner cases the bet card relies on.
describe("normalizeOdds with player-chosen stake", () => {
  const cap = { maxPayoutRatio: 8, maxPayoutCeiling: 100 };

  it("stake 10 on odds 2.0 yields +9 net (cap not hit)", () => {
    const r = normalizeOdds(2.0, {
      baseStake: 10,
      maxPayout: liveStakeCap(10, cap),
      houseEdgePct: 5,
    });
    // 10 * 2.0 * 0.95 = 19 → cap min(80,100)=80 → 19. Net win +9.
    expect(r).toEqual({ stake: 10, payout: 19 });
  });

  it("stake 30 on longshot odds 10 caps at the ceiling", () => {
    const r = normalizeOdds(10, {
      baseStake: 30,
      maxPayout: liveStakeCap(30, cap),
      houseEdgePct: 5,
    });
    // Raw 30 * 10 * 0.95 = 285. cap = min(240, 100) = 100. Payout 100.
    // Net win = 100 - 30 = +70.
    expect(r).toEqual({ stake: 30, payout: 100 });
  });

  it("stake 1 floors at stake + 1 even on a heavy favourite", () => {
    const r = normalizeOdds(1.05, {
      baseStake: 1,
      maxPayout: liveStakeCap(1, cap),
      houseEdgePct: 5,
    });
    // Raw 1 * 1.05 * 0.95 = 0.9975 → 1. Floor pushes to 2.
    expect(r).toEqual({ stake: 1, payout: 2 });
  });

  it("stake 3 default behaviour matches the pre-migration numbers", () => {
    const r = normalizeOdds(2.0, {
      baseStake: 3,
      maxPayout: liveStakeCap(3, cap),
      houseEdgePct: 5,
    });
    // 3 * 2.0 * 0.95 = 5.7 → 6. Same as the existing default-stake test.
    expect(r).toEqual({ stake: 3, payout: 6 });
  });

  // The MEX–RSA fix: on the VAR red-card bet (odds 6.0), the old 100 ceiling
  // made stake 30 and stake 20 both pay 100, so the bigger staker netted
  // LESS. With the ceiling disabled (ceiling 0) the payout scales with stake
  // again — bigger stake, bigger win.
  it("uncapped (ceiling 0): bigger stake wins proportionally more", () => {
    const noCeiling = { maxPayoutRatio: 8, maxPayoutCeiling: 0 };
    const at30 = normalizeOdds(6.0, {
      baseStake: 30,
      maxPayout: liveStakeCap(30, noCeiling),
      houseEdgePct: 5,
    });
    const at20 = normalizeOdds(6.0, {
      baseStake: 20,
      maxPayout: liveStakeCap(20, noCeiling),
      houseEdgePct: 5,
    });
    // 30 * 6 * 0.95 = 171 (ratio cap 240 not hit). 20 * 6 * 0.95 = 114.
    expect(at30).toEqual({ stake: 30, payout: 171 });
    expect(at20).toEqual({ stake: 20, payout: 114 });
    // Net win for the bigger staker is now strictly larger: +141 vs +94.
    expect(at30.payout - 30).toBeGreaterThan(at20.payout - 20);
  });
});
