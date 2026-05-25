# Matchday-Level Custom Bets System

**Date:** 2026-05-25
**Status:** Ready for implementation — all decisions locked
**Owner:** Yoav
**Target date:** Live by **2026-06-11** (World Cup kickoff). Friends pool — if a piece slips, the pool runs without that piece until it lands.

---

## 1. Goal

Every non‑1/X/2 bet on the app moves out of hardcoded match‑level columns
into a unified, admin‑authored **custom‑bets** system organized around
**matchdays** (calendar dates in Asia/Jerusalem). Each matchday surface
shows:

- The fixtures playing that day (1/X/2 picks still live there).
- All custom bets the admin has opened for that day, split into two
  shapes: **per‑match** (linked to one fixture) and **per‑day**
  (aggregates across every match that day, e.g. "total corners today").

The current BTTS / Over 2.5 / halftime columns on `match_bets` are
removed. Group standings, bracket, and tournament specials are all
re‑expressed as custom bets attached to virtual "tournament" or "stage"
containers, so there is a **single mental model** end‑to‑end.

Admin authors any bet (Yes/No, Number, Multiple choice, Free text) with
its own stake, payout and grading rule. Grading is hybrid: **balldontlie
GOAT API** auto‑grades anything stat‑based; everything else falls back
to manual admin grading. football‑data API stays wired in as a fallback
for scores/lineups when balldontlie is rate‑limited or down.

---

## 2. Constraints (from `~/.claude/CLAUDE.md` and project `CLAUDE.md`)

- **Verify, never guess** (rule 1): balldontlie 2026 WC coverage and
  `match_id` mapping must be confirmed against a live endpoint **before
  schema goes to prod**. See §10.0.
- **Clean ordered code** (rule 2): new tables sit alongside existing
  Drizzle conventions in `src/db/schema.ts`. New columns slot into
  `settings` in the existing pricing block. New routes follow the
  `src/app/[lang]/...` pattern already in use.
- **Alignment before code** (rule 3): all 8 design decisions are locked
  via the questionnaire round above this plan. No additional ambiguity.
- **Mobile‑first responsive** (project `CLAUDE.md`): every new surface
  tested at 360 / 414 / 768 / 1024 / 1440px. 44×44px touch targets.
  Tables become stacked cards under `md`. Asia/Jerusalem date rendering
  via `formatDateTime` from `src/lib/format.ts` (auto‑memory enforced).
- **Cost flagging** (rule 8): one new paid service — **balldontlie GOAT
  $39.99/mo (~₪144)**. Approved. Cancellable post‑tournament. 48h free
  GOAT trial available — use it for verification (§10.0) before billing.
- **Context7 before library code** (rule 9): consult Context7 for any
  Next.js 15 / Drizzle / Supabase API surface touched. App Router
  semantics changed in 15; do not rely on training data.
- **Lazy user** (rule 10): no jargon. Every custom bet exposes a
  one‑sentence "How this is graded" rule to players **before** they
  stake. Date labels render as "יום שלישי, 11 ביוני 2026" — never the
  word "matchday" or "יום משחקים" in the UI.
- **Security from day 1** (rule 13): role‑gated admin routes; server is
  the only balance authority; bet submission uses serializable txn +
  advisory lock per user; grading is append‑only with reversal support;
  reasons required on every admin action that affects bank.
- **Observability from day 1** (rule 14): every grading decision, every
  reversal, every stake debit, every payout credit, every settings
  change emits a namespaced `console.info`. See §14.
- **Settings audit** (rule 15): default stakes & payouts per answer type
  live in `settings`. Each custom bet snapshots its stake/payout at
  creation so a later setting change cannot retroactively re‑price.
  Every new setting documented; nothing hardcoded in TS.
- **UI/UX friendly** (rule 16): admin form is one obvious page; player
  surface uses date + flag iconography, never schema names.
- **Brutally honest** (rule 12): the scope is ambitious for the
  available time. Section §16 lists the actual risks and the rollback
  plan. None of them are catastrophic — pool runs on whatever is ready.

---

## 3. Decisions locked

| # | Question | Decision |
|---|----------|----------|
| 1 | Existing per‑match BTTS / Over 2.5 / HT | **Removed entirely** (columns dropped, data wiped). Replaced by admin‑authored custom bets. |
| 2 | Grading source | **Hybrid** — balldontlie GOAT auto when possible; manual admin grading otherwise. Source chosen at bet creation. |
| 3 | Answer types | **All four**: Yes/No, Number, Multiple choice, Free text. |
| 4 | Pricing | **Default per answer type in `settings`, per‑bet override at creation.** Snapshotted onto the bet row at create time. |
| 5 | Scope of refactor | **All non‑1/X/2 bets** including bracket / group / specials get folded into the unified custom‑bets pipeline. |
| 6 | API choice | **football‑data API only for now** (already wired, free). balldontlie GOAT ($39.99/mo) deferred until ~1 week before kickoff so we don't pay for a month of idle subscription. Schema accommodates both from day 1. |
| 7 | Target date | **Live by 2026‑06‑11** (kickoff). Soft target — if a piece misses, the pool runs without it until it lands. |
| 8 | Scope | Full vision (all 5 scopes, 4 answer types, hybrid grading, migration of legacy bets). Risks listed in §16; none are blocking. |

---

## 4. Data model

### 4.1 New enums

```ts
export const answerTypeEnum = pgEnum("answer_type", [
  "yes_no",
  "number",
  "multi_choice",
  "free_text",
]);

export const betScopeEnum = pgEnum("bet_scope", [
  "match",       // one specific match
  "day",         // all matches on a single matchday
  "stage",       // a tournament stage (group / r16 / qf / sf / final)
  "group",       // one of the 8 groups A..H
  "tournament",  // tournament‑wide one‑shot (top scorer, bracket slots)
]);

export const betStatusEnum = pgEnum("bet_status", [
  "draft",       // admin saved but didn't publish
  "open",        // players can pick
  "locked",      // pick window closed
  "graded",      // resolved, payouts credited
  "reversed",    // payouts reversed (after a wrong grading)
  "cancelled",   // void; stakes refunded
]);

export const gradingSourceEnum = pgEnum("grading_source", [
  "auto_balldontlie",
  "auto_football_data",
  "manual",
]);
```

