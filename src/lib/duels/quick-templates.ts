// API-Football quick templates for the new-duel form.
//
// Each template renders as a pill chip in the form. Tapping it pre-fills
// every field needed to publish an auto-graded yes/no duel: question and
// rule copy in both languages, the matching grading_config that the
// sync cron evaluates, and a sensible default options pair (yes/no with
// 2.0x multipliers so the duel stays symmetric out of the box - the
// opener can still tweak ratios after the auto-fill).
//
// Why templates: the existing manual flow asks the opener to type four
// Hebrew/English strings AND configure three picker dropdowns. Real
// users skip the auto-grade entirely because the friction is too high.
// Templates collapse the work to "tap a chip, pick a threshold".
//
// The grading_config shape mirrors what the duel sync grader already
// understands (src/app/[lang]/duels/actions.ts -> DuelAutoGradeConfig:
// stat + comparator + threshold against combined API-Football stats).
// New templates only need an entry here; the grader requires no change.

import {
  MULTIPLIER_MIN_PCT,
  type DuelOption,
} from "./options";

export type AutoStat =
  | "corners"
  | "yellow_cards"
  | "red_cards"
  | "shots"
  | "shots_on_goal"
  | "shots_inside_box"
  | "shots_outside_box"
  | "fouls"
  | "offsides"
  | "saves"
  | "total_passes";

export type Comparator = "<" | "<=" | "=" | ">=" | ">";

export type DuelQuickTemplate = {
  // Stable id used in the form state and analytics.
  id: string;
  // Chip label shown on the form.
  chipHe: string;
  chipEn: string;
  // Stat the grader evaluates against combined-team API-Football stats.
  stat: AutoStat;
  // Default comparator and threshold prefilled when the chip is tapped.
  defaultComparator: Comparator;
  defaultThreshold: number;
  // Threshold step + bounds for the inline stepper next to the chip.
  thresholdStep: number;
  thresholdMin: number;
  thresholdMax: number;
  // Copy generators. `n` is the threshold the opener picked.
  questionHe: (n: number) => string;
  questionEn: (n: number) => string;
  ruleHe: (n: number) => string;
  ruleEn: (n: number) => string;
};

// The default 2-option pair every template seeds when applied. Keeping
// it here (not on each template) lets us change the seed in one place
// later without rewriting every entry.
export function defaultTemplateOptions(): DuelOption[] {
  return [
    { key: "yes", labelHe: "כן", labelEn: "Yes", multiplierPct: 200 },
    { key: "no", labelHe: "לא", labelEn: "No", multiplierPct: 200 },
  ];
}

// Sanity check at module load: the seed multipliers must respect the
// floor used by the DB CHECK. A typo here would let a tampered duel
// past the action and fail at insert time.
defaultTemplateOptions().forEach((o) => {
  if (o.multiplierPct < MULTIPLIER_MIN_PCT) {
    throw new Error(
      `[duel quick-templates] seed multiplier ${o.multiplierPct} below floor ${MULTIPLIER_MIN_PCT}`,
    );
  }
});

