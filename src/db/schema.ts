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
  date,
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
// Public-signup queue. Players submit a request via /[lang]/signup; admin
// approves which creates the auth user + profile, or rejects (no email by
// default). See _plans/2026-05-26-public-signup-with-admin-approval.md.
export const signupRequestStatusEnum = pgEnum("signup_request_status", [
  "pending",
  "approved",
  "rejected",
]);
// Custom-bets system enums. See _plans/2026-05-25-matchday-custom-bets-system.md.
//
// answer_type    - shape of the player's answer. Drives input widget + JSONB
//                  validation. yes_no / number / multi_choice / free_text.
// bet_scope      - what the bet attaches to. Drives which player surface it
//                  shows up on (matchday page vs tournament page vs group page).
// bet_status     - lifecycle. draft is admin-only; open is pickable; locked
//                  has closed for picks but is not yet graded; graded is
//                  resolved; reversed re-opens a wrong grade; cancelled voids.
// grading_source - who/what fills resolved_value. auto_api_football is
//                  wired but stubbed until API_FOOTBALL_KEY is set in
//                  env (see plan §6.5).
export const answerTypeEnum = pgEnum("answer_type", [
  "yes_no",
  "number",
  "multi_choice",
  "free_text",
]);
export const betScopeEnum = pgEnum("bet_scope", [
  "match",
  "day",
  "stage",
  "group",
  "tournament",
]);
export const betStatusEnum = pgEnum("bet_status", [
  "draft",
  "open",
  "locked",
  "graded",
  "reversed",
  "cancelled",
]);
export const gradingSourceEnum = pgEnum("grading_source", [
  "auto_api_football",
  "auto_football_data",
  "manual",
]);
// duel_status - 1v1 binary bet lifecycle. open is awaiting a joiner;
// matched has both sides locked in (stakes deducted); settled is graded
// and the winner credited; cancelled is no-joiner-by-deadline or admin
// override (both stakes refunded). See _plans/2026-05-27-betting-overhaul.md §7.
export const duelStatusEnum = pgEnum("duel_status", [
  "open",
  "matched",
  "settled",
  "cancelled",
]);

// profiles: extends Supabase auth.users (FK added via raw SQL migration)
export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(), // matches auth.users.id
  displayName: text("display_name").notNull(),
  phone: text("phone").notNull(),
  role: roleEnum("role").notNull().default("player"),
  avatarUrl: text("avatar_url"),
  // Opt-in for push notifications (lock reminders). Default false:
  // even after the browser grants permission and a subscription is
  // stored, push only fires when this flag is true so the player can
  // pause without re-granting browser permission. See
  // _plans/2026-05-28-lock-reminders.md §5.
  pushOptIn: boolean("push_opt_in").notNull().default(false),
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
    // API-Football's numeric team id. Populated by the one-shot
    // scripts/api-football-map-teams.mjs. Once non-null on every WC
    // team, the cron sync looks teams up by this PK instead of
    // string-matching names — see _plans/2026-05-27-migrate-fixture-
    // sync-to-api-football.md.
    apiFootballTeamId: integer("api_football_team_id"),
  },
  (t) => ({
    groupIdx: index("teams_group_idx").on(t.groupId),
  }),
);

