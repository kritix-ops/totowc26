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
  numeric,
  uniqueIndex,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { CancelResolutionConfig } from "@/lib/matches/cancel";

// Enums
// Ordered least → most privileged. `live_bets_admin` is a scoped admin
// who can manage live-bet definitions, matchday AI suggestions, the
// bets-overview matrix, and per-match deadlines — and nothing else.
// See _plans/2026-06-12-live-bets-admin-role.md.
export const roleEnum = pgEnum("role", ["player", "live_bets_admin", "admin"]);
export const stageEnum = pgEnum("stage", [
  "group",
  "r32",
  "r16",
  "qf",
  "sf",
  "third_place",
  "final",
]);
// scheduled / live / final are the upstream-synced states. postponed and
// canceled are admin-only terminal/holding states for a match that is called
// off: postponed freezes everything until a new kickoff is set, canceled sits
// pending (no scoring) until the admin picks a cancel_resolution for the
// 1/X/2 guesses. The sync never overwrites a manually-set postponed/canceled
// row. See _plans/2026-06-22-match-cancel-postpone-admin.md.
export const matchStatusEnum = pgEnum("match_status", [
  "scheduled",
  "live",
  "final",
  "postponed",
  "canceled",
]);
// How a canceled match's 1/X/2 guesses are settled. void = neutral (0 to all,
// no risk penalty); awarded = grade vs a technical scoreline (wrong = 0, never
// a penalty); split = flat points to every picker. Match-scoped live bets are
// always voided + refunded on cancel regardless of this choice.
export const cancelResolutionEnum = pgEnum("cancel_resolution", [
  "void",
  "awarded",
  "split",
]);
// Canonical match-status union, derived from the enum so loader row types
// stay in lockstep with the DB. Includes postponed/canceled.
export type MatchStatus = (typeof matchStatusEnum.enumValues)[number];
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

// Canonical operator-permission keys. Drives the JSONB column on
// profiles + the path whitelist in src/lib/admin-paths.ts + the
// checkbox list in the user drawer. New keys are added here, then
// surfaced everywhere via type inference. Keep alphabetised.
export const ADMIN_PERMISSION_KEYS = [
  "liveBets",
  "tournamentBets",
  "tournamentOdds",
] as const;
export type AdminPermissionKey = (typeof ADMIN_PERMISSION_KEYS)[number];

