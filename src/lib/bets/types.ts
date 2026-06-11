// Shared types for the custom-bets system. Pure types, no runtime - safe to
// import from server and client components. See
// _plans/2026-05-25-matchday-custom-bets-system.md §4.8 for the full design.
//
// The discriminator on every shape is `kind` (for config) or `type` (for
// answer / resolved value), so a single jsonb column on custom_bets can
// carry every variant without losing type safety at the call site.

export type YesNoConfig = {
  kind: "yes_no";
  // Per-option payout overrides for yes_no bets that price the two
  // outcomes differently — e.g. a 30%-yes / 70%-no market where the
  // "yes" branch should pay much more than the "no" branch. When set,
  // they supersede the bet-level `payoutSnapshot` for users picking
  // that specific branch, the same way `MultiChoiceOption.payoutOverride`
  // works for multi_choice bets. Snapshotted into
  // bet_picks.payout_snapshot at pick time, so post-lock shifts never
  // re-price a locked pick.
  //
  // Optional everywhere — bets that price both outcomes the same leave
  // these undefined and the flat bet-level payout is used. See
  // _plans/2026-06-05-flat-tournament-bets-per-option-odds.md.
  payoutOverrideYes?: number;
  payoutOverrideNo?: number;
};

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
  // Optional metadata used by the user-facing
  // SearchableChoicePicker when the list is large (player roster,
  // ~1,200 rows). Renderers that don't need it (short pill grids,
  // admin tables) just ignore the extra fields.
  groupHe?: string;
  groupEn?: string;
  subtitleHe?: string;
  subtitleEn?: string;
  icon?: string;
  // Per-option payout override in tournament points. When set, this
  // supersedes the bet-level `payoutSnapshot` for users picking this
  // specific option. Snapshotted into bet_picks.payout_snapshot at
  // pick time, so post-lock odds shifts never re-price a locked pick.
  //
  // Sourced from outright_odds_snapshot via the
  // /admin/tournament-odds publish flow — see
  // _plans/2026-05-30-outright-bet-payout-system.md. Computed from
  // bookmaker decimal odds via normalizeOdds(), so the longshot
  // premium baked into the existing engine applies per-option without
  // a separate pricing path.
  //
  // Range: 1..settings.liveOddsMaxPayout (default 25). Optional for
  // backwards compatibility — bets with no override keep the flat
  // bet-level payout for every option.
  payoutOverride?: number;
};

// `dynamicSource` lets a bet declare that its options live in a
// dataset the client will hydrate at view time (e.g. the full WC
// player roster ~1,300 rows). When set, `options` should be `[]`
// at storage time — the picker fetches the live list from
// /api/picker-options/<source> and renders it with lazy chunked
// display. Avoids bloating answer_config jsonb with thousands of rows
// per tournament bet.
export type DynamicOptionSource = "players";

export type MultiChoiceConfig = {
  kind: "multi_choice";
  options: MultiChoiceOption[];
  dynamicSource?: DynamicOptionSource;
  // Per-option payout overrides keyed by option `value`. Used by
  // outright bets that need longshot-premium pricing. Two places this
  // matters:
  //   - For STATIC option lists (48 WC teams), we also write
  //     payoutOverride directly onto each MultiChoiceOption above.
  //     This map is kept in sync as a flat lookup for the resolver.
  //   - For DYNAMIC source bets (1,357 players) the `options` array
  //     stays empty, so this map is the ONLY storage of per-option
  //     payouts. Resolver reads from here; picker UI merges into the
  //     hydrated dynamic list at render time.
  //
  // Optional everywhere — bets without per-option pricing leave it
  // undefined and the bet-level payoutSnapshot is used as a flat
  // payout per the historic behaviour.
  payoutOverridesByValue?: Record<string, number>;
  // Per-option bookmaker decimal odds keyed by option `value`. Captured
  // at publish time for live (match/day) multi-choice bets so the
  // variable-stake submit path can recompute payout against the
  // player's chosen stake. Free-pick scopes (tournament/stage/group)
  // do not set this — their option pricing comes from the outright
  // curve, not from a single odds value. See
  // _plans/2026-06-11-variable-live-bet-stake.md §6.
  decimalOddsByValue?: Record<string, number>;
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
// auto_api_football  - pull from the API-Football v3 /fixtures/statistics
//                      endpoint. `stat` is one of the stat keys returned
//                      by their API (see fields below). `aggregate` picks
//                      how to combine across the matches covered by the
//                      bet's scope.
// auto_football_data - pull from the football-data API result we already
//                      store on matches (home_score, away_score, ht_*).
export type AutoApiFootballStat =
  | "corners"
  | "yellow_cards"
  | "red_cards"
  | "shots"
  | "shots_on_goal"
  | "shots_inside_box"
  | "shots_outside_box"
  | "possession"
  | "fouls"
  | "offsides"
  | "saves"
  | "total_passes"
  | "pass_accuracy";

export type AutoApiFootballConfig = {
  source: "auto_api_football";
  stat: AutoApiFootballStat;
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

export type GradingConfig = AutoApiFootballConfig | AutoFootballDataConfig | null;

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

// A user's pick is identical in shape to a resolved value - same union.
export type PickAnswer = ResolvedValue;