// players: WC tournament squad rosters.
//
// Populated by `scripts/api-football-sync-squads.mjs` (the squads
// sync). One row per player per team — when a player transfers
// national teams (rare; happens for naturalised players between
// cycles) the existing row is updated in place. nameHe is nullable
// because the squads sync fills only nameEn; the Hebrew translation
// pipeline (PR-3b/3c) is what fills nameHe afterwards. The audit
// columns (nameHe*) record where the Hebrew came from, how
// confident we are, and whether an admin has manually vetted the
// row — that flag freezes the row against future automatic
// overwrites.
export const players = pgTable(
  "players",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    apiFootballId: integer("api_football_id").notNull().unique(),
    teamCode: varchar("team_code", { length: 3 })
      .notNull()
      .references(() => teams.code, { onDelete: "cascade" }),
    nameEn: text("name_en").notNull(),
    nameHe: text("name_he"),
    nameHeSource:         text("name_he_source"),          // 'wikidata' / 'walla' / 'one' / 'sport5' / 'sport1' / 'ynet' / 'llm_claude' / 'llm_reviewer' / 'manual'
    nameHeConfidence:     smallint("name_he_confidence"),
    nameHeReviewVerdict:  text("name_he_review_verdict"),  // 'approved' / 'flag' / 'reject' / null
    nameHeReviewReason:   text("name_he_review_reason"),
    nameHeReviewedAt:     timestamp("name_he_reviewed_at", { withTimezone: true }),
    nameHeAdminLocked:    boolean("name_he_admin_locked").notNull().default(false),
    position: varchar("position", { length: 20 }),
    jerseyNumber: smallint("jersey_number"),
    photoUrl: text("photo_url"),
    birthDate: date("birth_date"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    teamIdx: index("players_team_idx").on(t.teamCode),
    nameEnIdx: index("players_name_en_idx").on(t.nameEn),
    reviewQueueIdx: index("players_review_queue_idx").on(t.nameHeReviewVerdict, t.nameHeConfidence),
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
    // API-Football v3 fixture ID. Populated by a one-shot mapping
    // script at API_FOOTBALL_KEY activation time. Null until then.
    apiFootballFixtureId: integer("api_football_fixture_id"),
    // Per-match absolute lock for the 1/X/2 score bet on this fixture.
    // When non-null, the deadline resolver returns this value verbatim
    // for the match_score bet type, winning over both the matchday
    // override and the bet_lock_defaults type default. Custom bets that
    // happen to be anchored to this match still use their own lock_at.
    // See _plans/2026-05-27-betting-deadlines.md.
    lockAtOverride: timestamp("lock_at_override", { withTimezone: true }),
  },
  (t) => ({
    kickoffIdx: index("matches_kickoff_idx").on(t.kickoffAt),
    stageIdx: index("matches_stage_idx").on(t.stage),
    statusIdx: index("matches_status_idx").on(t.status),
    apiFixtureIdx: uniqueIndex("matches_api_fixture_uniq").on(t.apiFixtureId),
    lockOverrideIdx: index("matches_lock_at_override_idx")
      .on(t.lockAtOverride)
      .where(sql`lock_at_override is not null`),
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
    // Snapshot of settings.match_risk_penalty at submit time when the
    // admin had risk mode on. Null = risk-off (default) - wrong picks
    // earn 0 net rather than -penalty. Kept on the row for audit and
    // for the /me/bank breakdown; the actual net points are still
    // written to pointsEarned by scoreFinalMatches().
    stakePaidMain: smallint("stake_paid_main"),
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

// signup_requests: public-signup queue. A non-member submits a request from
// /[lang]/signup; admin approves (which then provisions the auth user +
// profile via the existing invite flow) or rejects. We deliberately do NOT
// create a Supabase auth user until approval - pending rows have no auth
// footprint and cannot log in.
export const signupRequests = pgTable(
  "signup_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    displayName: text("display_name").notNull(),
    phone: text("phone").notNull(),
    email: text("email").notNull(),
    status: signupRequestStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedBy: uuid("decided_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    note: text("note"),
    // Links an approved request to the auth user that was created, so the
    // admin can still see history after the user edits their profile.
    createdUserId: uuid("created_user_id"),
  },
  (t) => ({
    statusIdx: index("signup_requests_status_idx").on(t.status),
    // Partial unique index - at most one pending request per email at a
    // time. Approved/rejected history rows can repeat freely.
    pendingEmailUq: uniqueIndex("signup_requests_pending_email_uq")
      .on(t.email)
      .where(sql`status = 'pending'`),
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
// action's stake comes from the per-answer-type defaults below or from the
// per-bet override snapshotted on custom_bets. starting_bank seeds every
// user with the configured float.
export const settings = pgTable("settings", {
  id: smallint("id").primaryKey().default(1),
  entryFeeIls: integer("entry_fee_ils").notNull().default(100),
  recipientPhone: text("recipient_phone").notNull(),
  // Admin-controlled deep link to the pool's Paybox group. Null = fall
  // back to the marketing site so the button is never dead.
  payboxUrl: text("paybox_url"),
  betLockMinutes: smallint("bet_lock_minutes").notNull().default(5),
  // Tournament anchor for the custom_tournament bet type and the live
  // countdown on tournament-wide bets. Nullable: when null, the
  // deadline resolver falls back to MIN(matches.kickoff_at) so the
  // value stays meaningful right after the migration runs, before the
  // admin visits /admin/deadlines to set it explicitly.
  tournamentStartAt: timestamp("tournament_start_at", { withTimezone: true }),
  // Lock-reminder offset. The sync pass sends one email per (bet, user)
  // pair this many minutes before the bet locks, but only to users who
  // haven't placed a pick yet. 0 = feature disabled. Capped at 7 days.
  // See _plans/2026-05-28-lock-reminders.md.
  reminderOffsetMinutes: integer("reminder_offset_minutes")
    .notNull()
    .default(60),
  // Points bank
  startingBank: smallint("starting_bank").notNull().default(30),
  // Main bet payouts. Default mode: exact = +15, direction = +5, wrong = 0.
  // When match_risk_enabled is true, wrong picks earn -match_risk_penalty
  // (default 5) instead of 0. See _plans/2026-05-27-betting-overhaul.md §5.
  scoringExact: smallint("scoring_exact").notNull().default(15),
  scoringOutcome: smallint("scoring_outcome").notNull().default(5),
  stakeMain: smallint("stake_main").notNull().default(0),
  matchRiskEnabled: boolean("match_risk_enabled").notNull().default(false),
  matchRiskPenalty: smallint("match_risk_penalty").notNull().default(5),
  // Daily renewal. When enabled, the cron inserts a point_adjustments
  // row per active player at 00:00 Asia/Jerusalem with the configured
  // delta. Off by default - admin opts in.
  dailyRenewalEnabled: boolean("daily_renewal_enabled").notNull().default(false),
  dailyRenewalAmount:  smallint("daily_renewal_amount").notNull().default(3),
  // Duel limits. The actual feature (server actions + UI) lands in PR 3;
  // the knobs live here from PR 1 so the admin settings surface ships at
  // the same time as the schema.
  duelMaxStake: smallint("duel_max_stake").notNull().default(5),
  duelDefaultJoinWindowHours: smallint("duel_default_join_window_hours").notNull().default(24),
  duelDailyLimit: smallint("duel_daily_limit").notNull().default(20),
  // Live-bet odds → stake/payout normalization. Used by PR 2's
  // src/lib/odds-normalize.ts when converting bookmaker decimal odds into
  // our point system. The house edge trims a slice off the bookmaker
  // payout so the pool's expected value sums to less than 100% over time.
  liveOddsBaseStake: smallint("live_odds_base_stake").notNull().default(3),
  liveOddsMaxPayout: smallint("live_odds_max_payout").notNull().default(25),
  liveOddsHouseEdgePct: smallint("live_odds_house_edge_pct").notNull().default(5),
  // 7-way prize split (king 1/2/3, matches/live/duels winner, reserve).
  // Sum MUST be 100 - DB CHECK constraint enforces this. The legacy
  // prizePct1-4 columns below are kept for backwards compatibility until
  // PR 5 swaps the UI; they will be dropped in a follow-up migration.
  prizeKingFirstPct: smallint("prize_king_first_pct").notNull().default(30),
  prizeKingSecondPct: smallint("prize_king_second_pct").notNull().default(12),
  prizeKingThirdPct: smallint("prize_king_third_pct").notNull().default(6),
  prizeMatchesWinnerPct: smallint("prize_matches_winner_pct").notNull().default(15),
  prizeLiveWinnerPct: smallint("prize_live_winner_pct").notNull().default(15),
  prizeDuelsWinnerPct: smallint("prize_duels_winner_pct").notNull().default(12),
  prizeReservePct: smallint("prize_reserve_pct").notNull().default(10),
  // Custom-bets defaults: stake / payout per answer type. Admin can override
  // per bet at creation time; the override snapshots onto custom_bets so a
  // later settings tweak does not retroactively re-price an existing bet.
  stakeYesNo:        smallint("stake_yes_no").notNull().default(1),
  payoutYesNo:       smallint("payout_yes_no").notNull().default(3),
  stakeNumber:       smallint("stake_number").notNull().default(2),
  payoutNumber:      smallint("payout_number").notNull().default(6),
  stakeMultiChoice:  smallint("stake_multi_choice").notNull().default(2),
  payoutMultiChoice: smallint("payout_multi_choice").notNull().default(5),
  stakeFreeText:     smallint("stake_free_text").notNull().default(3),
  payoutFreeText:    smallint("payout_free_text").notNull().default(10),
  // Prize split for the top 4 finishers (% of the pot). Default 50/30/15/5.
  // Sum must be <= 100 (CHECK constraint added in migration). Each prize
  // is computed dynamically as floor(pot * pct / 100).
  prizePct1: smallint("prize_pct_1").notNull().default(50),
  prizePct2: smallint("prize_pct_2").notNull().default(30),
  prizePct3: smallint("prize_pct_3").notNull().default(15),
  prizePct4: smallint("prize_pct_4").notNull().default(5),
  // Fixed ILS amount pulled off the pot before percentages are applied.
  // Covers setup costs (paybox fees, hosting, design). The 7-way category
  // split runs on max(0, pot - admin_overhead_ils), so a higher overhead
  // proportionally shrinks every prize tile. Default 100.
  adminOverheadIls: integer("admin_overhead_ils").notNull().default(100),
  // Public-signup gate. When false, /[lang]/signup renders a closed page
  // and the "להגיש בקשה" link on /[lang]/login is hidden. Default true so
  // existing deployments keep accepting requests after the migration runs.
  publicSignupOpen: boolean("public_signup_open").notNull().default(true),
  // Admin-controlled mobile bottom-nav layout. `items` is the ordered
  // catalog of visible item keys (see MOBILE_NAV_ITEM_KEYS in
  // src/lib/mobile-nav.ts); items not in the list are hidden.
  // `bottomBarCount` (2..5) caps the number of cells in the bar - if the
  // visible-after-role-filter list is longer, the last bar cell becomes
  // "More" and overflow goes into the bottom sheet. The CHECK constraint
  // in migration 0019 enforces shape on the DB side.
  mobileNavConfig: jsonb("mobile_nav_config")
    .notNull()
    .$type<{ items: string[]; bottomBarCount: number }>()
    .default({
      items: [
        "home",
        "bets",
        "duels",
        "leaderboard",
        "tournament",
        "live",
        "transparency",
        "pay",
        "admin",
        "profile",
        "rules",
      ],
      bottomBarCount: 5,
    }),
  // Admin-controlled page visibility. Array of page keys that are
  // currently hidden. Default empty - everything visible. The catalog
  // of hideable keys lives in src/lib/page-visibility.ts; admin/login/
  // profile/signup/home are never hideable (enforced by the helper, not
  // the DB, so the catalog can evolve without a migration). See
  // _plans/2026-05-27-page-visibility.md.
  hiddenPages: jsonb("hidden_pages")
    .notNull()
    .$type<string[]>()
    .default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  // ensure singleton
  // CHECK constraint added in raw SQL migration: CHECK (id = 1)
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

// matchdays: calendar-day container (Asia/Jerusalem) used to group per-day
// custom bets. Materialised on demand - created the first time the admin
// opens a bet for that date. The PG `date` type is timezone-less; the
// server derives the date from `matches.kickoff_at AT TIME ZONE 'Asia/Jerusalem'`
// before insert so a 23:00 IL kickoff and a 01:00 IL kickoff land on
// different rows correctly.
export const matchdays = pgTable(
  "matchdays",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    date: date("date").notNull(),
    label: text("label"),
    // Default lock cutoff for any bet that doesn't set its own lockAt.
    // Server picks 5 min before the earliest kickoff of the day at the
    // moment the matchday is materialised.
    defaultLockAt: timestamp("default_lock_at", { withTimezone: true }),
    // Per-matchday override for the deadline resolver. When non-null,
    // bets anchored to a match or matchday on this date lock this many
    // minutes before the relevant anchor instead of using the per-type
    // default from bet_lock_defaults. Stage/group/tournament bets are
    // anchored elsewhere and are unaffected. See
    // _plans/2026-05-27-betting-deadlines.md.
    lockOffsetOverrideMinutes: integer("lock_offset_override_minutes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    dateUniq: uniqueIndex("matchdays_date_uniq").on(t.date),
  }),
);

// custom_bets: admin-authored bet, the unit of betting in the new system.
//
// Scope (exactly one anchor key is non-null per scope):
//   match       → matchdayId + matchId both set
//   day         → matchdayId set, matchId null
//   stage       → stage set (e.g. 'qf', 'final')
//   group       → groupId set (e.g. 'A')
//   tournament  → all anchor keys null
// A DB-level CHECK enforces this in the migration.
//
// Answer shape (`answer_type` + `answer_config`):
//   yes_no       → answer is { type:'yes_no', value: boolean }
//   number       → answer is { type:'number', value: number }, config holds
//                  optional min/max/unit
//   multi_choice → answer is { type:'multi_choice', value: string }, config
//                  holds { options: [{ value, labelHe, labelEn }] }
//   free_text    → answer is { type:'free_text', value: string }, config
//                  holds optional placeholders
//
// Pricing: stake_snapshot / payout_snapshot copy the settings default at
// creation, then freeze. Admin can override at create time; future settings
// changes never re-price an existing bet.
//
// Grading: see _plans/2026-05-25-matchday-custom-bets-system.md §6.
// `auto_api_football` is supported in schema but stubbed until
// API_FOOTBALL_KEY lands in env (§6.5). `manual` is the safety valve
// for anything the API can't grade.
export const customBets = pgTable(
  "custom_bets",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // Scoping
    scope: betScopeEnum("scope").notNull(),
    matchdayId: uuid("matchday_id").references(() => matchdays.id, {
      onDelete: "cascade",
    }),
    matchId: uuid("match_id").references(() => matches.id, {
      onDelete: "cascade",
    }),
    stage: stageEnum("stage"),
    groupId: varchar("group_id", { length: 2 }).references(() => groups.id),

    // Player-facing copy. Both languages required so we never show a
    // half-translated bet to the friends who picked the other locale.
    questionHe: text("question_he").notNull(),
    questionEn: text("question_en").notNull(),
    // Mandatory: a one-sentence rule that defines exactly what counts.
    // This is the contract bettors stake against. Empty strings rejected
    // at the DB level via a CHECK constraint in the migration.
    gradingRuleHe: text("grading_rule_he").notNull(),
    gradingRuleEn: text("grading_rule_en").notNull(),

    // Answer shape
    answerType: answerTypeEnum("answer_type").notNull(),
    answerConfig: jsonb("answer_config").notNull().default({}),

    // Pricing snapshot
    stakeSnapshot: smallint("stake_snapshot").notNull(),
    payoutSnapshot: smallint("payout_snapshot").notNull(),

    // Grading config
    gradingSource: gradingSourceEnum("grading_source").notNull(),
    gradingConfig: jsonb("grading_config"),
    resolvedValue: jsonb("resolved_value"),

    // Lifecycle
    status: betStatusEnum("status").notNull().default("draft"),
    lockAt: timestamp("lock_at", { withTimezone: true }).notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    gradedAt: timestamp("graded_at", { withTimezone: true }),
    gradedBy: uuid("graded_by").references(() => profiles.id, {
      onDelete: "set null",
    }),

    // Bookkeeping
    createdBy: uuid("created_by")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    scopeIdx: index("custom_bets_scope_idx").on(t.scope),
    matchdayIdx: index("custom_bets_matchday_idx").on(t.matchdayId),
    matchIdx: index("custom_bets_match_idx").on(t.matchId),
    statusIdx: index("custom_bets_status_idx").on(t.status),
    lockIdx: index("custom_bets_lock_idx").on(t.lockAt),
  }),
);

// user_custom_bet_picks: one row per (user, custom_bet). Answer carried as
// JSONB so we keep all four answer types in a single column without future
// schema work. stakePaid snapshots customBets.stakeSnapshot at submit time
// and is refunded atomically when the user edits / clears the pick.
export const userCustomBetPicks = pgTable(
  "user_custom_bet_picks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    customBetId: uuid("custom_bet_id")
      .notNull()
      .references(() => customBets.id, { onDelete: "cascade" }),
    answer: jsonb("answer").notNull(),
    stakePaid: smallint("stake_paid").notNull(),
    pointsEarned: smallint("points_earned"),
    wasCorrect: boolean("was_correct"),
    locked: boolean("locked").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniqUserBet: uniqueIndex("user_custom_bet_picks_uniq").on(
      t.userId,
      t.customBetId,
    ),
    userIdx: index("user_custom_bet_picks_user_idx").on(t.userId),
    betIdx: index("user_custom_bet_picks_bet_idx").on(t.customBetId),
  }),
);

// bet_grading_audit: append-only log of every grade / reverse / cancel
// performed on a custom_bets row. The migration REVOKEs UPDATE/DELETE so
// the trail is physically immutable; corrections happen as new rows. This
// pairs with the reversal flow (§6.4) - when admin reverses a wrong grade,
// the original row stays put and a new row with action='reverse' records
// who, when, and why.
export const betGradingAudit = pgTable(
  "bet_grading_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customBetId: uuid("custom_bet_id")
      .notNull()
      .references(() => customBets.id, { onDelete: "cascade" }),
    action: text("action").notNull(), // 'grade' | 'reverse' | 'cancel'
    previousStatus: betStatusEnum("previous_status"),
    newStatus: betStatusEnum("new_status").notNull(),
    previousResolvedValue: jsonb("previous_resolved_value"),
    newResolvedValue: jsonb("new_resolved_value"),
    reason: text("reason").notNull(),
    performedBy: uuid("performed_by")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    performedAt: timestamp("performed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    betIdx: index("bet_grading_audit_bet_idx").on(t.customBetId),
    timeIdx: index("bet_grading_audit_time_idx").on(t.performedAt),
  }),
);

// duels: 1v1 binary bet between two pool members.
//
// Lifecycle (mirrors customBets but specialised for the 1v1 case):
//   open      → posted by opener, awaiting a joiner
//   matched   → joiner accepted; both stakes deducted from their banks
//   settled   → graded, winner credited 2x stake (net +stake)
//   cancelled → no joiner by deadline or admin override (stakes refunded)
//
// Scoping mirrors customBets but only match / day / tournament are
// supported. Opener picks their answer (yes/no boolean); joiner implicitly
// takes the opposite. The DB enforces opener ≠ joiner and the scope-key
// consistency via CHECK constraints (see migration 0014).
//
// Bank accounting is computed at query time from the duels table itself,
// not via point_adjustments rows - see src/lib/bank.ts in PR 3 for the
// formula extension. This keeps the adjustments log reserved for genuine
// admin-issued bank changes.
export const duels = pgTable(
  "duels",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // Opener
    openerId: uuid("opener_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    openerAnswer: boolean("opener_answer").notNull(),
    stake: smallint("stake").notNull(),

    // Question text
    questionHe: text("question_he").notNull(),
    questionEn: text("question_en").notNull(),
    gradingRuleHe: text("grading_rule_he").notNull(),
    gradingRuleEn: text("grading_rule_en").notNull(),

    // Scoping
    scope: betScopeEnum("scope").notNull(),
    matchId: uuid("match_id").references(() => matches.id, {
      onDelete: "cascade",
    }),
    matchdayId: uuid("matchday_id").references(() => matchdays.id, {
      onDelete: "cascade",
    }),

    // Lifecycle
    status: duelStatusEnum("status").notNull().default("open"),
    joinDeadlineAt: timestamp("join_deadline_at", { withTimezone: true }).notNull(),
    resolveAt: timestamp("resolve_at", { withTimezone: true }).notNull(),

    // Joiner (null until matched)
    joinerId: uuid("joiner_id").references(() => profiles.id, {
      onDelete: "restrict",
    }),
    joinedAt: timestamp("joined_at", { withTimezone: true }),

    // Settlement
    resolvedValue: boolean("resolved_value"),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    settledBy: uuid("settled_by").references(() => profiles.id, {
      onDelete: "set null",
    }),

    // Optional auto-settle (added in 0015). When grading_source is
    // 'auto_api_football' and scope='match', the sync pass evaluates
    // grading_config = { stat, comparator, threshold } against the
    // fixture stats and writes resolved_value automatically. Default
    // 'manual' so existing duels keep the admin-settle behavior.
    gradingSource: gradingSourceEnum("grading_source").notNull().default("manual"),
    gradingConfig: jsonb("grading_config"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    openerIdx:        index("duels_opener_idx").on(t.openerId),
    joinerIdx:        index("duels_joiner_idx").on(t.joinerId),
    statusIdx:        index("duels_status_idx").on(t.status),
    deadlineIdx:      index("duels_deadline_idx").on(t.joinDeadlineAt),
    matchIdx:         index("duels_match_idx").on(t.matchId),
    matchdayIdx:      index("duels_matchday_idx").on(t.matchdayId),
    gradingSourceIdx: index("duels_grading_source_idx").on(t.gradingSource),
  }),
);

// sync_runs: audit log of every fixture-sync attempt. `provider`
// records which upstream data source was used: "api-football" on the
// primary path, "football-data" on the degraded-mode fallback. Null
// for historical rows (pre-migration 0020).
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
    // Persisted from sync.ts so the admin SyncPanel shows whether the
    // reminder pipeline / auto-lock sweep did anything on each run.
    // See _plans/2026-05-28-lock-reminders.md and migration 0025.
    remindersSent: integer("reminders_sent").default(0),
    lockedExpiredCustomBets: integer("locked_expired_custom_bets").default(0),
    unknownTeams: jsonb("unknown_teams").$type<string[] | null>(),
    errorMessage: text("error_message"),
    errorStack: text("error_stack"),
    provider: text("provider"),
  },
  (t) => ({
    startedIdx: index("sync_runs_started_idx").on(t.startedAt),
  }),
);