### 4.2 `matchdays`

Container keyed by **Asia/Jerusalem calendar date**. Materialised on
demand: when admin opens a new bet for a date that has no row, a row is
created.

```ts
export const matchdays = pgTable(
  "matchdays",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    date: date("date").notNull(),               // CALENDAR date, no TZ
    label: text("label"),                       // optional admin override
    // Lock cutoff for any 'day' / 'match'-scoped bet on this matchday.
    // Defaults to 5 min before the earliest kickoff of the day at
    // matchday creation time; admin can override per bet on bet row.
    defaultLockAt: timestamp("default_lock_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull().defaultNow(),
  },
  (t) => ({
    dateUniq: uniqueIndex("matchdays_date_uniq").on(t.date),
  }),
);
```

> **Note:** PG `date` is timezone‑less by design. The server always
> derives the date from `kickoff_at AT TIME ZONE 'Asia/Jerusalem'` so a
> 23:00 IL kickoff and a 01:00 IL kickoff fall on different rows
> correctly.

### 4.3 `custom_bets`

The bet itself — authored by admin, scoped, priced, gradeable.

```ts
export const customBets = pgTable(
  "custom_bets",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // ---- Scoping (exactly one of the optional FKs is set per scope) ----
    scope: betScopeEnum("scope").notNull(),
    matchdayId: uuid("matchday_id").references(() => matchdays.id, {
      onDelete: "cascade",
    }),
    matchId: uuid("match_id").references(() => matches.id, {
      onDelete: "cascade",
    }),
    stage: stageEnum("stage"),                  // when scope = 'stage'
    groupId: varchar("group_id", { length: 2 })
      .references(() => groups.id),             // when scope = 'group'
    // (tournament scope has no FK)

    // ---- Player‑facing copy ----
    questionHe: text("question_he").notNull(),
    questionEn: text("question_en").notNull(),
    // MANDATORY (rule 10 + Outsider). One sentence, both languages.
    gradingRuleHe: text("grading_rule_he").notNull(),
    gradingRuleEn: text("grading_rule_en").notNull(),

    // ---- Answer shape ----
    answerType: answerTypeEnum("answer_type").notNull(),
    // For multi_choice: array of options. For number: optional
    // min/max bounds + units. For yes_no: ignored. For free_text:
    // optional placeholder. Stored as jsonb so the shape is flexible.
    answerConfig: jsonb("answer_config")
      .$type<AnswerConfig>().notNull().default({}),

    // ---- Pricing snapshot ----
    // Defaults pulled from settings at creation, then frozen on the row.
    stakeSnapshot: smallint("stake_snapshot").notNull(),
    payoutSnapshot: smallint("payout_snapshot").notNull(),

    // ---- Grading config ----
    gradingSource: gradingSourceEnum("grading_source").notNull(),
    // For auto_*: which API field/aggregate to fetch.
    //   e.g. { stat: 'corners', agg: 'sum_over_day' }
    //   e.g. { stat: 'home_score', match: '<uuid>' }
    // For manual: null.
    gradingConfig: jsonb("grading_config").$type<GradingConfig | null>(),
    // The resolved value once the bet has been graded.
    // yes_no    → boolean
    // number    → number
    // multi_choice → string (one of answerConfig.options)
    // free_text  → string
    resolvedValue: jsonb("resolved_value").$type<ResolvedValue | null>(),

    // ---- Lifecycle ----
    status: betStatusEnum("status").notNull().default("draft"),
    lockAt: timestamp("lock_at", { withTimezone: true }).notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    gradedAt: timestamp("graded_at", { withTimezone: true }),
    gradedBy: uuid("graded_by").references(() => profiles.id),

    // ---- Bookkeeping ----
    createdBy: uuid("created_by").notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull().defaultNow(),
  },
  (t) => ({
    scopeIdx: index("custom_bets_scope_idx").on(t.scope),
    matchdayIdx: index("custom_bets_matchday_idx").on(t.matchdayId),
    matchIdx: index("custom_bets_match_idx").on(t.matchId),
    statusIdx: index("custom_bets_status_idx").on(t.status),
    lockIdx: index("custom_bets_lock_idx").on(t.lockAt),
  }),
);
```

DB‑level enforcement (raw SQL in migration):
```sql
-- Exactly one scope key set, matching the scope.
ALTER TABLE custom_bets ADD CONSTRAINT scope_keys_consistent CHECK (
  (scope = 'match'      AND match_id     IS NOT NULL AND matchday_id IS NOT NULL) OR
  (scope = 'day'        AND matchday_id  IS NOT NULL AND match_id IS NULL) OR
  (scope = 'stage'      AND stage        IS NOT NULL) OR
  (scope = 'group'      AND group_id     IS NOT NULL) OR
  (scope = 'tournament' AND matchday_id IS NULL AND match_id IS NULL AND stage IS NULL AND group_id IS NULL)
);
ALTER TABLE custom_bets ADD CONSTRAINT grading_rule_non_empty CHECK (
  length(grading_rule_he) >= 3 AND length(grading_rule_en) >= 3
);
ALTER TABLE custom_bets ADD CONSTRAINT stake_nonneg CHECK (stake_snapshot >= 0);
ALTER TABLE custom_bets ADD CONSTRAINT payout_positive CHECK (payout_snapshot >  0);
```

### 4.4 `user_custom_bet_picks`

One row per (user, custom_bet). Answer stored as JSONB so we can carry
all four answer types in one column without future schema work.

