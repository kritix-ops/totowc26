// Per-pick payout resolution. Single source of truth for "what payout
// should this pick win if it grades correct?" so the pick action and
// the grade action agree.
//
// Background: outright bets (Top scorer, Champion, Group winners, ...)
// price each option individually using bookmaker decimal odds — see
// _plans/2026-05-30-outright-bet-payout-system.md. A pick on Mbappé
// wins fewer points than a pick on a longshot. The per-option price
// lives on MultiChoiceOption.payoutOverride; the bet-level
// custom_bets.payoutSnapshot is the fallback for bets that don't price
// per option (the historic flat-payout shape).
//
// Two callers:
//   - src/app/[lang]/play/[date]/actions.ts at pick time: snapshot the
//     correct payout into user_custom_bet_picks.payout_snapshot.
//   - src/app/[lang]/admin/bets/actions.ts at grade time: pay each
//     correct picker the snapshotted value (falls back to bet-level
//     for pre-migration rows with NULL pick.payoutSnapshot).
//
// Note on the answerConfig argument: we accept the loose `unknown`
// shape from JSONB because both callers fetch it without re-parsing
// the AnswerConfig discriminated union. The narrowing happens here in
// one place rather than in every caller.

import type { MultiChoiceConfig, MultiChoiceOption, PickAnswer } from "./types";

// Resolves the payout for a single pick at PICK time. Used by the
// pick action to snapshot the value into user_custom_bet_picks.
export function resolvePickPayoutAtSubmit(args: {
  answerType: "yes_no" | "number" | "multi_choice" | "free_text";
  answerConfig: unknown;
  answer: PickAnswer;
  betLevelPayout: number;
}): number {
  const override = readMultiChoiceOverride(
    args.answerType,
    args.answerConfig,
    args.answer,
  );
  return override ?? args.betLevelPayout;
}

// Resolves the payout for a single pick at GRADE time. Used by the
// grade action when crediting winners. Prefers the value snapshotted
// at pick time (pick.payoutSnapshot); falls back to bet-level for any
// pre-migration row whose snapshot column is NULL.
export function resolvePickPayoutAtGrade(args: {
  pickPayoutSnapshot: number | null;
  betLevelPayout: number;
}): number {
  return args.pickPayoutSnapshot ?? args.betLevelPayout;
}

function readMultiChoiceOverride(
  answerType: "yes_no" | "number" | "multi_choice" | "free_text",
  answerConfig: unknown,
  answer: PickAnswer,
): number | null {
  if (answerType !== "multi_choice") return null;
  if (answer.type !== "multi_choice") return null;
  const cfg = answerConfig as Partial<MultiChoiceConfig> | null | undefined;

  // Static options: read the option's own payoutOverride first.
  const opts: MultiChoiceOption[] | undefined = cfg?.options;
  if (Array.isArray(opts) && opts.length > 0) {
    const match = opts.find((o) => o.value === answer.value);
    const v = match?.payoutOverride;
    if (typeof v === "number" && Number.isFinite(v) && v > 0) {
      return Math.round(v);
    }
  }

  // Dynamic source (or static fallback): per-value map. Empty options
  // are the dynamic-source signal; the map carries the prices.
  const map = cfg?.payoutOverridesByValue;
  if (map && typeof map === "object") {
    const v = map[answer.value];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) {
      return Math.round(v);
    }
  }

  return null;
}