// bet_lock_defaults: one offset per bet type that the deadline resolver
// in src/lib/deadlines.ts applies when no per-matchday override and no
// per-bet override is set. Six rows, seeded in migration 0021. The
// bet_type CHECK constraint in the migration is the source of truth for
// the allowed values; BET_TYPE_KEYS below mirrors it for the TS layer.
// See _plans/2026-05-27-betting-deadlines.md.
export const BET_TYPE_KEYS = [
  "match_score",
  "custom_match",
  "custom_day",
  "custom_stage",
  "custom_group",
  "custom_tournament",
] as const;
export type BetTypeKey = (typeof BET_TYPE_KEYS)[number];

export const betLockDefaults = pgTable("bet_lock_defaults", {
  betType: text("bet_type").primaryKey().$type<BetTypeKey>(),
  offsetMinutes: integer("offset_minutes").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedBy: uuid("updated_by").references(() => profiles.id, {
    onDelete: "set null",
  }),
});

// bet_reminder_sent: per (bet, user, channel) dedup so the cron that
// runs every minute doesn't blast a player with the same reminder
// repeatedly. `channel` is on the primary key so iteration 2 (push)
// can write its own row alongside the email row without conflict.
// See _plans/2026-05-28-lock-reminders.md.
export const REMINDER_CHANNELS = ["email", "push"] as const;
export type ReminderChannel = (typeof REMINDER_CHANNELS)[number];