```ts
export const userCustomBetPicks = pgTable(
  "user_custom_bet_picks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    customBetId: uuid("custom_bet_id").notNull()
      .references(() => customBets.id, { onDelete: "cascade" }),

    // The user's pick. Shape mirrors resolvedValue at the bet row.
    answer: jsonb("answer").$type<PickAnswer>().notNull(),
    // Stake actually deducted from the bank when the pick was placed.
    // Snapshots customBets.stakeSnapshot at submit time. Refunded on
    // bet cancel / reversal.
    stakePaid: smallint("stake_paid").notNull(),
    pointsEarned: smallint("points_earned"),    // null until graded
    wasCorrect: boolean("was_correct"),

    locked: boolean("locked").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull().defaultNow(),
  },
  (t) => ({
    uniqUserBet: uniqueIndex("user_custom_bet_picks_uniq")
      .on(t.userId, t.customBetId),
    userIdx: index("user_custom_bet_picks_user_idx").on(t.userId),
    betIdx: index("user_custom_bet_picks_bet_idx").on(t.customBetId),
  }),
);
```

### 4.5 `bet_grading_audit`

Append‑only log of every grading event so a reversal is non‑destructive.
Reviewer 1 / Reviewer 5 blind spot from the council pass — kept even
though the council itself was overruled, because the user's own rule 13
(security/safety from day 1) and rule 14 (observability) demand it.

```ts
export const betGradingAudit = pgTable(
  "bet_grading_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customBetId: uuid("custom_bet_id").notNull()
      .references(() => customBets.id, { onDelete: "cascade" }),
    action: text("action").notNull(),  // 'grade' | 'reverse' | 'cancel'
    previousStatus: betStatusEnum("previous_status"),
    newStatus: betStatusEnum("new_status").notNull(),
    previousResolvedValue: jsonb("previous_resolved_value"),
    newResolvedValue: jsonb("new_resolved_value"),
    reason: text("reason").notNull(),  // mandatory; >=3 chars
    performedBy: uuid("performed_by").notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    performedAt: timestamp("performed_at", { withTimezone: true })
      .notNull().defaultNow(),
  },
  (t) => ({
    betIdx: index("bet_grading_audit_bet_idx").on(t.customBetId),
    timeIdx: index("bet_grading_audit_time_idx").on(t.performedAt),
  }),
);
```

DB enforcement:
```sql
REVOKE UPDATE, DELETE ON bet_grading_audit FROM PUBLIC;
ALTER TABLE bet_grading_audit ADD CONSTRAINT reason_non_empty
  CHECK (length(reason) >= 3);
```

### 4.6 `settings` — new columns

Default stakes and payouts per answer type. Per‑bet overrides are
captured by `customBets.stakeSnapshot` / `payoutSnapshot`.

```ts
// Default stake / payout per answer type. Bet creation copies these
// into the row's snapshot fields unless admin overrides.
stakeYesNo:        smallint("stake_yes_no").notNull().default(1),
payoutYesNo:       smallint("payout_yes_no").notNull().default(3),
stakeNumber:       smallint("stake_number").notNull().default(2),
payoutNumber:      smallint("payout_number").notNull().default(6),
stakeMultiChoice:  smallint("stake_multi_choice").notNull().default(2),
payoutMultiChoice: smallint("payout_multi_choice").notNull().default(5),
stakeFreeText:     smallint("stake_free_text").notNull().default(3),
payoutFreeText:    smallint("payout_free_text").notNull().default(10),
```

### 4.7 Columns / tables to drop in this PR

- `match_bets.bet_btts`, `bet_over_25`, `bet_ht_home`, `bet_ht_away`
- `match_bets.points_btts`, `points_over_25`, `points_ht`
- `match_bets.stake_paid_btts`, `stake_paid_over_25`, `stake_paid_ht`
- `settings.scoring_btts`, `scoring_over_25`, `scoring_ht_exact`,
  `scoring_ht_outcome`, `stake_btts`, `stake_over_25`, `stake_ht`
- `settings.scoring_top_scorer`, `scoring_final_penalties`,
  `stake_top_scorer`, `stake_final_penalties` (moved to per‑bet snapshot)
- `settings.scoring_group_team`, `scoring_group_perfect`,
  `stake_group_team`, `scoring_champion`, `scoring_runner_up`,
  `scoring_third`, `scoring_fourth`, `stake_bracket_*` (same reason)

Tables `group_predictions`, `bracket_predictions`, `special_bets` are
**not dropped** in this PR — see §10.2 (seed/migrate strategy) for how
their data moves into `user_custom_bet_picks`. After the migration
script runs in production, they can be dropped in a follow‑up PR once
the leaderboard query has been swapped.

### 4.8 TypeScript helper types (`src/lib/bets/types.ts`)

```ts
export type AnswerConfig =
  | { kind: "yes_no" }
  | { kind: "number"; min?: number; max?: number; unit?: "goals" | "corners" | "cards" | "shots" | "minutes" | "" }
  | { kind: "multi_choice"; options: Array<{ value: string; labelHe: string; labelEn: string }> }
  | { kind: "free_text"; placeholderHe?: string; placeholderEn?: string };

export type GradingConfig =
  | { source: "auto_balldontlie"; stat: string; aggregate: "sum_day" | "per_match" | "first_match" }
  | { source: "auto_football_data"; field: "home_score" | "away_score" | "winner" | "ht_score" }
  | null;

export type ResolvedValue =
  | { type: "yes_no"; value: boolean }
  | { type: "number"; value: number }
  | { type: "multi_choice"; value: string }
  | { type: "free_text"; value: string };

export type PickAnswer = ResolvedValue; // identical shape
```

---

## 5. Pricing model

Two layers, both live in `settings` for admin tuning:

1. **Defaults by answer type** (§4.6). Reasonable starting numbers that
   produce a non‑degenerate game even before any per‑bet tuning.
2. **Per‑bet override** captured on `customBets.stakeSnapshot` and
   `payoutSnapshot` at creation. Frozen for the bet's lifetime so a
   later settings tweak does not retroactively re‑price a saved pick.

Net change on user balance (mirrors existing points‑bank semantics):
- Correct pick: `+payoutSnapshot − stakeSnapshot` net (the row's
  `pointsEarned` stores the gross payout for compatibility with the
  existing leaderboard query, which already subtracts `stake_paid_*`).
- Wrong pick: `−stakeSnapshot` net (only the stake debit; `pointsEarned`
  is set to `0`).

### Multiple‑choice payout note

