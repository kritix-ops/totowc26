import { describe, expect, it } from "vitest";
import {
  deVig1x2,
  expectedTotalFromOU,
  predictScore,
  scoreMatrix,
  type ScoreModelInput,
} from "./score-model";

// Pure-function tests for the realistic score model. Distribution behaviour is
// checked statistically over many Math.random samples with deliberately loose
// bounds so the assertions never flake; the upset cap produces hard guarantees
// (zero underdog wins) which we assert exactly.

function sampleMany(input: ScoreModelInput, n = 4000) {
  let homeWins = 0;
  let awayWins = 0;
  let draws = 0;
  let maxGoals = 0;
  for (let i = 0; i < n; i++) {
    const { home, away } = predictScore(input);
    if (home > away) homeWins++;
    else if (away > home) awayWins++;
    else draws++;
    maxGoals = Math.max(maxGoals, home, away);
  }
  return { homeWins, awayWins, draws, maxGoals, n };
}

describe("deVig1x2", () => {
  it("removes the overround so probabilities sum to 1", () => {
    const p = deVig1x2(2.0, 3.5, 4.0);
    expect(p).not.toBeNull();
    expect(p!.pH + p!.pD + p!.pA).toBeCloseTo(1, 10);
    // Shortest price is the most likely outcome.
    expect(p!.pH).toBeGreaterThan(p!.pA);
  });

  it("rejects non-prices", () => {
    expect(deVig1x2(1.0, 3, 4)).toBeNull();
    expect(deVig1x2(NaN, 3, 4)).toBeNull();
  });
});

describe("expectedTotalFromOU", () => {
  it("returns the line when over and under are evenly priced", () => {
    expect(expectedTotalFromOU(2.5, 1.9, 1.9)).toBeCloseTo(2.5, 6);
  });

  it("pushes the total above the line when the over is cheaper", () => {
    const t = expectedTotalFromOU(2.5, 1.6, 2.3);
    expect(t).not.toBeNull();
    expect(t!).toBeGreaterThan(2.5);
  });

  it("rejects bad input", () => {
    expect(expectedTotalFromOU(0, 1.9, 1.9)).toBeNull();
    expect(expectedTotalFromOU(2.5, 1.0, 1.9)).toBeNull();
  });
});

describe("scoreMatrix", () => {
  it("is a probability distribution summing to ~1", () => {
    const m = scoreMatrix(1.4, 1.1);
    const total = m.reduce((s, row) => s + row.reduce((a, b) => a + b, 0), 0);
    expect(total).toBeGreaterThan(0.99);
    expect(total).toBeLessThanOrEqual(1.0001);
  });
});

describe("predictScore - odds path", () => {
  it("never lets a heavy favourite lose (the Cape Verde 3:0 Spain guard)", () => {
    // Spain ~1.08 to win, draw 11, Cape Verde 26 -> de-vigged pHome ~0.9.
    const input: ScoreModelInput = {
      odds: { win: { home: 1.08, draw: 11, away: 26 } },
    };
    const r = sampleMany(input);
    expect(r.awayWins).toBe(0); // upset cap engaged: underdog cannot win
    expect(r.homeWins).toBeGreaterThan(r.n * 0.6);
    expect(r.maxGoals).toBeLessThanOrEqual(8);
  });

  it("keeps draws available even for a heavy favourite (knockouts can draw)", () => {
    const input: ScoreModelInput = {
      odds: { win: { home: 1.2, draw: 6, away: 12 } },
    };
    const r = sampleMany(input);
    expect(r.draws).toBeGreaterThan(0);
  });

  it("treats evenly-priced teams symmetrically", () => {
    const input: ScoreModelInput = {
      odds: { win: { home: 2.6, draw: 3.2, away: 2.6 } },
    };
    const r = sampleMany(input);
    // Roughly balanced home/away wins, and draws happen.
    expect(Math.abs(r.homeWins - r.awayWins)).toBeLessThan(r.n * 0.18);
    expect(r.draws).toBeGreaterThan(r.n * 0.1);
  });

  it("tags the source as odds", () => {
    expect(
      predictScore({ odds: { win: { home: 2, draw: 3.3, away: 3.6 } } }).source,
    ).toBe("odds");
  });
});

describe("predictScore - rank fallback", () => {
  it("uses ranks when odds are missing and respects the stronger team", () => {
    const input: ScoreModelInput = { rankHome: 5, rankAway: 36 }; // Spain vs Cape Verde
    const r = sampleMany(input);
    expect(r.awayWins).toBe(0); // big rank gap -> upset cap engaged
    expect(r.homeWins).toBeGreaterThan(r.n * 0.6);
  });

  it("is roughly even for adjacent ranks", () => {
    const r = sampleMany({ rankHome: 11, rankAway: 10 });
    expect(Math.abs(r.homeWins - r.awayWins)).toBeLessThan(r.n * 0.2);
    expect(r.draws).toBeGreaterThan(r.n * 0.1);
  });

  it("tags the source as rank", () => {
    expect(predictScore({ rankHome: 3, rankAway: 20 }).source).toBe("rank");
  });

  it("falls back to rank when the odds lack a 1X2 market", () => {
    const input: ScoreModelInput = {
      odds: { total: { line: 2.5, over: 1.9, under: 1.9 } },
      rankHome: 4,
      rankAway: 40,
    };
    expect(predictScore(input).source).toBe("rank");
  });
});

describe("predictScore - default fallback", () => {
  it("returns a sane scoreline tagged default when nothing is known", () => {
    const p = predictScore({});
    expect(p.source).toBe("default");
    expect(p.home).toBeGreaterThanOrEqual(0);
    expect(p.away).toBeGreaterThanOrEqual(0);
    expect(p.home).toBeLessThanOrEqual(5);
    expect(p.away).toBeLessThanOrEqual(5);
  });
});
