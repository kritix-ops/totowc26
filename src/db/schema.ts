import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  smallint,
  integer,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Enums
export const roleEnum = pgEnum("role", ["player", "admin"]);
export const stageEnum = pgEnum("stage", [
  "group",
  "r32",
  "r16",
  "qf",
  "sf",
  "third_place",
  "final",
]);
export const matchStatusEnum = pgEnum("match_status", [
  "scheduled",
  "live",
  "final",
]);
export const paymentMethodEnum = pgEnum("payment_method", ["bit", "paybox"]);
export const paymentStatusEnum = pgEnum("payment_status", [
  "pending",
  "approved",
  "rejected",
]);
export const bracketSlotEnum = pgEnum("bracket_slot", [
  "champion",
  "runner_up",
  "third",
  "fourth",
]);

// profiles: extends Supabase auth.users (FK added via raw SQL migration)
export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(), // matches auth.users.id
  displayName: text("display_name").notNull(),
  phone: text("phone").notNull(),
  role: roleEnum("role").notNull().default("player"),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// groups: A/B/C/D...
export const groups = pgTable("groups", {
  id: varchar("id", { length: 2 }).primaryKey(),
  displayOrder: smallint("display_order").notNull(),
});

// teams: national teams
export const teams = pgTable(
  "teams",
  {
    code: varchar("code", { length: 3 }).primaryKey(), // ISO-ish (BRA, GER, USA)
    nameHe: text("name_he").notNull(),
    nameEn: text("name_en").notNull(),
    flag: text("flag").notNull(), // emoji
    groupId: varchar("group_id", { length: 2 }).references(() => groups.id, {
      onDelete: "set null",
    }),
  },
  (t) => ({
    groupIdx: index("teams_group_idx").on(t.groupId),
  }),
);

// matches: fixtures
export const matches = pgTable(
  "matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    homeTeam: varchar("home_team", { length: 3 })
      .notNull()
      .references(() => teams.code),
    awayTeam: varchar("away_team", { length: 3 })
      .notNull()
      .references(() => teams.code),
    kickoffAt: timestamp("kickoff_at", { withTimezone: true }).notNull(),
    stage: stageEnum("stage").notNull(),
    groupId: varchar("group_id", { length: 2 }).references(() => groups.id),
    venue: text("venue"),
    status: matchStatusEnum("status").notNull().default("scheduled"),
    homeScore: smallint("home_score"),
    awayScore: smallint("away_score"),
    htHomeScore: smallint("ht_home_score"),
    htAwayScore: smallint("ht_away_score"),
    wentToPenalties: boolean("went_to_penalties"),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    apiFixtureId: integer("api_fixture_id"),
  },
  (t) => ({
    kickoffIdx: index("matches_kickoff_idx").on(t.kickoffAt),
    stageIdx: index("matches_stage_idx").on(t.stage),
    statusIdx: index("matches_status_idx").on(t.status),
    apiFixtureIdx: uniqueIndex("matches_api_fixture_uniq").on(t.apiFixtureId),
  }),
);

// match_bets: a user's prediction for a match
export const matchBets = pgTable(
  "match_bets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    homeScore: smallint("home_score").notNull(),
    awayScore: smallint("away_score").notNull(),
    locked: boolean("locked").notNull().default(false),
    pointsEarned: smallint("points_earned"),
    wasExact: boolean("was_exact"),
    wasCorrectOutcome: boolean("was_correct_outcome"),
    // Optional per-match side bets. Null = the user didn't pick that bet.
    betBtts: boolean("bet_btts"),
    betOver25: boolean("bet_over_25"),
    betHtHome: smallint("bet_ht_home"),
    betHtAway: smallint("bet_ht_away"),
    pointsBtts: smallint("points_btts"),
    pointsOver25: smallint("points_over_25"),
    pointsHt: smallint("points_ht"),
    // Stake snapshots: the stake actually deducted when the user opted into
    // the side bet. Null when the user did not opt in.
    stakePaidBtts: smallint("stake_paid_btts"),
    stakePaidOver25: smallint("stake_paid_over_25"),
    stakePaidHt: smallint("stake_paid_ht"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniqUserMatch: uniqueIndex("match_bets_user_match_uniq").on(
      t.userId,
      t.matchId,
    ),
    userIdx: index("match_bets_user_idx").on(t.userId),
    matchIdx: index("match_bets_match_idx").on(t.matchId),
  }),
);