For multi‑choice with N options, the default payout is high enough that
a coin‑flip strategy is a losing one (`payout < stake × N`). The
defaults above (stake 2, payout 5) yield EV‑neutral at N=2.5; admin
should bump payout for bets with many options (e.g. top scorer of a day
with 10 plausible players).

---

## 6. Grading pipeline

### 6.1 Sources

```
gradingSource = 'auto_balldontlie'  → fetch from balldontlie GOAT
gradingSource = 'auto_football_data' → score-derived bets (free, wired today)
gradingSource = 'manual'            → admin enters resolvedValue
```

**Phase split:**
- **Now → ~2026‑06‑08:** balldontlie not subscribed yet. The
  `auto_balldontlie` enum value exists in the schema and the wrapper
  file is built as a **stub** (§6.5). Admin authoring UI still offers
  "balldontlie auto" as a grading source, but the wrapper currently
  short‑circuits to a "subscription required" error. Any bet authored
  with that source today sits in `status='locked'` after lock time
  and waits for either (a) the admin to flip its source to `manual`
  and grade it, or (b) the balldontlie integration to go live.
- **~2026‑06‑08 onwards (1 week before kickoff):** activate the 48h
  GOAT trial, run §10.0 verification, set `BALLDONTLIE_ENABLED=true`,
  flip subscription to paid before trial expires.

### 6.2 Auto‑grading hook

After every `scoreFinalMatches()` pass (which already fires on match
finalization in `src/lib/sync.ts`), append a new pass:

```ts
async function gradeAutoCustomBets() {
  // Find all custom_bets in status='locked' where scope matches a
  // matchday that is now fully final, OR a match that is now final.
  // For each, call the appropriate API helper to compute resolvedValue,
  // then transition status → 'graded' and credit picks.
}
```

Helpers live in `src/lib/grading/`:
- `balldontlie.ts`: `fetchMatchStats(matchId)`, `fetchMatchdayStats(date)`
  with rate‑limit budget (600 req/min on GOAT — fine).
- `football_data.ts`: existing wrapper; used as fallback when
  balldontlie returns 5xx or missing fields. Already in repo.
- `compute.ts`: pure aggregator. Given `GradingConfig` and stat
  payload, returns `ResolvedValue`.

### 6.3 Manual grading admin surface

`/[lang]/admin/bets/[id]/grade` page:
- Shows bet, pick distribution among players, all current picks.
- Input matches `answerType` (yes/no toggle, number input, MC dropdown,
  text area).
- Mandatory `reason` textarea (≥3 chars). Saved into
  `bet_grading_audit.reason`.
- Confirm → server action grades the bet inside a serializable txn.

### 6.4 Reversal flow

Same page exposes "Reverse grading" once status='graded'. Re‑opens the
bet to manual editing, audits to `bet_grading_audit` (action='reverse'),
re‑credits stakes / re‑debits payouts atomically. Bank balances stay
consistent because the leaderboard query reads
`COALESCE(points_earned, 0) − stake_paid` and never trusts a cached
balance. See §11 for security.

### 6.5 Phase 1 grading without balldontlie

A flag `BALLDONTLIE_ENABLED` (default `false`) gates the wrapper. When
false, the wrapper exports the same function signatures but every call
returns `null` and emits `console.warn('[balldontlie stubbed]', ...)`.
The grading pass treats a `null` result the same as "API unavailable":
the bet stays in `status='locked'`, picks remain unresolved, and the
admin grade UI surfaces it in a "Needs manual grade" queue. No data
loss, no failed inserts.

**What we can auto‑grade today (football‑data only).** Anything
derivable from the existing `matches.home_score`, `away_score`,
`ht_home_score`, `ht_away_score`, `went_to_penalties`, and the top
scorers endpoint:

| Bet idea | Answer type | Grading config |
|---|---|---|
| Both teams to score | yes_no | `home>0 AND away>0` |
| Match winner / draw | multi_choice | from fullTime score |
| Clean sheet (either side) | yes_no | `home=0 OR away=0` |
| Over/Under N total goals | yes_no | `home+away > N` |
| Exact total goals | number | `home+away` |
| Halftime exact score | multi_choice (limited grid) | from htScore |
| Halftime winner | multi_choice (1/X/2) | from htScore |
| HT/FT combination | multi_choice (9 options) | composite |
| Goal difference | number | `abs(home-away)` |
| Second‑half goals | number | `(home-htHome)+(away-htAway)` |
| Will the final go to penalties | yes_no | `went_to_penalties` |
| Total goals across all today's matches | number | `SUM(home+away)` over matchday |
| Most goals in a match today | number | `MAX(home+away)` over matchday |
| Will any match today be a draw | yes_no | exists match with `home=away` |
| Tournament champion | multi_choice | bracket result |
| Top scorer | multi_choice (or free_text) | `fetchTopScorers` top result |
| 3rd / 4th place | multi_choice | bracket result |

**What waits for balldontlie** (admin authors with `gradingSource='manual'`
for now, can flip to `auto_balldontlie` after activation):

| Bet idea | Why it waits |
|---|---|
| Total corners (match / day) | needs corner count |
| Total yellow/red cards | needs card events |
| Possession over X% | needs possession % |
| Total shots / shots on target | needs shot count |
| First scorer | needs goal events with scorer + minute |
| xG over/under | needs advanced metrics |
| Player‑specific stats | needs player match stats |

These are still authorable today — they just queue for manual grading.
The friends decide who scored first by looking it up; admin types the
answer. Once balldontlie is live, the same bets become auto‑graded by
flipping their grading source.

---

## 7. Server actions

All under `src/app/[lang]/admin/bets/actions.ts` and
`src/app/[lang]/play/[date]/actions.ts`. Every server action:

1. Auth check (`getUser` from `src/lib/supabase/auth`).
2. Role check via `requireAdmin(locale)` for admin actions.
3. Paid‑access check via `getUserAccess` for pick submission.
4. Serializable transaction with `pg_advisory_xact_lock(hashtext(userId))`
   for any path that touches the bank.
5. Namespaced `console.info`/`console.warn` logs (§14).