// profiles: extends Supabase auth.users (FK added via raw SQL migration)
export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(), // matches auth.users.id
  displayName: text("display_name").notNull(),
  phone: text("phone").notNull(),
  role: roleEnum("role").notNull().default("player"),
  // Per-user operator permissions. Empty object = no scoped operator
  // powers (the user is a plain player unless role = 'admin'). Schema
  // is { liveBets?: boolean, tournamentBets?: boolean, tournamentOdds?:
  // boolean }. New keys are added via migration; src/lib/admin.ts
  // validates against the canonical allowlist. Admin gets everything
  // implicitly, so this column is ignored when role = 'admin'.
  // See _plans/2026-06-12-live-bets-admin-role.md (revision 2).
  permissions: jsonb("permissions")
    .$type<Partial<Record<AdminPermissionKey, boolean>>>()
    .notNull()
    .default({}),
  avatarUrl: text("avatar_url"),
  // Opt-in for push notifications (lock reminders). Default false:
  // even after the browser grants permission and a subscription is
  // stored, push only fires when this flag is true so the player can
  // pause without re-granting browser permission. See
  // _plans/2026-05-28-lock-reminders.md §5.
  pushOptIn: boolean("push_opt_in").notNull().default(false),
  // Per-trigger toggles for the Smart Reminders feature. Each one is
  // AND'd with pushOptIn at send time, so a player can keep push on
  // generally but mute a specific channel. Defaults to true so the
  // existing iteration-2 behavior (push lock reminders) survives the
  // migration unchanged for anyone who already opted in.
  // See _plans/2026-05-30-smart-reminders.md.
  smartHubEnabled: boolean("smart_hub_enabled").notNull().default(true),
  pushLockReminders: boolean("push_lock_reminders").notNull().default(true),
  pushDuelReceived: boolean("push_duel_received").notNull().default(true),
  // Marks the non-human "monkey" baseline player. Bots are filled by a cron
  // (see /api/cron/monkey) and rendered as a separate benchmark line in the
  // standings, never ranked inline among humans. They are excluded from email
  // / in-app broadcast fan-outs and the admin player listing. Payment-gated
  // surfaces (pot, reminders, duel notifications) already skip them since a
  // bot has no approved payment. See
  // _plans/2026-06-01-monkey-bot-and-random-fill.md §Phase 4.
  isBot: boolean("is_bot").notNull().default(false),
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
    // Provenance for the Hebrew translation. `source` is one of:
    // 'wikidata' / 'walla' / 'one' / 'sport5' / 'sport1' / 'ynet' /
    // 'llm_claude' / 'llm_reviewer' / 'manual'. `reviewVerdict` is one
    // of: 'approved' / 'flag' / 'reject' / null.
    nameHeSource: text("name_he_source"),
    nameHeConfidence: smallint("name_he_confidence"),
    nameHeReviewVerdict: text("name_he_review_verdict"),
    nameHeReviewReason: text("name_he_review_reason"),
    nameHeReviewedAt: timestamp("name_he_reviewed_at", { withTimezone: true }),
    nameHeAdminLocked: boolean("name_he_admin_locked").notNull().default(false),
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
    // home_score / away_score hold the FINAL result of the match, including
    // extra time but excluding the penalty shootout (API-Football `goals`).
    // This is the score the app displays as "the result" and the score the
    // live-bet auto-grader resolves against (winner / total goals / over-under).
    homeScore: smallint("home_score"),
    awayScore: smallint("away_score"),
    // 90-minute regulation score (API-Football `score.fulltime`). The 1/X/2
    // match-prediction grader scores against THIS, not the final, so a knockout
    // that is level after 90' grades as a draw for direction/exact. For group
    // matches reg_* equals home/away_score. Null until the match is final.
    regHomeScore: smallint("reg_home_score"),
    regAwayScore: smallint("reg_away_score"),
    htHomeScore: smallint("ht_home_score"),
    htAwayScore: smallint("ht_away_score"),
    wentToPenalties: boolean("went_to_penalties"),
    // Penalty shootout score (API-Football `score.penalty`). Non-null only when
    // a knockout went to penalties. Used by the "who wins incl. penalties" /
    // "who advances" live markets and for display.
    penHomeScore: smallint("pen_home_score"),
    penAwayScore: smallint("pen_away_score"),
    // The team that advances / wins this knockout, including extra time and
    // penalties (from API-Football `teams.*.winner`, or set manually by an
    // admin). References teams.code. Null for group matches, unfinished
    // matches, or matches the auto-grader could not resolve (→ manual). This is
    // the source of truth the "מי עולה?" grader compares each pick against.
    advancingTeam: varchar("advancing_team", { length: 3 }).references(
      () => teams.code,
    ),
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
    // Cancel handling (status = 'canceled'). cancelResolution is null while
    // the match sits pending — no 1/X/2 scoring happens until the admin picks
    // void / awarded / split. cancelResolutionConfig carries the scoreline
    // ({home,away}) for awarded or the flat amount ({points}) for split; null
    // for void. statusChangedAt stamps the last MANUAL status move (distinct
    // from finalizedAt, which the sync owns). See
    // _plans/2026-06-22-match-cancel-postpone-admin.md.
    cancelResolution: cancelResolutionEnum("cancel_resolution"),
    cancelResolutionConfig: jsonb("cancel_resolution_config")
      .$type<CancelResolutionConfig>(),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),
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