// group_predictions: ranking of 4 teams within one group
export const groupPredictions = pgTable(
  "group_predictions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    groupId: varchar("group_id", { length: 2 })
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    teamCode: varchar("team_code", { length: 3 })
      .notNull()
      .references(() => teams.code, { onDelete: "cascade" }),
    predictedRank: smallint("predicted_rank").notNull(), // 1..4
    pointsEarned: smallint("points_earned"),
    // Stake snapshot — settings.stakeGroupTeam at submit time. Frozen so
    // a later setting change doesn't retroactively re-price a saved pick.
    stakePaid: smallint("stake_paid").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniqUserGroupTeam: uniqueIndex("group_pred_user_group_team_uniq").on(
      t.userId,
      t.groupId,
      t.teamCode,
    ),
    uniqUserGroupRank: uniqueIndex("group_pred_user_group_rank_uniq").on(
      t.userId,
      t.groupId,
      t.predictedRank,
    ),
  }),
);

// bracket_predictions: champion / runner-up / third / fourth
export const bracketPredictions = pgTable(
  "bracket_predictions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    slot: bracketSlotEnum("slot").notNull(),
    teamCode: varchar("team_code", { length: 3 })
      .notNull()
      .references(() => teams.code, { onDelete: "cascade" }),
    pointsEarned: smallint("points_earned"),
    // Stake snapshot — settings.stakeBracket<Slot> at submit time.
    stakePaid: smallint("stake_paid").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniqUserSlot: uniqueIndex("bracket_pred_user_slot_uniq").on(
      t.userId,
      t.slot,
    ),
  }),
);

// payments: entry fees
export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    method: paymentMethodEnum("method").notNull(),
    amountIls: integer("amount_ils").notNull(),
    status: paymentStatusEnum("status").notNull().default("pending"),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedBy: uuid("decided_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    note: text("note"),
  },
  (t) => ({
    userIdx: index("payments_user_idx").on(t.userId),
    statusIdx: index("payments_status_idx").on(t.status),
  }),
);

// settings: singleton (id = 1)
//
// Two parallel pricing dimensions:
//   scoring_*  → the GROSS payout when the user is correct (added to bank)
//   stake_*    → the deduction taken from the user's bank at submit time
// Net change on a correct bet  = scoring_* − stake_*
// Net change on a wrong bet    = −stake_*
//
// The main 1/X/2 pick is intentionally free (stake_main = 0); every other
// action costs. starting_bank seeds every user with the configured float.
export const settings = pgTable("settings", {
  id: smallint("id").primaryKey().default(1),
  entryFeeIls: integer("entry_fee_ils").notNull().default(100),
  recipientPhone: text("recipient_phone").notNull(),
  // Admin-controlled deep link to the pool's Paybox group. Null = fall
  // back to the marketing site so the button is never dead.
  payboxUrl: text("paybox_url"),
  betLockMinutes: smallint("bet_lock_minutes").notNull().default(5),
  // Points bank
  startingBank: smallint("starting_bank").notNull().default(100),
  // Main bet (kept free — stake 0)
  scoringExact: smallint("scoring_exact").notNull().default(15),
  scoringOutcome: smallint("scoring_outcome").notNull().default(3),
  stakeMain: smallint("stake_main").notNull().default(0),
  // Group-stage predictions
  scoringGroupTeam: smallint("scoring_group_team").notNull().default(3),
  scoringGroupPerfect: smallint("scoring_group_perfect").notNull().default(8),
  stakeGroupTeam: smallint("stake_group_team").notNull().default(2),
  // Bracket: champion / runner-up / third / fourth
  scoringChampion: smallint("scoring_champion").notNull().default(30),
  scoringRunnerUp: smallint("scoring_runner_up").notNull().default(18),
  scoringThird: smallint("scoring_third").notNull().default(10),
  scoringFourth: smallint("scoring_fourth").notNull().default(7),
  stakeBracketChampion: smallint("stake_bracket_champion").notNull().default(5),
  stakeBracketRunnerUp: smallint("stake_bracket_runner_up").notNull().default(3),
  stakeBracketThird: smallint("stake_bracket_third").notNull().default(2),
  stakeBracketFourth: smallint("stake_bracket_fourth").notNull().default(2),
  // Per-match side bets
  scoringBtts: smallint("scoring_btts").notNull().default(3),
  scoringOver25: smallint("scoring_over_25").notNull().default(3),
  scoringHtExact: smallint("scoring_ht_exact").notNull().default(8),
  scoringHtOutcome: smallint("scoring_ht_outcome").notNull().default(5),
  stakeBtts: smallint("stake_btts").notNull().default(1),
  stakeOver25: smallint("stake_over_25").notNull().default(1),
  stakeHt: smallint("stake_ht").notNull().default(2),
  // Tournament special bets
  scoringTopScorer: smallint("scoring_top_scorer").notNull().default(25),
  scoringFinalPenalties: smallint("scoring_final_penalties").notNull().default(13),
  stakeTopScorer: smallint("stake_top_scorer").notNull().default(5),
  stakeFinalPenalties: smallint("stake_final_penalties").notNull().default(3),
  // Prize split for the top 4 finishers (% of the pot). Default 50/30/15/5.
  // Sum must be <= 100 (CHECK constraint added in migration). Each prize
  // is computed dynamically as floor(pot * pct / 100).
  prizePct1: smallint("prize_pct_1").notNull().default(50),
  prizePct2: smallint("prize_pct_2").notNull().default(30),
  prizePct3: smallint("prize_pct_3").notNull().default(15),
  prizePct4: smallint("prize_pct_4").notNull().default(5),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  // ensure singleton
  // CHECK constraint added in raw SQL migration: CHECK (id = 1)
});