export const betReminderSent = pgTable(
  "bet_reminder_sent",
  {
    customBetId: uuid("custom_bet_id")
      .notNull()
      .references(() => customBets.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    channel: text("channel").notNull().$type<ReminderChannel>(),
    sentAt: timestamp("sent_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.customBetId, t.userId, t.channel] }),
    sentAtIdx: index("bet_reminder_sent_sent_at_idx").on(t.sentAt),
  }),
);

// push_subscriptions: one row per (user, browser/device). The triplet
// (endpoint, p256dh, auth) comes verbatim from PushSubscription.toJSON()
// the browser hands back after pushManager.subscribe(). endpoint is
// unique - the same browser/device produces the same URL. See
// _plans/2026-05-28-lock-reminders.md §5.
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    endpointUniq: uniqueIndex("push_subscriptions_endpoint_uniq").on(t.endpoint),
    userIdx: index("push_subscriptions_user_idx").on(t.userId),
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
export type Matchday = typeof matchdays.$inferSelect;
export type NewMatchday = typeof matchdays.$inferInsert;
export type CustomBet = typeof customBets.$inferSelect;
export type NewCustomBet = typeof customBets.$inferInsert;
export type UserCustomBetPick = typeof userCustomBetPicks.$inferSelect;
export type NewUserCustomBetPick = typeof userCustomBetPicks.$inferInsert;
export type BetGradingAudit = typeof betGradingAudit.$inferSelect;
export type NewBetGradingAudit = typeof betGradingAudit.$inferInsert;
export type Duel = typeof duels.$inferSelect;
export type NewDuel = typeof duels.$inferInsert;
export type BetLockDefault = typeof betLockDefaults.$inferSelect;
export type NewBetLockDefault = typeof betLockDefaults.$inferInsert;
export type BetReminderSent = typeof betReminderSent.$inferSelect;
export type NewBetReminderSent = typeof betReminderSent.$inferInsert;
export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
export type NewPushSubscription = typeof pushSubscriptions.$inferInsert;

export const _useSql = sql; // re-export to silence unused if any