// match_advance_bets: a user's "who advances?" (מי עולה?) pick for a knockout
// match. Kept in its own table — separate from match_bets — so the score
// columns there stay NOT NULL and the existing 1/X/2 path is untouched. A
// player may pick the score, the advancing team, both, or neither. Graded by
// scoreAdvanceBets() against matches.advancing_team, worth settings.scoring_advance
// on a hit. See _plans/2026-06-28-knockout-stage-90min-who-advances.md.
export const matchAdvanceBets = pgTable(
  "match_advance_bets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    // The team the player thinks advances. References teams.code.
    team: varchar("team", { length: 3 })
      .notNull()
      .references(() => teams.code),
    locked: boolean("locked").notNull().default(false),
    pointsEarned: smallint("points_earned"),
    wasCorrect: boolean("was_correct"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniqUserMatch: uniqueIndex("match_advance_bets_user_match_uniq").on(
      t.userId,
      t.matchId,
    ),
    userIdx: index("match_advance_bets_user_idx").on(t.userId),
    matchIdx: index("match_advance_bets_match_idx").on(t.matchId),
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
  entryFeeIls: integer("entry_fee_ils").notNull().default(120),
  recipientPhone: text("recipient_phone").notNull(),
  // Admin-controlled deep link to the pool's Paybox group. Null = fall
  // back to the marketing site so the button is never dead.
  payboxUrl: text("paybox_url"),
  // Admin-controlled invite link to the pool's WhatsApp group. Surfaced
  // on the profile page; null hides the card entirely.
  whatsappGroupUrl: text("whatsapp_group_url"),
  betLockMinutes: smallint("bet_lock_minutes").notNull().default(5),
  // Tournament anchor for the custom_tournament bet type and the live
  // countdown on tournament-wide bets. Nullable: when null, the
  // deadline resolver falls back to MIN(matches.kickoff_at) so the
  // value stays meaningful right after the migration runs, before the
  // admin visits /admin/deadlines to set it explicitly.
  tournamentStartAt: timestamp("tournament_start_at", { withTimezone: true }),
  // Single absolute cutoff for every 1/X/2 match pick across the whole
  // tournament. When set, resolveMatchScoreLock returns this value for
  // any match that doesn't have its own per-bet override - per-day and
  // type-default offsets are skipped. Null = fall back to the cascade.
  // Seeded by migration 0029, then cleared by migration 0039 when the
  // pool switched to per-match deadlines; admin can re-set it from
  // /admin/deadlines.
  matchPicksGlobalLockAt: timestamp("match_picks_global_lock_at", {
    withTimezone: true,
  }),
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
  // Points for a correct "who advances?" (מי עולה?) pick on a knockout match.
  // Graded independently of the 1/X/2 score bet. Admin-editable on the scoring
  // settings page. See _plans/2026-06-28-knockout-stage-90min-who-advances.md.
  scoringAdvance: smallint("scoring_advance").notNull().default(10),
  stakeMain: smallint("stake_main").notNull().default(0),
  matchRiskEnabled: boolean("match_risk_enabled").notNull().default(false),
  matchRiskPenalty: smallint("match_risk_penalty").notNull().default(5),
  // Default points awarded to every picker when a canceled match is resolved
  // with the "split" option, so the admin does not retype it each time. 0 =
  // no default (admin enters the amount on the resolution form). See
  // _plans/2026-06-22-match-cancel-postpone-admin.md.
  cancelSplitDefaultPoints: smallint("cancel_split_default_points")
    .notNull()
    .default(0),
  // Daily renewal. When enabled, the cron inserts a point_adjustments
  // row per active player at 00:00 Asia/Jerusalem with the configured
  // delta. Off by default - admin opts in.
  dailyRenewalEnabled: boolean("daily_renewal_enabled").notNull().default(false),
  dailyRenewalAmount: smallint("daily_renewal_amount").notNull().default(3),
  // Duel limits. The actual feature (server actions + UI) lands in PR 3;
  // the knobs live here from PR 1 so the admin settings surface ships at
  // the same time as the schema.
  duelMaxStake: smallint("duel_max_stake").notNull().default(5),
  duelDefaultJoinWindowHours: smallint("duel_default_join_window_hours").notNull().default(24),
  duelDailyLimit: smallint("duel_daily_limit").notNull().default(20),
  // Negative-balance rules. A live-bet or duel placement may push the
  // bank to at most -maxOverdraft. Once balance is < 0, both placement
  // paths reject until the player recovers via free bets / admin adjust.
  // Kill-switch reverts to the legacy "balance >= stake" rule.
  // See _plans/2026-06-11-negative-balance-lock.md.
  maxOverdraft: integer("max_overdraft").notNull().default(10),
  lockBetsWhenNegative: boolean("lock_bets_when_negative").notNull().default(true),
  // Live-bet odds → stake/payout normalization. Used by PR 2's
  // src/lib/odds-normalize.ts when converting bookmaker decimal odds into
  // our point system. The house edge trims a slice off the bookmaker
  // payout so the pool's expected value sums to less than 100% over time.
  liveOddsBaseStake: smallint("live_odds_base_stake").notNull().default(3),
  liveOddsMaxPayout: smallint("live_odds_max_payout").notNull().default(25),
  liveOddsHouseEdgePct: smallint("live_odds_house_edge_pct").notNull().default(5),
  // Player-chosen stake bounds. The bet card pills clamp to this range
  // client-side and write-core re-clamps server-side. See
  // _plans/2026-06-11-variable-live-bet-stake.md.
  liveOddsMinStake: smallint("live_odds_min_stake").notNull().default(1),
  liveOddsMaxStake: smallint("live_odds_max_stake").notNull().default(10),
  // Gross-payout cap formula = min(stake * ratio, ceiling). Replaces the
  // old single liveOddsMaxPayout cap for the user-facing path (the legacy
  // column is kept one cycle for rollback).
  liveOddsMaxPayoutRatio: smallint("live_odds_max_payout_ratio").notNull().default(8),
  liveOddsMaxPayoutCeiling: smallint("live_odds_max_payout_ceiling").notNull().default(100),
  // Claude model id used by the live-bet AI suggestion generator. Admin-
  // selectable from a fixed catalogue (src/lib/bets/suggest/models.ts) so
  // the cost/quality trade-off can be tuned without a redeploy. Falls back
  // to the catalogue default if the stored id is ever retired.
  suggestModel: text("suggest_model").notNull().default("claude-sonnet-4-6"),
  // Rules engine for auto-seeding live-bet drafts. When enabled, the
  // /api/cron/live-autogen cron generates draft suggestions for every
  // upcoming match within the lead window that has no custom bets yet.
  // Off by default — opt-in, and still admin-approved before publish.
  liveAutogenEnabled: boolean("live_autogen_enabled").notNull().default(false),
  liveAutogenLeadHours: smallint("live_autogen_lead_hours").notNull().default(30),
  // Admin "house guidance" appended to the AI suggestion system prompt, kept
  // separately per scope (the match and day prompts have different rules).
  // This is a SAFE steer fenced inside the prompt — it can shape wording and
  // selection but can never override the hard format / schema / grading /
  // bilingual rules. Null/empty = no extra guidance. Edited from
  // /admin/live-bets/suggestions. See
  // _plans/2026-06-28-live-bet-suggestions-log-prompt-publish.md.
  suggestGuidanceMatch: text("suggest_guidance_match"),
  suggestGuidanceDay: text("suggest_guidance_day"),
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
  stakeYesNo: smallint("stake_yes_no").notNull().default(1),
  payoutYesNo: smallint("payout_yes_no").notNull().default(3),
  stakeNumber: smallint("stake_number").notNull().default(2),
  payoutNumber: smallint("payout_number").notNull().default(6),
  stakeMultiChoice: smallint("stake_multi_choice").notNull().default(2),
  payoutMultiChoice: smallint("payout_multi_choice").notNull().default(5),
  stakeFreeText: smallint("stake_free_text").notNull().default(3),
  payoutFreeText: smallint("payout_free_text").notNull().default(10),
  // Prize split for the top 4 finishers (% of the pot). Default 50/30/15/5.
  // Sum must be <= 100 (CHECK constraint added in migration). Each prize
  // is computed dynamically as floor(pot * pct / 100).
  prizePct1: smallint("prize_pct_1").notNull().default(50),
  prizePct2: smallint("prize_pct_2").notNull().default(30),
  prizePct3: smallint("prize_pct_3").notNull().default(15),
  prizePct4: smallint("prize_pct_4").notNull().default(5),
  // Fixed ILS amount pulled off the pot before percentages are applied.
  // Covers the API-Football subscription that powers the schedule, live
  // scores, and stats. The 7-way category split runs on
  // max(0, pot - admin_overhead_ils), so a higher overhead proportionally
  // shrinks every prize tile. Default 100.
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
  // Pool digest widget on the home dashboard. Default true so existing
  // deployments start showing the new card immediately after migration;
  // admin can mute it from the dashboard settings panel without taking
  // the /transparency page down.
  dashboardDigestEnabled: boolean("dashboard_digest_enabled")
    .notNull()
    .default(true),
  // Live scoreboard "upcoming matches of the active matchday" feed. When
  // off, /[lang]/live still shows live games + last 90 min of finals,
  // but the scheduled rows with the kickoff countdown are hidden. Admin
  // toggle lives on /[lang]/admin/system. See migration 0056.
  liveShowUpcoming: boolean("live_show_upcoming")
    .notNull()
    .default(true),
  // "Player history" mode on /transparency: lets any member browse one
  // player's complete, all-surfaces bet history + head-to-head compare.
  // When off, the by-question feed stays up and the player-history mode is
  // hidden. Admin toggle lives on /[lang]/admin/system. See migration 0060
  // and _plans/2026-06-15-per-user-bet-history.md.
  transparencyHistoryEnabled: boolean("transparency_history_enabled")
    .notNull()
    .default(true),
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
    // Bookmaker decimal odds the bet was published against. Required for
    // live (match/day) scope so the submit path can recompute payout for a
    // player-chosen stake. Free-pick scopes (tournament/stage/group) keep
    // this NULL because their per-option payouts come from the outright
    // curve, not a single odds value. See migration 0047 + plan
    // _plans/2026-06-11-variable-live-bet-stake.md.
    decimalOdds: numeric("decimal_odds", { precision: 6, scale: 2 }),

    // Grading config
    gradingSource: gradingSourceEnum("grading_source").notNull(),
    gradingConfig: jsonb("grading_config"),
    resolvedValue: jsonb("resolved_value"),

    // Hide-from-template-picker flag. Off by default; admin flips it
    // from /admin/bets/[id] once a question stops being useful as a
    // template ("Will Mexico finish 1st in Group A?" after the group
    // stage ends). Player-facing surfaces ignore this column.
    // See migration 0049.
    templateArchived: boolean("template_archived").notNull().default(false),

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
    // Frozen payout for this specific pick. Set at pick time from the
    // chosen MultiChoiceOption.payoutOverride when the bet uses per-option
    // pricing; otherwise from custom_bets.payoutSnapshot. NULL on
    // pre-migration rows — the grader falls back to bet-level payout
    // when NULL. See _plans/2026-05-30-outright-bet-payout-system.md.
    payoutSnapshot: smallint("payout_snapshot"),
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

// bet_admin_audit: append-only log of every admin-on-behalf-of-user pick
// write. Mirrors the bet_grading_audit precedent (immutable trail, REVOKE
// UPDATE/DELETE in the migration). Either match_id or custom_bet_id is
// set depending on `surface`; the migration's CHECK constraint enforces
// the XOR. `before` snapshots the prior pick (NULL on first-time
// insert), `after` snapshots the new state (NULL on clear). `reason` is
// the admin's explanation, mandatory and non-empty at the DB level.
// `lock_bypassed=true` flags the action as deadline-overriding so a
// future report can call out "X bypasses this week".
export const betAdminAudit = pgTable(
  "bet_admin_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adminId: uuid("admin_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    targetUserId: uuid("target_user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    action: text("action").notNull(), // 'set' | 'clear'
    surface: text("surface").notNull(), // 'match' | 'custom'
    matchId: uuid("match_id").references(() => matches.id, {
      onDelete: "set null",
    }),
    customBetId: uuid("custom_bet_id").references(() => customBets.id, {
      onDelete: "set null",
    }),
    before: jsonb("before"),
    after: jsonb("after"),
    reason: text("reason").notNull(),
    lockBypassed: boolean("lock_bypassed").notNull().default(false),
    // True only for the admin self-backdate path: a full admin correcting
    // their OWN pick after the match has already started/finished. Lets the
    // private self-backdate audit view single these out from ordinary
    // pre-deadline admin overrides (which only set lock_bypassed). See
    // _plans/2026-06-23-admin-self-backdate-bets.md.
    backdated: boolean("backdated").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    targetIdx: index("bet_admin_audit_target_idx").on(
      t.targetUserId,
      t.createdAt,
    ),
    adminIdx: index("bet_admin_audit_admin_idx").on(t.adminId, t.createdAt),
  }),
);

// bet_odds_audit: append-only trail of every admin odds-correction on a
// PUBLISHED live bet. Mirrors the bet_grading_audit / match_status_audit
// precedent — admin-only RLS read+insert, REVOKE UPDATE/DELETE in the migration
// so a correction is a NEW row, never a silent rewrite. `before` / `after`
// snapshot the per-option decimal-odds maps; `affected_picks` is how many
// already-placed picks were re-priced to the corrected line. `reason` is
// mandatory and non-empty at the DB level. See
// _plans/2026-06-24-edit-published-live-bet-odds.md.
export const betOddsAudit = pgTable(
  "bet_odds_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customBetId: uuid("custom_bet_id")
      .notNull()
      .references(() => customBets.id, { onDelete: "cascade" }),
    before: jsonb("before"),
    after: jsonb("after"),
    affectedPicks: integer("affected_picks").notNull().default(0),
    reason: text("reason").notNull(),
    performedBy: uuid("performed_by")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    performedAt: timestamp("performed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    betIdx: index("bet_odds_audit_bet_idx").on(t.customBetId, t.performedAt),
    timeIdx: index("bet_odds_audit_time_idx").on(t.performedAt),
  }),
);