### 7.1 Admin actions

```
createCustomBet(payload)
updateCustomBet(id, patch)           // draft / open only
publishCustomBet(id)                 // draft → open
lockCustomBet(id)                    // open → locked
gradeCustomBet(id, resolvedValue, reason)
reverseCustomBetGrading(id, reason)
cancelCustomBet(id, reason)          // refunds all stakes
```

### 7.2 Player actions

```
submitCustomBetPick(customBetId, answer)
editCustomBetPick(customBetId, answer)  // only while status='open' and now<lockAt
clearCustomBetPick(customBetId)         // same gate; refunds stake
```

### 7.3 Stake / refund symmetry

`submitCustomBetPick`:
```
1. Lock advisory(userId).
2. Verify bet.status='open' AND now < bet.lockAt.
3. Verify bet.stakeSnapshot ≤ getBankBalance(userId).
4. Upsert userCustomBetPicks (userId, customBetId) with answer, stakePaid=bet.stakeSnapshot.
5. console.info('[custom-bet stake]', {...}).
```

`editCustomBetPick` and `clearCustomBetPick`:
- Idempotent. Refund the existing `stakePaid`, then re‑debit if the new
  pick is non‑empty. Same advisory lock + same console namespace.

---

## 8. Admin UX

### 8.1 `/[lang]/admin/bets`

