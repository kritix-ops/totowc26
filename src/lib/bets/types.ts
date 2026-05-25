// Shared types for the custom-bets system. Pure types, no runtime — safe to
// import from server and client components. See
// _plans/2026-05-25-matchday-custom-bets-system.md §4.8 for the full design.
//
// The discriminator on every shape is `kind` (for config) or `type` (for
// answer / resolved value), so a single jsonb column on custom_bets can
// carry every variant without losing type safety at the call site.

export type YesNoConfig = { kind: "yes_no" };

export type NumberUnit =
  | "goals"
  | "corners"
  | "cards"
  | "shots"
  | "minutes"
  | "";

export type NumberConfig = {
  kind: "number";
  min?: number;
  max?: number;
  unit?: NumberUnit;
};

export type MultiChoiceOption = {
  value: string;
  labelHe: string;
  labelEn: string;
};

export type MultiChoiceConfig = {
  kind: "multi_choice";
  options: MultiChoiceOption[];
};

export type FreeTextConfig = {
  kind: "free_text";
  placeholderHe?: string;
  placeholderEn?: string;
};

// Discriminated union of every supported answer-shape configuration.
// Stored in custom_bets.answer_config jsonb. Validated server-side against
// custom_bets.answer_type on every insert.
export type AnswerConfig =
  | YesNoConfig
  | NumberConfig
  | MultiChoiceConfig
  | FreeTextConfig;

// Grading config tells the auto-grading pipeline where to read the resolved
// value from. `null` means manual: admin types it in.
//
// auto_balldontlie  — pull from balldontlie GOAT response. `stat` is the
//                     team_match_stats field (e.g. "corners", "yellow_cards").
//                     `aggregate` picks how to combine across the matches
//                     covered by the bet's scope.
// auto_football_data — pull from the football-data API result we already
//                     store on matches (home_score, away_score, ht_*).
export type AutoBalldontlieConfig = {
  source: "auto_balldontlie";
  stat: string;
  aggregate: "sum_day" | "per_match" | "first_match";
};

export type AutoFootballDataConfig = {
  source: "auto_football_data";
  field:
    | "home_score"
    | "away_score"
    | "winner"
    | "ht_score"
    | "total_goals"
    | "ht_total"
    | "went_to_penalties";
};

export type GradingConfig = AutoBalldontlieConfig | AutoFootballDataConfig | null;

// Resolved value carried on custom_bets.resolved_value once the bet has been
// graded. Mirrored on user_custom_bet_picks.answer (same shape) so grading
// is "did pick.answer.value equal bet.resolved_value.value?".
export type ResolvedYesNo = { type: "yes_no"; value: boolean };
export type ResolvedNumber = { type: "number"; value: number };
export type ResolvedMultiChoice = { type: "multi_choice"; value: string };
export type ResolvedFreeText = { type: "free_text"; value: string };

export type ResolvedValue =
  | ResolvedYesNo
  | ResolvedNumber
  | ResolvedMultiChoice
  | ResolvedFreeText;

// A user's pick is identical in shape to a resolved value — same union.
export type PickAnswer = ResolvedValue;
