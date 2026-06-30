// Aggregate graded live-bet history into per-CATEGORY statistics — the data
// layer behind the read-only reference the admin sees when opening a new live
// bet ("offside bets returned -34% over 250 picks"). Phase 1 of the
// data-driven-odds work: pure diagnostics, it changes no price. The same
// per-category realized-frequency this computes becomes the pricing prior in
// Phase 2. See _plans/2026-06-30-data-driven-live-bet-odds.md.
//
// Legacy bets carry no stored `category` (the column landed in migration
// 0070), so every bet is bucketed on read by classifyLiveBetCategory using
// its stored category when present and falling back to the grading spec /
// question text. Pure module — no DB — so the bucketing + math are unit
// tested with hard-coded rows; the DB projection lives in db/admin-queries.ts.

import type { GradingConfig } from "@/lib/bets/types";
import {
  classifyLiveBetCategory,
  liveBetCategoryLabel,
  type LiveBetCategory,
} from "@/lib/bets/live-bet-category";

// Minimum number of graded BETS a category needs before its history is
// trustworthy enough to drive a price (the Phase 2 prior) rather than just be
// shown as context. The unit is bets, not picks: each graded bet is one
// realized-outcome observation, so a category with 250 picks but only 4 bets
// (everyone piling onto the same 4 markets) is still a 4-sample estimate.
// Configurable via settings later; this is the default.
export const MIN_CATEGORY_SAMPLE_BETS = 20;

// One graded live bet plus its aggregated pick tallies, as projected by the
// DB query. `category` is the stored column (null on legacy rows).
export type CategoryBetRow = {
  category: LiveBetCategory | null;
  questionHe: string;
  questionEn: string;
  grading: GradingConfig | null;
  picks: number;
  correct: number;
  staked: number;
  returned: number;
};

export type CategoryStat = {
  category: LiveBetCategory;
  bets: number;
  picks: number;
  correct: number;
  staked: number;
  returned: number;
  // correct / picks. null when the category has no picks yet.
  hitRate: number | null;
  // (returned - staked) / staked, as a percentage. Positive = players net
  // points on this category; negative = it's a drain (offside ≈ -34.5%).
  // null when nothing was staked.
  evPct: number | null;
  // True once `bets` clears MIN_CATEGORY_SAMPLE_BETS — i.e. the sample is
  // deep enough to price against, not just display.
  meetsSampleGate: boolean;
};

// Bucket every graded bet into its category and roll up the tallies. Returns
// a Map keyed by category, containing only categories that have at least one
// bet. Caller decides how to present "other" / sub-gate categories.
export function aggregateCategoryHistory(
  rows: CategoryBetRow[],
  minSampleBets: number = MIN_CATEGORY_SAMPLE_BETS,
): Map<LiveBetCategory, CategoryStat> {
  const acc = new Map<
    LiveBetCategory,
    { bets: number; picks: number; correct: number; staked: number; returned: number }
  >();

  for (const row of rows) {
    const category =
      row.category ??
      classifyLiveBetCategory({
        questionHe: row.questionHe,
        questionEn: row.questionEn,
        grading: row.grading,
      });
    const cur =
      acc.get(category) ?? { bets: 0, picks: 0, correct: 0, staked: 0, returned: 0 };
    cur.bets += 1;
    cur.picks += row.picks;
    cur.correct += row.correct;
    cur.staked += row.staked;
    cur.returned += row.returned;
    acc.set(category, cur);
  }

  const out = new Map<LiveBetCategory, CategoryStat>();
  for (const [category, t] of acc) {
    out.set(category, {
      category,
      bets: t.bets,
      picks: t.picks,
      correct: t.correct,
      staked: t.staked,
      returned: t.returned,
      hitRate: t.picks > 0 ? t.correct / t.picks : null,
      evPct: t.staked > 0 ? ((t.returned - t.staked) / t.staked) * 100 : null,
      meetsSampleGate: t.bets >= minSampleBets,
    });
  }
  return out;
}

// Categories whose realized EV is at least this far below break-even (percent)
// are flagged to the suggestion model as poor value. Deliberately strict so
// only a real, sample-backed drain (offside at -34.5%) surfaces — not noise.
export const GUIDANCE_DRAIN_PCT = -15;

// Build a SELECTION steer for the AI suggestion prompt from realized history.
// Important boundary: the Phase 2 backtest proved a category-level PROBABILITY
// adjustment does NOT improve calibration, so this never tells the model to
// shift probabilities. It only steers WHICH markets to offer — categories
// where players have consistently lost get offered sparingly. Returns "" when
// no gated category clears the drain bar, so nothing is injected. Pure +
// English (the prompt's language). See
// _plans/2026-06-30-data-driven-live-bet-odds.md "Phase 2 ... constructive
// alternatives".
export function buildCategoryEvGuidance(history: CategoryStat[]): string {
  const drains = history
    .filter(
      (s) =>
        s.category !== "other" &&
        s.meetsSampleGate &&
        s.evPct != null &&
        s.evPct <= GUIDANCE_DRAIN_PCT,
    )
    .sort((a, b) => (a.evPct ?? 0) - (b.evPct ?? 0));
  if (drains.length === 0) return "";

  const items = drains.map((s) => {
    // Round EV to the nearest 5% — the sample doesn't justify finer precision.
    const ev = Math.round((s.evPct ?? 0) / 5) * 5;
    return `- ${liveBetCategoryLabel(s.category, "en")} markets (about ${ev}% player return over ${s.picks} picks)`;
  });

  return [
    "From this pool's own settled history, these market types have paid players poorly — they have consistently lost on them:",
    items.join("\n"),
    "Steer SELECTION accordingly: offer these market types SPARINGLY, never let them lead or dominate a batch, and keep their wording and grading rule especially clear. This is only about WHICH markets to choose — keep every probability calibrated to the dossier exactly as the hard rules require; do not inflate or flatten any probability because of this note.",
  ].join("\n");
}

// Look up one category's stat, or a zeroed stat when the category has no
// history yet (so the UI can render "no data" without a null dance).
export function categoryStat(
  history: Map<LiveBetCategory, CategoryStat>,
  category: LiveBetCategory,
): CategoryStat {
  return (
    history.get(category) ?? {
      category,
      bets: 0,
      picks: 0,
      correct: 0,
      staked: 0,
      returned: 0,
      hitRate: null,
      evPct: null,
      meetsSampleGate: false,
    }
  );
}