// live_gen_runs: one row per AI live-bet generation run, so the admin can see
// what the LLM did right on the suggestions page — progress, errors, and
// exactly how many bets it produced — instead of digging through server logs.
// A row is inserted 'running' when generation is scheduled and finalized to
// 'done'/'failed' by the background task with the model + counts + usage. The
// generation diagnostics that used to live only in console.info('[live-gen
// ok]') now persist here. See
// _plans/2026-06-28-live-bet-suggestions-log-prompt-publish.md.
export const liveGenRuns = pgTable(
  "live_gen_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // 'match' | 'day' — which generator produced this run.
    scope: text("scope").notNull(),
    // Hebrew subject for display, e.g. "ארגנטינה נגד מקסיקו" or
    // "יום המשחקים 2026-06-28".
    subjectHe: text("subject_he").notNull(),
    // Claude model id used (known once the background task reads settings).
    model: text("model"),
    // How many bets the admin asked for.
    requested: smallint("requested"),
    // 'running' | 'done' | 'failed'.
    status: text("status").notNull().default("running"),
    // Counts, filled in when the run finishes: raw bets the model returned,
    // how many passed shape validation, how many became drafts, how many
    // failed to persist.
    returned: smallint("returned"),
    valid: smallint("valid"),
    created: smallint("created"),
    failed: smallint("failed"),
    // Web searches the model ran, and token usage (cost visibility).
    searchRequests: smallint("search_requests"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    // Tagged error code/short message when status = 'failed'.
    error: text("error"),
    startedBy: uuid("started_by")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => ({
    timeIdx: index("live_gen_runs_time_idx").on(t.startedAt),
  }),
);

// match_status_audit: append-only trail of every MANUAL match status move
// (postpone / cancel / resolve / reschedule / reopen). Mirrors the
// bet_grading_audit / bet_admin_audit precedent — admin-only RLS read+insert,
// REVOKE UPDATE/DELETE in migration 0064 so a correction is a NEW row, never a
// silent rewrite. `payload` snapshots the move-specific detail (the chosen
// resolution + config, the old/new kickoff on a reschedule, how many live
// bets were voided). See _plans/2026-06-22-match-cancel-postpone-admin.md.
export const matchStatusAudit = pgTable(
  "match_status_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    // 'postpone' | 'cancel' | 'resolve' | 'reschedule' | 'reopen'
    action: text("action").notNull(),
    previousStatus: matchStatusEnum("previous_status"),
    newStatus: matchStatusEnum("new_status").notNull(),
    payload: jsonb("payload"),
    reason: text("reason").notNull(),
    performedBy: uuid("performed_by")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    performedAt: timestamp("performed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    matchIdx: index("match_status_audit_match_idx").on(t.matchId, t.performedAt),
    timeIdx: index("match_status_audit_time_idx").on(t.performedAt),
  }),
);

