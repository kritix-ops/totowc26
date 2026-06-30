// Live-bet CATEGORY — the semantic "what kind of live bet is this" tag that
// the data-driven odds work groups history by ("offside", "corner", "red
// card"...). Distinct from `scope` (match/day) and `answer_type`
// (yes_no/multi_choice), which say nothing about the subject of the bet.
//
// Why this exists: the WC pool admins noticed some live-bet types are
// systematically worse than others (offsides returned -34.5% of stake over
// 250 picks, red cards +69%). To price a NEW live bet against that history we
// first need a stable bucket to aggregate on — that bucket is this category.
// See _plans/2026-06-30-data-driven-live-bet-odds.md.
//
// The list is a FIXED, closed set for the tournament (a free-growing taxonomy
// rots under match-day pressure). Yellow and red are deliberately SEPARATE —
// the realized data shows them behaving very differently, so one shared
// "card" prior would blur the signal.
//
// Pure module — no DB, no fetch, no server-only. Safe to import from the
// client bet form and from server queries alike, and unit-tested with
// hard-coded inputs.

import type { GradingConfig } from "@/lib/bets/types";

export const LIVE_BET_CATEGORIES = [
  "offside",
  "yellow",
  "red",
  "corner",
  "penalty",
  "goals",
  "btts",
  "var",
  "other",
] as const;

export type LiveBetCategory = (typeof LIVE_BET_CATEGORIES)[number];

// Bilingual display labels for the admin UI (dropdown + reference line).
export const LIVE_BET_CATEGORY_LABELS: Record<
  LiveBetCategory,
  { he: string; en: string }
> = {
  offside: { he: "נבדלים", en: "Offside" },
  yellow: { he: "כרטיס צהוב", en: "Yellow card" },
  red: { he: "כרטיס אדום", en: "Red card" },
  corner: { he: "קרנות", en: "Corners" },
  penalty: { he: "פנדל", en: "Penalty" },
  goals: { he: "שערים", en: "Goals" },
  btts: { he: "שתי הקבוצות כובשות", en: "Both teams to score" },
  var: { he: "VAR", en: "VAR" },
  other: { he: "אחר", en: "Other" },
};

export function liveBetCategoryLabel(
  category: LiveBetCategory,
  lang: "he" | "en",
): string {
  return LIVE_BET_CATEGORY_LABELS[category][lang];
}

export function isLiveBetCategory(value: unknown): value is LiveBetCategory {
  return (
    typeof value === "string" &&
    (LIVE_BET_CATEGORIES as readonly string[]).includes(value)
  );
}

// ---------- classification ----------

// Map a grading metric/stat/field onto a category when the bet carries a
// machine-readable settlement spec. This is the HIGH-CONFIDENCE path: a bet
// graded on the API-Football `offsides` stat is unambiguously an offside bet,
// regardless of how its question is phrased. Returns null when the spec
// doesn't map to a dedicated category (e.g. possession, shots) so the caller
// falls through to the text heuristic.
function categoryFromGrading(
  grading: GradingConfig | null | undefined,
): LiveBetCategory | null {
  if (!grading) return null;

  // Event-timeline specs (red card in a half, first goal window).
  const metric =
    ("events" in grading && grading.events?.metric) ||
    ("firstEventWindow" in grading && grading.firstEventWindow?.metric) ||
    null;
  if (metric) {
    switch (metric) {
      case "red_card":
        return "red";
      case "yellow_card":
        return "yellow";
      case "goal":
        return "goals";
      case "penalty":
        return "penalty";
      // "card" is ambiguous (yellow or red); "substitution"/"var" have no
      // dedicated bucket here — fall through to the text heuristic.
    }
  }

  // /fixtures/statistics specs.
  if ("stat" in grading && grading.stat) {
    switch (grading.stat) {
      case "offsides":
        return "offside";
      case "corners":
        return "corner";
      case "yellow_cards":
        return "yellow";
      case "red_cards":
        return "red";
    }
  }

  // Final-score derived fields.
  if ("field" in grading && grading.field) {
    if (grading.field === "btts") return "btts";
    if (grading.field.includes("goal") || grading.field === "total_goals") {
      return "goals";
    }
  }

  return null;
}

// Ordered keyword rules for the text heuristic. SPECIFIC categories come
// first so a broad term can't steal a bet: "both teams to score" must resolve
// to btts before the bare "score/goal" rule, and a red/yellow card before the
// generic goal rule. Hebrew terms are matched as substrings (JS \b is
// unreliable across Hebrew), English terms case-insensitively. Mirrors the
// regexes used to reproduce the historical category EV numbers in
// _scripts/_ev-by-category.mjs.
const KEYWORD_RULES: Array<{ category: LiveBetCategory; terms: string[] }> = [
  { category: "offside", terms: ["נבדל", "offside"] },
  // VAR is written as the Latin acronym even in Hebrew questions.
  { category: "var", terms: ["var"] },
  { category: "btts", terms: ["שתי הקבוצות", "both teams"] },
  { category: "penalty", terms: ["פנדל", "penalty"] },
  { category: "red", terms: ["אדום", "red card"] },
  { category: "yellow", terms: ["צהוב", "yellow"] },
  { category: "corner", terms: ["קרן", "קרנות", "corner"] },
  { category: "goals", terms: ["שער", "גול", "goal", "יבקיע", "כובש", "כיבוש"] },
];

function categoryFromText(questionHe: string, questionEn: string): LiveBetCategory {
  const haystack = `${questionHe} ${questionEn}`.toLowerCase();
  for (const rule of KEYWORD_RULES) {
    if (rule.terms.some((t) => haystack.includes(t))) return rule.category;
  }
  return "other";
}

// Classify a live bet into a category. Prefers the machine-readable grading
// spec (high confidence) and falls back to the question text. Used to (1)
// pre-fill the category dropdown for a NEW bet the admin can override, and
// (2) bucket legacy graded bets for the historical prior. Never throws —
// returns "other" when nothing matches, which carries no prior and prices
// the bet exactly as today.
export function classifyLiveBetCategory(input: {
  questionHe?: string | null;
  questionEn?: string | null;
  grading?: GradingConfig | null;
}): LiveBetCategory {
  const fromGrading = categoryFromGrading(input.grading);
  if (fromGrading) return fromGrading;
  return categoryFromText(input.questionHe ?? "", input.questionEn ?? "");
}
