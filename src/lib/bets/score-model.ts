// Realistic match-score generator.
//
// Replaces the old team-agnostic random scoreline (which sampled both sides
// from one fixed goal distribution, so Cape Verde and Spain were equally
// likely to score — hence "Cape Verde 3:0 Spain"). This module turns what we
// actually know about a fixture into a per-side scoring rate, builds the
// score-probability matrix, and SAMPLES a scoreline from it. Sampling (not
// taking the single most-likely score) keeps picks varied between users and
// keeps an auto-filled pick deliberately non-optimal, which is the fair
// outcome for someone who didn't fill their own.
//
// Pure: no IO, no DB, injectable RNG. The server-side input resolver lives in
// score-inputs.ts; everything here is unit-testable in isolation.
//
// Approach is the deliberately lean, closed-form one (see
// _plans/2026-06-10-realistic-score-predictor.md): expected total goals from
// the Over/Under line, favourite margin (supremacy) from the Asian handicap or
// the de-vigged 1X2 split, split into two Poisson rates, then an upset cap so a
// heavy favourite is never randomly beaten. No Dixon-Coles, no solver — the
// difference is invisible across a 64-match friends pool.

import { randomMatchScore, type Rng } from "../random-picks";

export type ScoreSource = "odds" | "rank" | "default";

// Decimal odds for one fixture, as stored in live_odds_snapshot. Every field is
// optional — we use whatever is present and fall back when the 1X2 market is
// missing (it is the one we cannot do without).
export type OddsInput = {
  win?: { home: number; draw: number; away: number } | null; // market 1 (1X2)
  total?: { line: number; over: number; under: number } | null; // market 5 main line
  handicap?: { homeLine: number } | null; // market 4 home line, e.g. -1.5
};

export type ScoreModelInput = {
  odds?: OddsInput | null;
  // Team strength ranks (1 = strongest … 48), from TEAM_RANK. Used only when
  // odds are absent or unusable.
  rankHome?: number | null;
  rankAway?: number | null;
};

export type ScorePrediction = {
  home: number;
  away: number;
  source: ScoreSource;
};

// Largest goal tally either side can be assigned. Bounds the score matrix and
// the rare Poisson tail; 8 is already far past any realistic World Cup score.
const MAX_GOALS = 8;
// Mean goals in a World Cup match when we have no total to go on.
const WC_AVERAGE_TOTAL = 2.6;
// Floor on a side's scoring rate so a huge favourite still concedes sometimes
// and the matrix never collapses to a single cell.
const MIN_LAMBDA = 0.15;
// Cap on the favourite's goal margin estimate, both odds- and rank-derived.
const MAX_SUPREMACY = 2.4;
// If the favourite's modelled win probability is at least this high (a clear
// 3-in-4 favourite), we forbid the underdog from winning before sampling
// (draws and favourite wins stay). This is the guardrail that enforces common
// sense — a clear favourite is never handed a loss — while genuinely
// competitive games keep their realistic upset chance. Tunable.
const UPSET_CAP_THRESHOLD = 0.75;
// Goal-margin added per unit of rank gap on the fallback (no-odds) path.
const RANK_SUPREMACY_K = 0.06;
// Maps the de-vigged 1X2 win-probability gap to a goal margin on the odds path
// when no Asian handicap line is available.
const WIN_GAP_TO_SUPREMACY = 2.2;

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

// Strip the bookmaker overround from 1X2 decimal odds, yielding true-ish
// home/draw/away probabilities that sum to 1. Returns null if any leg is
// missing or not a real price (> 1.0).
export function deVig1x2(
  home: number,
  draw: number,
  away: number,
): { pH: number; pD: number; pA: number } | null {
  if (![home, draw, away].every((o) => Number.isFinite(o) && o > 1)) return null;
  const iH = 1 / home;
  const iD = 1 / draw;
  const iA = 1 / away;
  const s = iH + iD + iA;
  if (!(s > 0)) return null;
  return { pH: iH / s, pD: iD / s, pA: iA / s };
}

// Expected total goals from one Over/Under line. The line is the market's
// midpoint; the over/under odds lean nudges the estimate above or below it.
export function expectedTotalFromOU(
  line: number,
  over: number,
  under: number,
): number | null {
  if (!Number.isFinite(line) || line <= 0) return null;
  if (![over, under].every((o) => Number.isFinite(o) && o > 1)) return null;
  const pOver = 1 / over / (1 / over + 1 / under);
  // Each 0.1 of probability above an even split shifts the total ~0.2 goals.
  const total = line + (pOver - 0.5) * 2.0;
  return clamp(total, 1.5, 4.8);
}

function poisson(k: number, lambda: number): number {
  let fact = 1;
  for (let i = 2; i <= k; i++) fact *= i;
  return (Math.exp(-lambda) * lambda ** k) / fact;
}