// password_reset_audit: append-only log of every admin-initiated password
// reset (i.e. an admin generated a one-time recovery link for a user so
// they can set a new password). Mirrors bet_admin_audit's immutability
// model — admin-only RLS read+insert, REVOKE UPDATE/DELETE on client roles
// — see migration 0045. No reason column: the action is one-tap and the
// actor/target/timestamp are the accountability record.
export const passwordResetAudit = pgTable(
  "password_reset_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adminId: uuid("admin_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    targetUserId: uuid("target_user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    targetIdx: index("password_reset_audit_target_idx").on(
      t.targetUserId,
      t.createdAt,
    ),
    adminIdx: index("password_reset_audit_admin_idx").on(
      t.adminId,
      t.createdAt,
    ),
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
    // Legacy yes/no duels: NOT NULL semantically (DB CHECK enforces it).
    // New-style custom-option duels carry the opener's pick in
    // `openerOption` instead and leave this NULL. See migration 0058.
    openerAnswer: boolean("opener_answer"),
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

    // ------ Custom-option duels (migration 0058) ------
    // NULL on legacy yes/no duels; both shapes coexist forever.
    // `options` shape: [{ key: string, labelHe: string, labelEn: string,
    //                     multiplierPct: number /* 150..300 */ }]
    // Multiplier is stored as integer hundredths (1.5x = 150) so the
    // bank-balance SQL doesn't need float math. App-level cap is 3.0x
    // (MULTIPLIER_MAX_PCT); the migration-0058 CHECK still allows up to
    // 500 as a backstop for duels opened while 5.0x was live.
    options: jsonb("options"),
    openerOption: text("opener_option"),
    joinerOption: text("joiner_option"),
    resolvedOption: text("resolved_option"),
    // Frozen at open/join time so the running-balance subquery can read
    // an integer without unpacking the jsonb array on every row.
    openerOptionMultiplierPct: smallint("opener_option_multiplier_pct"),
    joinerOptionMultiplierPct: smallint("joiner_option_multiplier_pct"),

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
    openerIdx: index("duels_opener_idx").on(t.openerId),
    joinerIdx: index("duels_joiner_idx").on(t.joinerId),
    statusIdx: index("duels_status_idx").on(t.status),
    deadlineIdx: index("duels_deadline_idx").on(t.joinDeadlineAt),
    matchIdx: index("duels_match_idx").on(t.matchId),
    matchdayIdx: index("duels_matchday_idx").on(t.matchdayId),
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

// stage_lock_defaults: one optional offset per tournament stage. Sits
// between the per-matchday override and the per-type default in the
// deadline cascade (see src/lib/deadlines.ts) so an admin can set "all
// R16 matchdays lock 90 min before kickoff" once instead of editing each
// matchday. Affects the same bet types as the matchday override
// (match_score, custom_match, custom_day). Empty table = zero behavior
// change vs. before migration 0030. Seeded with no rows.
// See _plans/2026-05-28-stage-default-layer.md.
export const STAGE_KEYS = [
  "group",
  "r32",
  "r16",
  "qf",
  "sf",
  "third_place",
  "final",
] as const;
export type StageKey = (typeof STAGE_KEYS)[number];

export const stageLockDefaults = pgTable("stage_lock_defaults", {
  stage: stageEnum("stage").primaryKey(),
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

// user_notifications: in-app feed for each player. Populated by:
//   - /admin/broadcast (admin-authored announcements)
//   - sync.ts grading passes (bet_graded / match_final auto-events)
//
// One row per (user, event). Admin broadcasts to multiple users
// duplicate-insert one row per recipient so the per-user read state
// stays clean without a join table. See migration 0026.
export const NOTIFICATION_KINDS = [
  "announcement",
  "bet_graded",
  "match_final",
  "custom",
  // Sent by sendPushReminders when a custom bet is about to lock and
  // the user has not picked. Companion feed row to the existing push
  // payload. See _plans/2026-05-30-smart-reminders.md.
  "lock_reminder",
  // Sent inline from openDuel to the joiner-eligible recipient.
  "duel_received",
  // Sent from the admin live-bets management surface when an operator
  // manually announces one or more freshly-published live bets. Body is
  // "match name + count" per anchor. See the live-bet push composer.
  "live_bet",
  // Sent (feed only, no push) from voidCustomBet when an admin cancels a
  // live bet and refunds the stake to everyone who picked — e.g. a player
  // prop where the player never took the field. See migration 0061.
  "bet_cancelled",
  // Sent (feed only, no push) when a canceled match's 1/X/2 guess is settled
  // — void (refunded), awarded (graded vs a technical scoreline), or split
  // (flat points). See _plans/2026-06-22-match-cancel-postpone-admin.md and
  // migration 0065.
  "match_canceled",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const userNotifications = pgTable(
  "user_notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().$type<NotificationKind>(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    url: text("url"),
    readAt: timestamp("read_at", { withTimezone: true }),
    pushed: boolean("pushed").notNull().default(false),
    createdBy: uuid("created_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userCreatedIdx: index("user_notifications_user_created_idx").on(
      t.userId,
      t.createdAt,
    ),
    unreadIdx: index("user_notifications_unread_idx")
      .on(t.userId)
      .where(sql`read_at is null`),
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

// user_moment_dismissals: one row per (user, smart-hub moment) the user
// has dismissed. The Smart Hub ranker LEFT JOINs this table and drops
// any moment whose dismissed_until > now(). The dismiss API route sets
// the timestamp to "tomorrow 04:00 Asia/Jerusalem" so the same nudge
// does not reappear inside the same betting day. moment_key is the
// generator-stable identifier (e.g. "unpicked_match:<matchId>"),
// validated by a CHECK constraint in migration 0036. See
// _plans/2026-05-30-smart-reminders.md.
export const userMomentDismissals = pgTable(
  "user_moment_dismissals",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    momentKey: text("moment_key").notNull(),
    dismissedUntil: timestamp("dismissed_until", { withTimezone: true })
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.momentKey] }),
    untilIdx: index("user_moment_dismissals_until_idx").on(t.dismissedUntil),
  }),
);