export const DUEL_QUICK_TEMPLATES: DuelQuickTemplate[] = [
  {
    id: "corners_over",
    chipHe: "יותר מ-X קרנות?",
    chipEn: "More than X corners?",
    stat: "corners",
    defaultComparator: ">",
    defaultThreshold: 10,
    thresholdStep: 1,
    thresholdMin: 1,
    thresholdMax: 30,
    questionHe: (n) => `האם יהיו יותר מ-${n} קרנות במשחק?`,
    questionEn: (n) => `Will there be more than ${n} corners in the match?`,
    ruleHe: (n) =>
      `סך הקרנות של שתי הקבוצות במשחק הזה (90 דקות + הארכה) חייב להיות לפחות ${n + 1}.`,
    ruleEn: (n) =>
      `Total corners across both teams in this match (90 minutes + extra time) must be at least ${n + 1}.`,
  },
  {
    id: "red_card_yes",
    chipHe: "כרטיס אדום במשחק?",
    chipEn: "Red card in the match?",
    stat: "red_cards",
    defaultComparator: ">=",
    defaultThreshold: 1,
    thresholdStep: 1,
    thresholdMin: 1,
    thresholdMax: 5,
    questionHe: (n) =>
      n === 1
        ? "האם יוצא לפחות כרטיס אדום אחד במשחק?"
        : `האם יוצאו לפחות ${n} כרטיסים אדומים במשחק?`,
    questionEn: (n) =>
      n === 1
        ? "Will at least one red card be shown in the match?"
        : `Will at least ${n} red cards be shown in the match?`,
    ruleHe: (n) =>
      `סך הכרטיסים האדומים של שתי הקבוצות במשחק חייב להיות לפחות ${n}.`,
    ruleEn: (n) =>
      `Combined red-card count for both teams in this match must be at least ${n}.`,
  },
  {
    id: "yellow_cards_over",
    chipHe: "מעל X כרטיסים צהובים?",
    chipEn: "Over X yellow cards?",
    stat: "yellow_cards",
    defaultComparator: ">",
    defaultThreshold: 4,
    thresholdStep: 1,
    thresholdMin: 0,
    thresholdMax: 12,
    questionHe: (n) => `האם יוצאו יותר מ-${n} כרטיסים צהובים במשחק?`,
    questionEn: (n) => `Will more than ${n} yellow cards be shown in the match?`,
    ruleHe: (n) =>
      `סך הכרטיסים הצהובים של שתי הקבוצות במשחק חייב להיות לפחות ${n + 1}.`,
    ruleEn: (n) =>
      `Combined yellow-card count for both teams in this match must be at least ${n + 1}.`,
  },
  {
    id: "shots_on_target_over",
    chipHe: "X בעיטות למסגרת?",
    chipEn: "X shots on target?",
    stat: "shots_on_goal",
    defaultComparator: ">",
    defaultThreshold: 8,
    thresholdStep: 1,
    thresholdMin: 1,
    thresholdMax: 30,
    questionHe: (n) => `האם יהיו יותר מ-${n} בעיטות למסגרת במשחק?`,
    questionEn: (n) => `Will there be more than ${n} shots on target in the match?`,
    ruleHe: (n) =>
      `סך הבעיטות למסגרת של שתי הקבוצות חייב להיות לפחות ${n + 1}.`,
    ruleEn: (n) =>
      `Combined shots on target for both teams must be at least ${n + 1}.`,
  },
  {
    id: "offsides_over",
    chipHe: "מעל X נבדלים?",
    chipEn: "Over X offsides?",
    stat: "offsides",
    defaultComparator: ">",
    defaultThreshold: 3,
    thresholdStep: 1,
    thresholdMin: 0,
    thresholdMax: 15,
    questionHe: (n) => `האם יהיו יותר מ-${n} נבדלים במשחק?`,
    questionEn: (n) => `Will there be more than ${n} offsides in the match?`,
    ruleHe: (n) =>
      `סך הנבדלים של שתי הקבוצות במשחק חייב להיות לפחות ${n + 1}.`,
    ruleEn: (n) =>
      `Combined offside count for both teams must be at least ${n + 1}.`,
  },
  {
    id: "fouls_over",
    chipHe: "מעל X עבירות?",
    chipEn: "Over X fouls?",
    stat: "fouls",
    defaultComparator: ">",
    defaultThreshold: 22,
    thresholdStep: 1,
    thresholdMin: 5,
    thresholdMax: 60,
    questionHe: (n) => `האם יהיו יותר מ-${n} עבירות במשחק?`,
    questionEn: (n) => `Will there be more than ${n} fouls in the match?`,
    ruleHe: (n) =>
      `סך העבירות של שתי הקבוצות חייב להיות לפחות ${n + 1}.`,
    ruleEn: (n) =>
      `Combined foul count for both teams must be at least ${n + 1}.`,
  },
];

// Resolve a template id to its row. Returns null on miss so a stale
// chip id in the URL or form state degrades gracefully.
export function findTemplate(id: string): DuelQuickTemplate | null {
  return DUEL_QUICK_TEMPLATES.find((t) => t.id === id) ?? null;
}

// Build the form payload a quick-template chip should hand off to the
// new-duel form when activated at threshold `n`.
export function applyTemplate(
  template: DuelQuickTemplate,
  n: number,
): {
  questionHe: string;
  questionEn: string;
  ruleHe: string;
  ruleEn: string;
  options: DuelOption[];
  autoGrade: { stat: AutoStat; comparator: Comparator; threshold: number };
} {
  // Clamp into the chip's own bounds so a tampered request can't sneak
  // a wild threshold through (defence-in-depth with the server-side
  // openDuel validator).
  const threshold = Math.max(
    template.thresholdMin,
    Math.min(template.thresholdMax, Math.trunc(n)),
  );
  return {
    questionHe: template.questionHe(threshold),
    questionEn: template.questionEn(threshold),
    ruleHe: template.ruleHe(threshold),
    ruleEn: template.ruleEn(threshold),
    options: defaultTemplateOptions(),
    autoGrade: {
      stat: template.stat,
      comparator: template.defaultComparator,
      threshold,
    },
  };
}