The single CRUD surface (Executor's rec, applied even under override).

Mobile‑first layout:
- Filter row: Date picker / scope chip / status chip / search by question.
- Stacked cards under `md`; data table at `md+`.
- Each row: question (truncated), scope chip, status chip, lock time,
  pick count, "Grade" or "Edit" CTA.
- FAB: "New bet" → modal sheet.

### 8.2 "New bet" modal sheet

One scrollable sheet, top‑down:

1. **Scope picker** (segmented control): Match · Day · Stage · Group · Tournament.
2. **Anchor picker** (depends on scope): match dropdown / date picker /
   stage dropdown / group dropdown / nothing.
3. **Question (HE + EN)** — two inputs, side by side on `md+`, stacked
   on mobile.
4. **Grading rule (HE + EN)** — same shape. Helper text: "מה בדיוק
   ייספר? משפט אחד שאי אפשר לפרש לרעה."
5. **Answer type** — radio: Yes/No · Number · Multi · Free text.
6. **Answer config** — dynamic block based on type.
7. **Pricing** — Stake & Payout, prefilled from settings defaults.
   Two number steppers; tap "Reset to default" reverts.
8. **Grading source** — radio: balldontlie · football‑data · Manual.
   When auto: a "Stat" dropdown populated from the supported list
   (goals, corners, cards, shots, possession, etc.) + aggregate
   (per‑match / sum‑over‑day).
9. **Lock time** — datetime input. Defaults to 5 min before the
   earliest relevant kickoff. Asia/Jerusalem displayed; UTC stored.
10. **Save as draft / Publish** — two buttons.

### 8.3 Grade view

Per §6.3. One bet, all picks visible, resolution input + reason. After
grade, status flips to `graded` and the bet appears collapsed in the
list with a "Reverse" link.

### 8.4 Settings → Scoring

Extend `/[lang]/admin/settings/scoring` (already exists) with the four
answer‑type default rows. Banner: "השינויים יחולו רק על הימורים חדשים."

---

## 9. Player UX

The player surface splits by **bet scope**, never folds all bets onto
one page. Tournament‑wide one‑shot bets (champion, top scorer, final
specials, group rankings) are time‑boxed predictions made *once*, and
they do not belong on a calendar‑day surface. Matchday and match bets
are short‑lived and belong with the day they fire on.

### 9.1 `/[lang]/play` — daily play index

Lists every matchday with at least one open bet, ordered by date asc.
Each row: date label + flag strip + count of open bets. Tap → date
page. Top of the page exposes two pinned cards:

- **"הימורי טורניר"** → `/play/tournament` (tournament‑wide one‑shots)
- **"דירוגי בתים"** → `/play/groups` (group rankings)

These pinned cards stay visible across the whole tournament until the
relevant bets lock; that way a returning user always sees the "big
picture" bets without having to scroll past every daily card.

### 9.2 `/[lang]/play/[date]` — matchday detail

`[date]` is `YYYY-MM-DD` in Asia/Jerusalem. Replaces the role of
`/bets/[matchId]` for everything except the 1/X/2 score input.

Layout (mobile‑first):
- Header: "יום שלישי, 11 ביוני 2026" (rule 10 — no "matchday"
  vocabulary). Flag iconography summarising who plays today.
- Section 1: **Fixtures**. One card per match with the existing 1/X/2
  + scoreboard widget (re‑uses `BetForm` minus the BTTS/Over/HT block).
- Section 2: **Day‑scope bets**. Card per custom bet with the answer
  widget rendered per `answerType`. Each card shows the grading rule
  in plain text above the input.
- Section 3: **Match‑scope bets** for each fixture, grouped under the
  match they target.
- Sticky bottom: bank widget + "Save picks" CTA.

> Only bets with `scope IN ('match','day')` ever render here. Stage /
> group / tournament bets are intentionally absent so a player checking
> "today's bets" sees today's bets — not the whole season.

### 9.3 `/[lang]/play/tournament` — tournament‑wide bets

The dedicated surface for `scope='tournament'` and `scope='stage'`
custom bets. Replaces the conceptual role of the legacy `/specials`
and `/bracket` routes; reads from the unified `custom_bets` table.

Layout:
- Header: "הימורי טורניר" + a short helper sentence ("ניחושים
  חד‑פעמיים על כל הטורניר. נסגרים בשריקת הפתיחה של המשחק הראשון
  שמושפע.").
- Sections by `customBets.stage` when present (Group / R16 / QF / SF /
  Final), with an "ללא שלב" section for fully tournament‑scope bets.
- Each bet renders as a card identical in shape to the matchday cards
  (grading rule above the answer input, stake/payout chip, lock time).
- Sticky bank widget at the bottom.

Examples this page hosts:
- "מי יזכה במונדיאל?" (multi_choice over 32 teams)
- "סגן אלוף" / "מקום שלישי" / "מקום רביעי" (multi_choice each)
- "מלך השערים" (free_text or multi_choice over a top‑scorers list
  fetched from balldontlie)
- "האם הגמר ייפסק בפנדלים?" (yes_no)
- "כמה שערים יוקלעו במונדיאל?" (number)
- "האם תהיה הפתעה ברבע הגמר?" (yes_no, scope='stage' stage='qf')

### 9.4 `/[lang]/play/groups` — group rankings

The dedicated surface for `scope='group'` custom bets. Replaces the
conceptual role of the legacy `/standings` predictor.

Layout:
- One panel per group (A..H). Each panel is a self‑contained card with
  the four team flags and that group's custom bets stacked beneath.
- The seeded migration creates one `custom_bets` row per (group ×
  predicted_rank), so each panel typically has 4 multi‑choice cards
  ("מקום ראשון בבית A", "מקום שני בבית A"…). Admin can also add ad‑hoc
  group bets ("האם בית C יסתיים עם תיקו ביניים?" — yes_no).
- Sticky bank widget at the bottom.

### 9.5 Legacy routes during cutover

`/bets`, `/standings`, `/bracket`, `/specials` stay live behind the
`UI_FALLBACK_LEGACY` flag (§10.4) for the first week of the tournament
as the rollback path. Once the safety window passes and the legacy
tables are dropped, those routes return `notFound()`.

### 9.6 Leaderboard

The query in `src/db/queries.ts:getLeaderboard` is rewritten to:
```
base balance = settings.starting_bank
             + Σ match_bets.points_earned          (1/X/2)
             − Σ match_bets.stake_main             (stays 0 today)
             + Σ user_custom_bet_picks.points_earned
             − Σ user_custom_bet_picks.stake_paid
             + Σ point_adjustments.delta
```
The old per‑column BTTS / Over / HT sums are removed; bracket / group /
specials sums are removed once the migration script finishes. The
tie‑breaker (`wasted_stakes`) is re‑expressed against `user_custom_bet_picks`.

---

## 10. Migration plan

### 10.0 PREREQUISITE — verify balldontlie WC coverage (deferred to ~2026‑06‑08)

Not a blocker for the schema work or any code that ships before
kickoff. The wrapper is built as a stub (§6.5) so we can develop the
whole pipeline against football‑data only and flip a flag later.

When you're ready (suggested ~1 week before kickoff so the paid month
overlaps the tournament):

1. Activate the GOAT 48h free trial.
2. Hit a recent friendly or qualifier endpoint. Confirm presence of
   goals, corners, yellow_cards, shots, possession, plus a stable
   match identifier we can map to our `matches.api_fixture_id`.
3. Hit a 2026 WC fixture (scheduled or live). Confirm coverage exists.

**Outcome A** (coverage confirmed): set `BALLDONTLIE_ENABLED=true`,
flip trial to paid before the 48h expire.
**Outcome B** (coverage missing or unstable): keep `BALLDONTLIE_ENABLED=false`.
Bets that wanted auto_balldontlie stay queued for manual grading — no
schema change needed.

Document the result in `_plans/2026-06-08-balldontlie-verification.md`
when you do it.

### 10.1 Migration `0009_matchday_custom_bets.sql`

Additive only. Drops are deferred to a follow‑up migration so call
sites that still read legacy columns can be updated in their own PRs
without breaking compilation.

1. Create the four new enums (§4.1).
2. Create tables `matchdays`, `custom_bets`, `user_custom_bet_picks`,
   `bet_grading_audit` with all FKs, indexes, and CHECK constraints.
3. Add the new `settings` columns (§4.6) with defaults so the existing
   row auto‑backfills.
4. RLS policies + `REVOKE UPDATE, DELETE ON bet_grading_audit FROM PUBLIC;`

Hand‑written SQL (matches the project's style — see
`0006_points_bank.sql`). The drops listed in §4.7 land in a follow‑up
migration (tentatively `0010_drop_legacy_bet_columns.sql`) after the UI
and queries no longer reference them.

### 10.2 Data migration script (`scripts/migrate-legacy-bets.ts`)

For each existing tournament‑level bet table, generate equivalent
`custom_bets` + `user_custom_bet_picks` rows. Run once after schema
deployment, idempotent (uses a `migration_marker` text on each new
custom bet to skip re‑runs).

Outline:
- For each `special_bets.bet_type`:
  - Seed one `custom_bets` row with `scope='tournament'`, the right
    `answer_type` (top_scorer → free_text; final_penalties → yes_no),
    pricing snapshot from the soon‑to‑drop settings, status='locked',
    `grading_source='manual'`.
  - Insert a `user_custom_bet_picks` row per existing `special_bets`
    row, copying `stake_paid` and `points_earned`.
- For each bracket slot (champion / runner_up / third / fourth):
  - One `custom_bets` row per slot, `scope='tournament'`,
    `answer_type='multi_choice'` with all team codes as options.
  - Pick rows mirror `bracket_predictions`.
- For each (group × predicted_rank):
  - One `custom_bets` row, `scope='group'`,
    `answer_type='multi_choice'` listing the 4 teams in that group.
  - Pick rows mirror `group_predictions`.

After the script verifies row counts match, the leaderboard query is
swapped to read from `user_custom_bet_picks`. The legacy tables stay
live‑readable for one week as a safety net, then dropped in a follow‑up
migration.

### 10.3 Cutover sequence

| Day | Action |
|-----|--------|
| 2026‑05‑26 | Migration 0008 in dev; schema PR ready for review |
| 2026‑05‑27 | Admin CRUD UI lands in dev (§8) |
| 2026‑05‑28 | Player surface `/play/[date]` lands in dev (§9.2) |
| 2026‑05‑29 | `/play/tournament` + `/play/groups` surfaces (§9.3–9.4) |
| 2026‑05‑30 | Grading pipeline with football‑data only (§6) + balldontlie stub (§6.5) |
| 2026‑05‑31 | Migration script (§10.2) runs against a prod DB snapshot in dev |
| 2026‑06‑01 | Leaderboard query swap + smoke test |
| 2026‑06‑02 | First end‑to‑end QA pass: mobile 360/414/768/1024/1440; Hebrew RTL; pay‑gate |
| 2026‑06‑03 | Banner draft: "המערכת התעדכנה — בדוק את ההימורים הקבוצתיים שלך" |
| 2026‑06‑04 | Scope freeze recommended (not enforced). Bug fixes preferred. |
| 2026‑06‑05–07 | QA, polish, screenshots, bank audit smoke test |
| 2026‑06‑08 | balldontlie verification (§10.0). If green: flip `BALLDONTLIE_ENABLED=true`, subscribe before 48h trial ends. |
| 2026‑06‑09–10 | Auto‑grade smoke test on a recent friendly via balldontlie (if subscribed) |
| 2026‑06‑11 | Tournament kickoff. |

### 10.4 Rollback

The legacy tables stay readable for the first week of the tournament.
If the new system explodes, a single feature flag (`UI_FALLBACK_LEGACY`)
toggles `/bets`, `/standings`, `/bracket`, `/specials` back on and the
leaderboard query reverts. Server actions for the legacy tables are
kept commented out but not removed during the cutover week.

---

## 11. Security (rule 13)

- `requireAdmin(locale)` gate on every admin route (already exists,
  `src/lib/admin.ts`).
- Grading and pick submission run inside `SERIALIZABLE` transactions
  with `pg_advisory_xact_lock(hashtext(userId))` (existing pattern from
  points‑bank plan §6).
- `bet_grading_audit` insert: server‑validated `reason.length>=3`,
  `performedBy=session.id` (never trusted from client).
- `REVOKE UPDATE, DELETE ON bet_grading_audit FROM PUBLIC;` — audits
  are physically immutable.
- Reversal does NOT delete the prior grade row; it inserts a new audit
  row with `action='reverse'` and atomically flips status + clears
  `points_earned` on every affected pick.
- Server is the only authority on bank balance — no client‑supplied
  balance is ever trusted.
- balldontlie API key stored in env (`BALLDONTLIE_API_KEY`), never in
  code, never in client bundles. Rate‑limit budget enforced in
  `src/lib/grading/balldontlie.ts` so a buggy admin can't accidentally
  blow the per‑minute quota.
- Inputs: every `answer` JSONB shape is validated against
  `customBets.answerConfig` server‑side. Strings clamped to 200 chars
  (free_text) to prevent absurd payloads.
- PII: `bet_grading_audit.reason` is free‑text. Add inline hint on the
  admin form: "אל תכתוב מידע אישי — הטקסט נשמר לעד."

---

## 12. Observability (rule 14)

Every event emits a namespaced log so the running app is debuggable
without redeploying.

| Event | Namespace | Log shape |
|-------|-----------|-----------|
| Admin creates a bet | `[bet create]` | `{ id, scope, answerType, stake, payout, createdBy }` |
| Admin publishes a bet | `[bet publish]` | `{ id, lockAt }` |
| Admin locks a bet (auto via cron) | `[bet lock]` | `{ id, picksCount }` |
| Player submits a pick | `[custom-bet stake]` | `{ userId, betId, cost, oldBalance, newBalance }` |
| Stake refunded (edit/clear) | `[custom-bet refund]` | `{ userId, betId, refund, newBalance }` |
| Insufficient bank rejection | `[custom-bet rejected]` | `{ userId, betId, cost, balance }` |
| Auto grading success | `[grading auto]` | `{ betId, source, resolvedValue, picksGraded }` |
| Auto grading fallback | `[grading fallback]` | `{ betId, fromSource, toSource, error }` |
| Manual grading | `[grading manual]` | `{ betId, resolvedValue, reason, by }` |
| Reversal | `[grading reverse]` | `{ betId, prevValue, by, reason, picksReverted }` |
| Settings change | `[settings updated]` | `{ field, oldValue, newValue, by }` |
| balldontlie call | `[balldontlie call]` | `{ endpoint, status, ms, rateRemaining }` |

All logs surface in Vercel by default; no extra deps. Production
dashboards (Supabase logs explorer) can grep by namespace.

---

## 13. Settings audit (rule 15)

New exposed controls in `/[lang]/admin/settings/scoring`:

- Default stake & payout per answer type (8 fields, §4.6).
- Default lock minutes before kickoff (already exists).

Each control has:
- A clear Hebrew + English label.
- A "Why" tooltip (rule 10) — e.g. "כמה נקודות עולה הימור Yes/No
  בברירת מחדל. ניתן לשנות פר‑הימור."
- Banner: שינויים יחולו רק על הימורים חדשים — הימורים קיימים שומרים
  את הסכומים שלהם.

---

## 14. UI/UX bar (rule 16)

- The word "matchday" never appears in player‑facing copy. Pages are
  titled by date label only.
- Every custom bet card surfaces its grading rule prominently *above*
  the answer input (rule 10).
- Touch targets ≥ 44px. Number stepper for the Number answer type
  reuses the existing scoreboard stepper from `BetForm.tsx`.
- Multi‑choice rendered as ChoicePill grid (re‑use existing component);
  options wrap to multiple rows under `md` if more than 3 options.
- Free text: 48px tall, `font-size: 16px` (no iOS zoom).
- Sticky bank widget on every authenticated page (already shipped).
- No horizontal scroll on any new surface at 360px (project rule).
- Empty state on `/play` ("אין הימורים פתוחים כרגע") with a CTA back
  to `/bets`.

---

## 15. QA checklist (rule 6)

Walk these in a prod‑like data load before declaring done.

**Golden path:**
- [ ] Admin creates a Yes/No matchday bet, publishes, lock fires, grades
      manually → all picks resolved, bank reflected.
- [ ] Admin creates a Number day‑scope bet ("סך קרנות היום"), publishes,
      players submit picks, balldontlie returns the value, auto‑grading
      runs, bank reflected.
- [ ] Admin creates a Multi‑choice tournament bet (top scorer),
      publishes, players pick a player, grades at end of tournament.
- [ ] Admin creates a Free‑text tournament bet, publishes, players submit,
      grades manually.
- [ ] Reversal of a wrongly graded bet → bank balances revert atomically.

**Edge cases:**
- [ ] Two browser tabs submit the same pick simultaneously → advisory
      lock holds; only one row.
- [ ] User edits a pick after lockAt → server rejects.
- [ ] Bet cancelled by admin mid‑flight → all stakes refunded.
- [ ] Stake cost exceeds balance → form disabled, server rejects with
      `INSUFFICIENT_BANK`.
- [ ] Admin sets stake to 0 in settings → new bets free; existing
      stakes unchanged.
- [ ] balldontlie rate‑limited (429) → grading falls back to manual
      queue; admin notified.
- [ ] Migration script run twice → idempotent; no duplicate rows.
- [ ] Legacy `special_bets` / `bracket_predictions` / `group_predictions`
      rows preserved during the 1‑week safety window.

**Mobile / RTL:**
- [ ] `/play/[date]` at 360px: no overflow, all bets readable.
- [ ] Admin "New bet" sheet at 360px: every field tappable, no clipping.
- [ ] Hebrew long strings ("האם הגמר ייפסק בפנדלים?") wrap correctly.
- [ ] Grading rule text wraps cleanly above the answer input.
- [ ] Date labels render in Asia/Jerusalem via `formatDateTime`.

**Regressions:**
- [ ] 1/X/2 bets still gradeable from `scoreFinalMatches()`.
- [ ] Existing points‑bank balances unchanged post‑migration.
- [ ] Leaderboard query produces the same numbers ±0 for users with no
      legacy side bets and only main picks.
- [ ] Pay‑gate still works (`PayGateBanner` shows on `/play` for
      unpaid users).

---

## 16. Known risks

Real items worth tracking. None are blocking — pool runs on whatever
ships, and missing pieces can land mid‑tournament.

| # | Risk | Mitigation |
|---|------|------------|
| 1 | balldontlie 2026 WC coverage might be partial | §10.0 verification step. If coverage is thin, default `gradingSource` to `manual`; auto‑grading wires in later. Schema is the same either way. |
| 2 | Migration of bracket/group/specials introduces row‑count or scoring drift | Migration script writes only — never deletes — legacy tables. 1‑week safety window before legacy is dropped. Leaderboard parity smoke test on 2026‑06‑01. |
| 3 | Some surfaces may not be ready by 2026‑06‑11 | Acceptable. Ship what's ready; the rest lands during the group stage. Yes/No + Number bets can run on day 1 even if MC / free‑text slip. |
| 4 | Grading disputes during the tournament | Mandatory grading‑rule field (§4.3) + reversal flow (§6.4) + audit log (§4.5) make disputes resolvable. |
| 5 | Admin asleep when a 21:00 match ends | Auto‑grading runs server‑side via the existing cron. Manual‑graded bets queue safely in `status='locked'` until you get to them. |
| 6 | Player confusion at the new layout | Migration banner on first authenticated visit (§10.3 day 2026‑06‑03); legacy `/bets`, `/standings`, `/bracket`, `/specials` surfaces stay live behind the `UI_FALLBACK_LEGACY` flag for the first week as a return path. |
| 7 | Free‑text grading edge cases | Test cases in §15. Consider capping free‑text bets at ~2 per matchday via a settings switch if it gets noisy in practice. |

---

## 17. What we are explicitly NOT doing

- No `bet_templates` reusability layer in v1. If admin re‑authoring
  proves painful by week 2, add a duplicate‑bet button as a quick win.
- No live in‑play markets (xG momentum etc.) — schema permits but UI
  doesn't ship in v1.
- No shareable bet cards / WhatsApp deep links — flagged as a high‑value
  follow‑up.
- No multi‑pool / white‑label refactor (`bet_templates.pool_id`). The
  table includes `createdBy` so adding `pool_id` later is additive.
- No retroactive grading of legacy BTTS/Over/HT data — that data is
  wiped per the locked decision in §3.
- No automatic "co‑grader" or admin‑backup role — single admin remains
  the source of truth; reversal flow is the safety valve.

---

## 18. Files touched (high‑level inventory)

- `src/db/schema.ts` — new enums, 4 new tables, settings columns, drops
- `src/db/queries.ts` — leaderboard query rewrite, new `getMatchday()` helper
- `src/db/migrations/0008_matchday_custom_bets.sql` — migration
- `src/lib/bets/types.ts` — new helper types
- `src/lib/grading/balldontlie.ts` — API wrapper
- `src/lib/grading/compute.ts` — pure aggregator
- `src/lib/grading/index.ts` — `gradeAutoCustomBets()` exported
- `src/lib/sync.ts` — hook the new grading pass into the existing run
- `src/app/[lang]/admin/bets/page.tsx` + `BetTable.tsx` + `BetSheet.tsx`
- `src/app/[lang]/admin/bets/[id]/grade/page.tsx` + `GradeForm.tsx`
- `src/app/[lang]/admin/bets/actions.ts`
- `src/app/[lang]/admin/settings/scoring/...` — extend with new fields
- `src/app/[lang]/play/page.tsx` — daily play index + pinned tournament/groups cards
- `src/app/[lang]/play/[date]/page.tsx` + `PlayForm.tsx`
- `src/app/[lang]/play/[date]/actions.ts`
- `src/app/[lang]/play/tournament/page.tsx` + `TournamentBetsForm.tsx`
- `src/app/[lang]/play/tournament/actions.ts`
- `src/app/[lang]/play/groups/page.tsx` + `GroupBetsForm.tsx`
- `src/app/[lang]/play/groups/actions.ts`
- `src/app/[lang]/bets/[matchId]/BetForm.tsx` — strip BTTS/Over/HT
- `src/components/CustomBetCard.tsx` — shared player‑facing widget
- `scripts/migrate-legacy-bets.ts` — one‑shot data migration
- `src/lib/dictionaries/he.ts` + `en.ts` — new copy strings
- Various UI shells: bottom nav, dashboard summary cards

---