// content_overrides: one row per (key, locale) the admin has edited
// from /admin/content. Defaults still live in he.json / en.json. The
// dictionary loader merges any rows here on top of the JSON, so an
// empty table = ship the JSON as-is. See
// _plans/2026-05-28-admin-content-editor.md.
export const contentOverrides = pgTable(
  "content_overrides",
  {
    key: text("key").notNull(),
    locale: text("locale").notNull(),
    value: text("value").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedBy: uuid("updated_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.key, t.locale] }),
  }),
);

// content_override_history: append-only audit of every save from
// /admin/content. We never delete from here; "Reset to default" writes
// a row with new_value = null. Lets us answer "who changed the rules
// page copy" without a UI surface yet.
export const contentOverrideHistory = pgTable(
  "content_override_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    locale: text("locale").notNull(),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedBy: uuid("updated_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
  },
  (t) => ({
    keyLocaleIdx: index("content_override_history_key_locale_idx").on(
      t.key,
      t.locale,
      t.updatedAt,
    ),
  }),
);

// news_items: archive of headlines pulled from Walla / Ynet / BBC by
// the /api/cron/news handler. `link` is the natural dedup key (RSS
// guids are usually URLs anyway); the cron upserts with ON CONFLICT DO
// NOTHING so first-seen wins. The (lang, published_at DESC) index
// supports both the initial "latest 20" load and the keyset-paginated
// "load older" scroll without a sort node. See
// _plans/2026-05-29-news-archive-and-lazy-load.md.
export const newsItems = pgTable(
  "news_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").notNull(),
    lang: text("lang").notNull(),
    link: text("link").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    imageUrl: text("image_url"),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    linkUniq: uniqueIndex("news_items_link_uniq").on(t.link),
    langPublishedIdx: index("news_items_lang_published_idx").on(
      t.lang,
      t.publishedAt,
    ),
  }),
);