// Independent-Poisson score-probability matrix. matrix[i][j] = P(home i, away j).
export function scoreMatrix(
  lambdaHome: number,
  lambdaAway: number,
): number[][] {
  const lh = Math.max(MIN_LAMBDA, lambdaHome);
  const la = Math.max(MIN_LAMBDA, lambdaAway);
  const homePmf = Array.from({ length: MAX_GOALS + 1 }, (_, i) => poisson(i, lh));
  const awayPmf = Array.from({ length: MAX_GOALS + 1 }, (_, j) => poisson(j, la));
  return homePmf.map((ph) => awayPmf.map((pa) => ph * pa));
}

// Probability the favourite wins outright, summed over the matrix.
function favouriteWinProbability(
  matrix: number[][],
  favourite: "home" | "away",
): number {
  let p = 0;
  for (let i = 0; i < matrix.length; i++) {
    for (let j = 0; j < matrix[i].length; j++) {
      if (favourite === "home" ? i > j : j > i) p += matrix[i][j];
    }
  }
  return p;
}

// When the favourite is a heavy one, zero out every scoreline where the
// underdog wins and renormalise. Draws and favourite wins are untouched. This
// is what guarantees "no Cape Verde beats Spain" while still allowing the
// occasional draw or narrow win.
function applyUpsetCap(
  matrix: number[][],
  favourite: "home" | "away",
): number[][] {
  const capped = matrix.map((row, i) =>
    row.map((p, j) => ((favourite === "home" ? j > i : i > j) ? 0 : p)),
  );
  const total = capped.reduce((s, row) => s + row.reduce((a, b) => a + b, 0), 0);
  if (!(total > 0)) return matrix; // degenerate guard: keep the original
  return capped.map((row) => row.map((p) => p / total));
}

// Sample one scoreline from a (row-major) probability matrix.
function sampleFromMatrix(
  matrix: number[][],
  rng: Rng,
): { home: number; away: number } {
  let total = 0;
  for (const row of matrix) for (const p of row) if (p > 0) total += p;
  if (!(total > 0)) return { home: 0, away: 0 };
  let r = rng() * total;
  for (let i = 0; i < matrix.length; i++) {
    for (let j = 0; j < matrix[i].length; j++) {
      const p = matrix[i][j];
      if (p <= 0) continue;
      r -= p;
      if (r < 0) return { home: i, away: j };
    }
  }
  return { home: 0, away: 0 }; // floating-point guard
}

// Build a (favourite-capped) score matrix from a total + supremacy pair, then
// sample it. Shared by the odds and rank paths.
function sampleFromTotalSupremacy(
  total: number,
  supremacy: number,
  rng: Rng,
): { home: number; away: number } {
  const sup = clamp(supremacy, -MAX_SUPREMACY, MAX_SUPREMACY);
  const lambdaHome = (total + sup) / 2;
  const lambdaAway = (total - sup) / 2;
  const matrix = scoreMatrix(lambdaHome, lambdaAway);
  const favourite = lambdaHome >= lambdaAway ? "home" : "away";
  const finalMatrix =
    favouriteWinProbability(matrix, favourite) >= UPSET_CAP_THRESHOLD
      ? applyUpsetCap(matrix, favourite)
      : matrix;
  return sampleFromMatrix(finalMatrix, rng);
}

// Odds path: needs at least the 1X2 market. Returns null when it cannot be used
// so the caller can fall back.
function predictFromOdds(
  odds: OddsInput,
  rng: Rng,
): { home: number; away: number } | null {
  const win = odds.win;
  if (!win) return null;
  const probs = deVig1x2(win.home, win.draw, win.away);
  if (!probs) return null;

  const total =
    (odds.total &&
      expectedTotalFromOU(odds.total.line, odds.total.over, odds.total.under)) ||
    WC_AVERAGE_TOTAL;

  // Prefer the handicap line as the supremacy estimate; else derive it from the
  // win/loss probability gap.
  const supremacy =
    odds.handicap && Number.isFinite(odds.handicap.homeLine)
      ? -odds.handicap.homeLine
      : (probs.pH - probs.pA) * WIN_GAP_TO_SUPREMACY;

  return sampleFromTotalSupremacy(total, supremacy, rng);
}

// Rank fallback: a sensible supremacy from the strength-rank gap, average total.
function predictFromRank(
  rankHome: number,
  rankAway: number,
  rng: Rng,
): { home: number; away: number } {
  const gap = rankAway - rankHome; // positive => home is stronger
  const supremacy = gap * RANK_SUPREMACY_K;
  return sampleFromTotalSupremacy(WC_AVERAGE_TOTAL, supremacy, rng);
}

// Resolve a realistic, varied scoreline for one fixture, walking the fallback
// chain: stored odds -> team-strength rank -> plain goal distribution. The
// `source` tag records which path produced the pick, for later audit.
export function predictScore(
  input: ScoreModelInput,
  rng: Rng = Math.random,
): ScorePrediction {
  if (input.odds) {
    const fromOdds = predictFromOdds(input.odds, rng);
    if (fromOdds) return { ...fromOdds, source: "odds" };
  }
  if (
    typeof input.rankHome === "number" &&
    typeof input.rankAway === "number"
  ) {
    const fromRank = predictFromRank(input.rankHome, input.rankAway, rng);
    return { ...fromRank, source: "rank" };
  }
  return { ...randomMatchScore(rng), source: "default" };
}