// special_bets: tournament-wide one-shot picks (top scorer, will final go to
// penalties, etc). Value is text so it can hold a player name, "yes"/"no",
// or a number depending on bet_type.
export const specialBetTypeEnum = pgEnum("special_bet_type", [
  "top_scorer",
  "final_penalties",
]);

export const specialBets = pgTable(
  "special_bets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    betType: specialBetTypeEnum("bet_type").notNull(),
    value: text("value").notNull(),
    pointsEarned: smallint("points_earned"),
    // Stake snapshot — settings.stake<Type> at submit time.
    stakePaid: smallint("stake_paid").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniqUserType: uniqueIndex("special_bets_user_type_uniq").on(
      t.userId,
      t.betType,
    ),
  }),
);

// tournament_results: singleton row with the final answers for special bets.
// Admin fills this in at the end of the tournament; the scoring engine grades
// every user's special_bets against it.
export const tournamentResults = pgTable("tournament_results", {
  id: smallint("id").primaryKey().default(1),
  topScorer: text("top_scorer"),
  finalWentToPenalties: boolean("final_went_to_penalties"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// point_adjustments: append-only audit log of admin-issued bank deltas.
//
// Rows are immutable: REVOKE UPDATE/DELETE in the SQL migration blocks
// client-side edits. If an admin mis-types, they enter a corrective row.
// `reason` is required; `delta` is non-zero and capped at ±500 per row to
// protect against fat-finger entries (admin can split into multiple rows).
export const pointAdjustments = pgTable(
  "point_adjustments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    delta: integer("delta").notNull(),
    reason: text("reason").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index("point_adjustments_user_idx").on(t.userId),
    createdAtIdx: index("point_adjustments_created_idx").on(t.createdAt),
  }),
);

// sync_runs: audit log of every football-data sync attempt.
export const syncRuns = pgTable(
  "sync_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    source: text("source").notNull().default("cron"),
    triggeredBy: uuid("triggered_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    ok: boolean("ok").notNull().default(false),
    fetched: integer("fetched").default(0),
    inserted: integer("inserted").default(0),
    updated: integer("updated").default(0),
    skipped: integer("skipped").default(0),
    scoredBets: integer("scored_bets").default(0),
    scoredMatches: integer("scored_matches").default(0),
    scoredSpecials: integer("scored_specials").default(0),
    unknownTeams: jsonb("unknown_teams").$type<string[] | null>(),
    errorMessage: text("error_message"),
    errorStack: text("error_stack"),
  },
  (t) => ({
    startedIdx: index("sync_runs_started_idx").on(t.startedAt),
  }),
);

// Drizzle relations are added separately if needed
export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;
export type Match = typeof matches.$inferSelect;
export type NewMatch = typeof matches.$inferInsert;
export type MatchBet = typeof matchBets.$inferSelect;
export type NewMatchBet = typeof matchBets.$inferInsert;
export type Payment = typeof payments.$inferSelect;
export type Team = typeof teams.$inferSelect;
export type Settings = typeof settings.$inferSelect;
export type PointAdjustment = typeof pointAdjustments.$inferSelect;
export type NewPointAdjustment = typeof pointAdjustments.$inferInsert;

export const _useSql = sql; // re-export to silence unused if any