// news_sync_cursors: per-source HTTP cache state. Walla and BBC honour
// conditional GETs (Last-Modified / ETag); storing the last-seen values
// lets the cron return early on 304 and skip parse. Ynet HTML scrape
// has no reliable validators — its row exists but stays empty.
export const newsSyncCursors = pgTable("news_sync_cursors", {
  source: text("source").primaryKey(),
  lastModified: text("last_modified"),
  etag: text("etag"),
  lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true }),
  lastStatus: smallint("last_status"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Per-fixture persisted snapshot of bookmaker odds. Cron-refreshed
// from The Odds API by /api/cron/odds-sync and read by the admin
// suggestions surface. See migrations/0035_live_odds_snapshot.sql for
// the design rationale.
export const liveOddsSnapshot = pgTable(
  "live_odds_snapshot",
  {
    matchId: uuid("match_id")
      .primaryKey()
      .references(() => matches.id, { onDelete: "cascade" }),
    markets: jsonb("markets").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    notes: text("notes"),
  },
  (t) => ({
    fetchedAtIdx: index("live_odds_snapshot_fetched_at_idx").on(t.fetchedAt),
  }),
);

// Outright-bet payout staging area. Background and full design in
// _plans/2026-05-30-outright-bet-payout-system.md.
//
// Each row is one option (player or team) for one outright surface
// (top_scorer / golden_ball / champion / runner_up / third / group_A..L)
// with its decimal odds. Admin reviews the snapshot in
// /admin/tournament-odds and "publishes" — at which point the per-option
// payouts get baked into the target custom_bets.answer_config.options[]
// via MultiChoiceOption.payoutOverride. The snapshot itself is not what
// users bet on; it is the staging table.
//
// Why staging and not direct write into custom_bets:
//   1. Lets admin re-fetch from Oddschecker without disturbing manual
//      overrides (admin_override = true rows are preserved).
//   2. Lets us preview the full per-option payout grid before commit.
//   3. Keeps the historical audit trail of what the bookmaker board
//      looked like at fetch time, independent of edits the admin made.
//
// surface is an enum-by-convention (not a pg enum) because admins never
// add new surface kinds at runtime — the set is fixed by the bet
// templates in tournament-suggestions/page.tsx. New surface = code
// change.
export const outrightOddsSnapshot = pgTable(
  "outright_odds_snapshot",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    surface: text("surface").notNull(),
    optionKind: text("option_kind").notNull(),
    optionId: integer("option_id").notNull(),
    displayName: text("display_name").notNull(),
    // numeric(10,3) — three decimals is plenty for bookmaker quotes
    // (typical board is 1.10..501.00 with 2-decimal precision).
    decimalOdds: numeric("decimal_odds", { precision: 10, scale: 3 }).notNull(),
    source: text("source").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    adminOverride: boolean("admin_override").notNull().default(false),
    notes: text("notes"),
  },
  (t) => ({
    surfaceIdx: index("outright_odds_snapshot_surface_idx").on(t.surface),
    uniqueRow: uniqueIndex("outright_odds_snapshot_unique_row").on(
      t.surface,
      t.optionKind,
      t.optionId,
    ),
  }),
);

// Per-table `<Name>` (select shape) + `New<Name>` (insert shape) pair
// for every table in the schema. Drizzle infers them from the table
// definition above, so a column rename here lands in every caller
// without an extra step. Both shapes are exported per table even when
// only one is used today, so a future caller doesn't have to come back
// here just to add the missing one.
export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;
export type Match = typeof matches.$inferSelect;
export type NewMatch = typeof matches.$inferInsert;
export type MatchBet = typeof matchBets.$inferSelect;
export type NewMatchBet = typeof matchBets.$inferInsert;
export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;
export type Team = typeof teams.$inferSelect;
export type NewTeam = typeof teams.$inferInsert;
export type Settings = typeof settings.$inferSelect;
export type NewSettings = typeof settings.$inferInsert;
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
export type BetOddsAudit = typeof betOddsAudit.$inferSelect;
export type NewBetOddsAudit = typeof betOddsAudit.$inferInsert;
export type Duel = typeof duels.$inferSelect;
export type NewDuel = typeof duels.$inferInsert;
export type BetLockDefault = typeof betLockDefaults.$inferSelect;
export type NewBetLockDefault = typeof betLockDefaults.$inferInsert;
export type BetReminderSent = typeof betReminderSent.$inferSelect;
export type NewBetReminderSent = typeof betReminderSent.$inferInsert;
// Suffixed `Row` rather than the bare table-name pattern used above
// because the DOM declares a global `PushSubscription` interface for
// the Push API client side, and re-exporting our row shape under the
// same name would shadow it (and confuse consumers that import both).
export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
export type NewPushSubscription = typeof pushSubscriptions.$inferInsert;
export type UserMomentDismissal = typeof userMomentDismissals.$inferSelect;
export type NewUserMomentDismissal = typeof userMomentDismissals.$inferInsert;
export type UserNotification = typeof userNotifications.$inferSelect;
export type NewUserNotification = typeof userNotifications.$inferInsert;
export type ContentOverride = typeof contentOverrides.$inferSelect;
export type NewContentOverride = typeof contentOverrides.$inferInsert;
export type ContentOverrideHistory = typeof contentOverrideHistory.$inferSelect;
export type NewContentOverrideHistory =
  typeof contentOverrideHistory.$inferInsert;
// Suffixed `Row` to avoid clashing with the in-memory `NewsItem` shape
// exported from `@/lib/news` (the parsed-RSS object used during sync).
// Same pattern as `PushSubscriptionRow` vs the DOM `PushSubscription`.
export type NewsItemRow = typeof newsItems.$inferSelect;
export type NewNewsItemRow = typeof newsItems.$inferInsert;
export type NewsSyncCursorRow = typeof newsSyncCursors.$inferSelect;
export type NewNewsSyncCursorRow = typeof newsSyncCursors.$inferInsert;
export type OutrightOddsSnapshotRow =
  typeof outrightOddsSnapshot.$inferSelect;
export type NewOutrightOddsSnapshotRow =
  typeof outrightOddsSnapshot.$inferInsert;
export type LiveOddsSnapshotRow = typeof liveOddsSnapshot.$inferSelect;
export type NewLiveOddsSnapshotRow = typeof liveOddsSnapshot.$inferInsert;

// String-literal union for the nine fixed outright surfaces. Kept in
// sync with the surface check constraint in
// migrations/0034_outright_odds.sql and with the bet templates in
// src/app/[lang]/admin/tournament-suggestions/page.tsx. Listed
// long-form rather than generated from a constant array so a typo here
// surfaces at compile time across every caller.
export type OutrightSurface =
  | "top_scorer"
  | "golden_ball"
  | "champion"
  | "runner_up"
  | "third"
  | "group_A"
  | "group_B"
  | "group_C"
  | "group_D"
  | "group_E"
  | "group_F"
  | "group_G"
  | "group_H"
  | "group_I"
  | "group_J"
  | "group_K"
  | "group_L";
