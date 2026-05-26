# Betting Overhaul — Match Risk Toggle, Live-Bet Rename, Duels, Leaderboards, Transparency, Live View, Prizes

**Date:** 2026-05-27
**Status:** Draft — awaiting council pass + user approval before any code
**Owner:** Yoav

---

## 1. Goal

Re-shape the existing Toto Mundial pool around four bet surfaces (match
guessing, live bets, duels, tournament one-shots), a smaller 30-point
starting bank, a transparency surface, four category leaderboards, a
live-score view that recomputes the user's earnings as matches play,
and a defined prize split. The rules page is updated in lockstep with
every change.

The redesign reverses one locked decision from
`2026-05-25-points-bank-system.md` (the "main 1/X/2 is free" choice).
That reversal is explicit and gated by an admin toggle so the pool can
run in either mode.

---

## 2. Constraints (from `~/.claude/CLAUDE.md` and project `CLAUDE.md`)

- **Verify, never guess** (rule 1): API-Football `/odds` coverage,
  market list, response shape, and rate cost are all verified against a
  live request before the odds wiring goes near prod. See §10.
- **Clean ordered code** (rule 2): all new tables follow the Drizzle
  conventions in `src/db/schema.ts`. New routes follow the
  `src/app/[lang]/...` pattern. The rules page reads from
  `src/lib/dictionaries/he.ts` and `en.ts`; new copy slots into the
  existing `dict.rules.*` block, not into a new namespace.
- **Alignment before code** (rule 3): every decision in §3 is locked
  via this document. No code starts until §3 is signed off.
- **Project-style alternatives** (rule 4): three alternatives for the
  ratio source were presented; option A (bookmaker odds + manual
  override) was chosen. See §6.1.
- **Designs not AI-generated** (rule 5): all new surfaces re-use
  existing components (`Card`, `SectionHeading`, `LabelCaps`, etc.)
  and the existing color tokens. No new visual style introduced.
- **Mobile-first responsive** (project `CLAUDE.md`): every new surface
  tested at 360 / 414 / 768 / 1024 / 1440px. 44×44px touch targets.
  Tables become stacked cards under `md`. Asia/Jerusalem date rendering
  via `formatDateTime` from `src/lib/format.ts` (auto-memory enforced).
- **Plan saved to `_plans/`** (rule 7): this file.
- **Cost flagging** (rule 8): zero new paid services. API-Football
  Pro ($19/mo) is already paid; the `/odds` endpoint is included in
  Pro. No additional vendor.
- **Context7 before library code** (rule 9): consult Context7 for any
  Next.js 15 / Drizzle / Supabase API surface touched. App Router
  semantics changed in 15.
- **Lazy user** (rule 10): live-bet cards always show the grading rule
  above the answer input. Duel cards always show the opening user's
  question and stake. Live view always shows what the user picked
  alongside the live score, not a separate tab.
- **Council pass** (rule 11): the whole plan goes through `llm-council`
  before code. Mandatory; see §17.
- **Brutal honesty** (rule 12): §16 lists the real risks. The biggest
  one is that the new "risk-off" default for 1/X/2 is pure upside,
  which partially undoes the bank system's stated purpose. The user is
  aware and chose this for now.
- **Security from day 1** (rule 13): every admin path role-gated.
  Duel matching uses a serializable txn with an advisory lock keyed by
  duel id so two joiners can't both lock the same duel. Live-view
  endpoint is rate-limited per session.
- **Observability from day 1** (rule 14): namespaced `console.info` on
  every duel open / join / settle, every odds pull, every live-score
  recompute trigger. See §13.
- **Settings audit** (rule 15): every new tunable lives in the
  `settings` table. See §8.
- **UI/UX bar** (rule 16): the rules page MUST be updated in the same
  PR as any rule change. PR description must include a "Rules page
  diff" section. CI lint check (out of scope for this PR) flagged as a
  v2 nice-to-have.
- **Model selection neutrality** (rule 17): not applicable here.

---

## 3. Decisions locked

| # | Question | Decision |
|---|----------|----------|
| 1 | Starting bank | **30 points** (already set in `settings.starting_bank` per the user). |
| 2 | "Live bets" name | The existing `custom_bets` system with `scope='match'/'day'` is **renamed in UI / dictionaries** to "הימורי לייב" / "Live bets". Schema unchanged. |
| 3 | Match (1/X/2) scoring | Exact = **+15**. Direction-only = **+5**. Wrong = **0** by default. |
| 4 | Match risk toggle | New `settings.matchRiskEnabled` boolean (default **false**). When true, wrong = **−5**. When false, wrong = 0. Admin can flip mid-tournament; existing graded picks are NOT re-scored — only new gradings honor the new toggle. |
| 5 | Match guessing required? | **Yes — required on every fixture**, same as today. |
| 6 | Daily renewal | New `settings.dailyRenewalEnabled` boolean (default **false**) + `settings.dailyRenewalAmount` smallint (default 3). When enabled, each user gets +X at 00:00 Asia/Jerusalem every day. v1 implementation: a cron-triggered `point_adjustments` insert with reason "חידוש יומי" so it shows up in audit. |
| 7 | Duels | New 1v1 binary feature. Opener picks a Yes/No question + stake (≤5). Joiner must take the opposite answer. Winner: +stake net. Loser: −stake net. Stakes deducted on submit + join (not on open alone — see §6.3). If no joiner by deadline, duel auto-cancels, stakes refunded. |
| 8 | Live bet ratios | Pulled from **API-Football `/odds` endpoint** for fixtures and converted to our point system. Admin sees suggested bets per matchday, picks which to publish, can edit stake/payout per bet, and can add fully manual custom bets. |
| 9 | Transparency timing | All bets become visible to every signed-in user **after their lock time passes**. Before lock: visible only to the bet's owner. |
| 10 | Leaderboards | 4 tabs: **כללי / משחקים / לייב / דו-קרב**. King overall (1st/2nd/3rd) + a single winner for each of matches / live / duels. |
| 11 | King eligibility | The overall king IS eligible for category prizes (double-dipping allowed). User accepted the tradeoff. |
| 12 | Prize split | 30% king-1st, 12% king-2nd, 6% king-3rd, 15% matches-winner, 15% live-winner, 12% duels-winner, **10% reserve** (admin can release post-tournament). |
| 13 | Live match view | New page `/[lang]/live` that polls live scores via API-Football and recomputes the signed-in user's earnings projection per fixture in real time. Also surfaces other players' bets (only after each fixture's lock). |
| 14 | Rules page sync | EVERY PR in this series ships dictionary changes for `dict.rules.*` and modifies `src/app/[lang]/rules/page.tsx` if a new section is needed. No exceptions. |
| 15 | Cutover | 5-PR rollout. Each PR is independently deployable. Schema additions land in PR 1; legacy data preserved everywhere. |

---

## 4. Data model

### 4.1 `settings` — additions

```ts
// Match-guessing risk + renewal
matchRiskEnabled:           boolean("match_risk_enabled").notNull().default(false),
matchRiskPenalty:           smallint("match_risk_penalty").notNull().default(5),
dailyRenewalEnabled:        boolean("daily_renewal_enabled").notNull().default(false),
dailyRenewalAmount:         smallint("daily_renewal_amount").notNull().default(3),

// Duel limits
duelMaxStake:               smallint("duel_max_stake").notNull().default(5),
duelDefaultJoinWindow:      smallint("duel_default_join_window_hours").notNull().default(24),

// Live odds normalization
liveOddsBaseStake:          smallint("live_odds_base_stake").notNull().default(3),
liveOddsMaxPayout:          smallint("live_odds_max_payout").notNull().default(25),
liveOddsHouseEdge:          smallint("live_odds_house_edge_pct").notNull().default(5),

// Prize split (percentages, sum must be 100)
prizeKingFirstPct:          smallint("prize_king_first_pct").notNull().default(30),
prizeKingSecondPct:         smallint("prize_king_second_pct").notNull().default(12),
prizeKingThirdPct:          smallint("prize_king_third_pct").notNull().default(6),
prizeMatchesWinnerPct:      smallint("prize_matches_winner_pct").notNull().default(15),
prizeLiveWinnerPct:         smallint("prize_live_winner_pct").notNull().default(15),
prizeDuelsWinnerPct:        smallint("prize_duels_winner_pct").notNull().default(12),
prizeReservePct:            smallint("prize_reserve_pct").notNull().default(10),
```

DB-level CHECK so the sum is always 100:
```sql
ALTER TABLE settings ADD CONSTRAINT prize_split_sums_100 CHECK (
  prize_king_first_pct + prize_king_second_pct + prize_king_third_pct
  + prize_matches_winner_pct + prize_live_winner_pct
  + prize_duels_winner_pct + prize_reserve_pct = 100
);
```

### 4.2 `match_bets` — restore stake column

The 2026-05-25 points-bank plan made main 1/X/2 free. We are partially
reversing that. Match guessing remains required on every fixture, but
the **`points_earned` calculation** now follows decision #3 in §3.

Add:
```ts
stakePaidMain:    smallint("stake_paid_main"),  // null = no stake (risk-off mode)
```

`pointsEarned` semantics for 1/X/2 going forward:
- Exact: `+15` (replaces the existing `scoringExact = 15`, no change to value).
- Direction-only: `+5` (replaces `scoringOutcome = 3`).
- Wrong + `matchRiskEnabled=false`: `0`.
- Wrong + `matchRiskEnabled=true`: `−settings.matchRiskPenalty` (default `−5`).

These numbers move into `settings.scoringExact` / `scoringOutcome` /
`matchRiskPenalty` — the magic 15 / 5 in the dictionary copy reads from
settings via the existing pricing block.

### 4.3 `duels` — NEW table

```ts
export const duelStatusEnum = pgEnum("duel_status", [
  "open",       // posted, no joiner yet
  "matched",    // joiner accepted; both stakes locked
  "settled",    // graded, winner credited
  "cancelled",  // expired without joiner (or admin-cancelled)
]);

export const duels = pgTable(
  "duels",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // ---- Opener ----
    openerId: uuid("opener_id").notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    openerAnswer: boolean("opener_answer").notNull(), // true = yes, false = no
    stake: smallint("stake").notNull(),               // 1..settings.duelMaxStake

    // ---- Question ----
    questionHe: text("question_he").notNull(),
    questionEn: text("question_en").notNull(),
    gradingRuleHe: text("grading_rule_he").notNull(),
    gradingRuleEn: text("grading_rule_en").notNull(),

    // ---- Scope (mirrors custom_bets) ----
    scope: betScopeEnum("scope").notNull(),            // 'match' | 'day' | 'tournament'
    matchId: uuid("match_id").references(() => matches.id, { onDelete: "cascade" }),
    matchdayId: uuid("matchday_id").references(() => matchdays.id, { onDelete: "cascade" }),
    // tournament-scope has no FK.

    // ---- Lifecycle ----
    status: duelStatusEnum("status").notNull().default("open"),
    joinDeadlineAt: timestamp("join_deadline_at", { withTimezone: true }).notNull(),
    resolveAt:       timestamp("resolve_at", { withTimezone: true }).notNull(), // earliest fixture kickoff in scope

    joinerId: uuid("joiner_id").references(() => profiles.id, { onDelete: "restrict" }),
    joinedAt: timestamp("joined_at", { withTimezone: true }),

    resolvedValue: boolean("resolved_value"),  // null until settled
    settledAt:     timestamp("settled_at", { withTimezone: true }),
    settledBy:     uuid("settled_by").references(() => profiles.id),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull().defaultNow(),
  },
  (t) => ({
    openerIdx:    index("duels_opener_idx").on(t.openerId),
    joinerIdx:    index("duels_joiner_idx").on(t.joinerId),
    statusIdx:    index("duels_status_idx").on(t.status),
    deadlineIdx:  index("duels_deadline_idx").on(t.joinDeadlineAt),
  }),
);
```

DB constraints:
```sql
-- Stake must be within the configured bounds.
ALTER TABLE duels ADD CONSTRAINT duel_stake_range CHECK (stake BETWEEN 1 AND 20);

-- Scope keys consistent.
ALTER TABLE duels ADD CONSTRAINT duel_scope_keys_consistent CHECK (
  (scope = 'match'      AND match_id     IS NOT NULL AND matchday_id IS NOT NULL) OR
  (scope = 'day'        AND matchday_id  IS NOT NULL AND match_id IS NULL) OR
  (scope = 'tournament' AND matchday_id IS NULL AND match_id IS NULL)
);

-- Joiner can't be opener.
ALTER TABLE duels ADD CONSTRAINT duel_distinct_users CHECK (
  joiner_id IS NULL OR joiner_id <> opener_id
);

-- Once matched, joiner answer is the opposite of opener answer — enforced in code, not DB (boolean column doesn't carry the joiner's value because it's always !openerAnswer; we save it implicitly).
```

### 4.4 `team_power_ratings` — NEW table (optional, see §6.2)

If we end up wanting an internal "team rating" alongside bookmaker odds
(for display only, not for ratios), this table seeds it. Marked as
**deferred to v2** in §17 — kept here because the schema fits the
project's style if/when we add it.

```ts
// Deferred. Not part of v1.
```

### 4.5 No new RLS work beyond existing patterns

Duels follow the same RLS as `custom_bets`:
- SELECT: every authenticated user can read any duel (matches the
  transparency rule — once locked, visible to all).
- INSERT / UPDATE: only through server actions that validate the
  session user against `opener_id` / `joiner_id`.
- DELETE: not granted; cancellations are status transitions.

---

## 5. Match-guessing rescore

### 5.1 Net effect on bank

```
exact:                       balance += 15
direction only:              balance += 5
wrong (risk-off, default):   balance += 0
wrong (risk-on):             balance -= settings.matchRiskPenalty (5)
```

### 5.2 What changes in code

- `scoreFinalMatches()` in `src/lib/sync.ts` reads
  `settings.matchRiskEnabled` once per pass and writes the appropriate
  value into `match_bets.points_earned`.
- `match_bets.stake_paid_main` is written at submit time as the value
  of `settings.matchRiskPenalty` IF `matchRiskEnabled=true` at that
  moment; otherwise `null`. This snapshot ensures the leaderboard math
  in §5.3 stays deterministic even after the admin flips the toggle.

### 5.3 Leaderboard math

The bank balance formula in `src/lib/bank.ts` adds:
```
+ COALESCE(SUM(match_bets.points_earned), 0)  -- can be 0, +5, +15, or −5
```
There is no longer a need to subtract `stake_paid_main` separately
because the negative value is already in `points_earned` when risk is
on. `stake_paid_main` is kept on the row purely for audit / display.

### 5.4 Rules page wording

The dictionary entries `dict.rules.scoringExact*` and
`dict.rules.scoringDirection*` already exist. We add a new
`dict.rules.scoringRiskMode` paragraph that describes the toggle and
its current state, and the page renders it conditionally based on
`settings.matchRiskEnabled`. So players see today's truth.

---

## 6. Live bets

### 6.1 Rename only — no schema change

Every reference to "Custom bets" in the player UI moves to "הימורי
לייב" / "Live bets". The internal table name (`custom_bets`) stays for
backwards compatibility with the existing migration history. Only the
dictionary changes and surface labels.

Specifically updated:
- `dict.live.title`, `dict.live.subtitle` (new keys)
- Page titles on `/play`, `/play/[date]`
- The bottom-nav label

The rules page gets a new section `dict.rules.liveTitle` +
`dict.rules.liveBody` explaining stake/payout, lock times, and that
ratios come from a bookmaker odds feed.

### 6.2 Odds wiring

Added file `src/lib/odds.ts`:
- `fetchOddsForFixture(apiFootballFixtureId): Promise<MarketOdds[] | null>`
- Pulls from API-Football `/odds?fixture=...&bookmaker=8` (Bet365 by
  default; bookmaker id is a setting so admin can switch).
- Returns a normalized `MarketOdds[]` with `name` (market label),
  `selections` (array of `{ label, decimalOdds }`).

Normalization to our point system in `src/lib/odds-normalize.ts`:
```
stake = settings.liveOddsBaseStake                  (default 3)
rawPayout = stake * decimalOdds                     (e.g. 3 * 2.50 = 7.5)
houseEdgeFactor = (100 - settings.liveOddsHouseEdge) / 100   (default 0.95)
payout = round(rawPayout * houseEdgeFactor)
payout = min(payout, settings.liveOddsMaxPayout)    (cap at 25)
payout = max(payout, stake + 1)                     (never lower than +1 net)
```

Result: every bookmaker market becomes a custom-bet template the admin
can publish with one tap.

### 6.3 Admin "Suggested bets per matchday" surface

New page `/[lang]/admin/live-bets/suggestions?date=YYYY-MM-DD`:
1. Header: date label (Asia/Jerusalem) + list of fixtures on that day.
2. Section per fixture: top ~12 markets pulled via `/odds`, each with
   the proposed stake / payout from §6.2 and a "Publish" toggle.
3. Day-scope section: composite markets (e.g. "total goals on day")
   computed by summing across all fixtures.
4. Bulk actions: "Publish all", "Reset stakes to defaults", "Refresh
   odds".
5. Manual override on each row before publish (stake / payout / lock
   time).
6. "Add manual bet" button → opens the existing custom-bet sheet.

Server actions:
- `fetchSuggestionsForDate(date)` → returns rows, doesn't mutate.
- `publishSuggestion(id, override)` → inserts a `custom_bets` row
  with `gradingSource='auto_api_football'` if the market has a stable
  stat, else `manual`.
- `refreshOddsForFixture(fixtureId)` → re-pulls odds; updates the
  draft suggestions row in-memory (no DB persistence for un-published
  suggestions).

### 6.4 Lock window

Each live bet locks at the fixture's kickoff (existing behavior).
Day-scope bets lock at the earliest fixture kickoff of the day. Admin
can override per bet.

---

## 7. Duels

### 7.1 Lifecycle

```
open    →  matched  →  settled
   ↘       ↘
    cancelled (no joiner / admin override)
```

### 7.2 Server actions (`src/app/[lang]/duels/actions.ts`)

```ts
openDuel(payload)
  // payload: questionHe, questionEn, gradingRuleHe, gradingRuleEn,
  //          scope, matchId|matchdayId|null, openerAnswer, stake,
  //          joinDeadlineAt (defaults to min(scope.kickoff - 5min, now+24h))
  // 1. Validate stake ∈ [1, settings.duelMaxStake]
  // 2. Validate balance >= stake (advisory lock on opener)
  // 3. Debit stake (insert into custom-bet stake accounting? — see §7.3)
  // 4. Insert duels row status='open'
  // 5. console.info('[duel open]', {...})

joinDuel(id)
  // 1. Advisory lock on duel id
  // 2. Validate duel.status='open' AND now < joinDeadlineAt
  // 3. Validate joiner.balance >= duel.stake
  // 4. Joiner debit
  // 5. UPDATE duels SET joiner_id, joined_at, status='matched'
  // 6. console.info('[duel join]', {...})

settleDuel(id, resolvedValue)
  // Auto-grader-triggered or admin. Atomic:
  // 1. Determine winner = (resolvedValue === opener_answer) ? opener : joiner
  // 2. Credit winner +2*stake (refund own stake + win opponent's)
  //    Loser balance is unchanged from the open/join debit.
  //    => Net: winner +stake, loser −stake.
  // 3. UPDATE duels SET resolved_value, status='settled', settled_at, settled_by
  // 4. console.info('[duel settle]', {...})

cancelDuel(id, reason)
  // Either join deadline passed with no joiner, or admin override.
  // 1. If status='open': refund opener stake.
  // 2. If status='matched': refund both stakes.
  // 3. UPDATE duels SET status='cancelled'
  // 4. console.info('[duel cancel]', { reason, ... })
```

### 7.3 Bank accounting — how stakes affect balance

Two options considered:

- **A) Use `point_adjustments` for every duel stake / refund / payout.**
  Pro: append-only audit. Con: pollutes the adjustment log with
  algorithmic entries.
- **B) Compute duel bank impact directly from the `duels` table at
  query time.** Pro: keeps `point_adjustments` for genuine admin-issued
  changes. Con: leaderboard query gets another sub-query.

**Chosen:** B. The bank formula in `src/lib/bank.ts` extends to:

```
+ Σ duels(resolved=opener_answer  AND opener=me) stake      -- opener won
- Σ duels(resolved!=opener_answer AND opener=me) stake      -- opener lost
+ Σ duels(resolved!=opener_answer AND joiner=me) stake      -- joiner won
- Σ duels(resolved=opener_answer  AND joiner=me) stake      -- joiner lost
- Σ duels(status='matched', me ∈ {opener, joiner}) stake    -- in-flight debit
- Σ duels(status='open',   opener=me) stake                 -- in-flight debit
+ Σ duels(status='cancelled', me ∈ {opener, joiner}) stake  -- refunded
```

Single CTE in `getBankBalance()`. Audit trail comes from the duels
table itself (immutable history of who opened, joined, settled).

### 7.4 Player surface

New routes:
- `/[lang]/duels` — index. Two tabs: "פתוחים" (open) and "שלי" (mine —
  including settled & cancelled).
- `/[lang]/duels/new` — form to open a duel. Picker for scope (match
  in the next 48h / day in the next 48h / tournament), then question +
  rule + stake + opener answer.
- `/[lang]/duels/[id]` — detail view. If open and viewer is not the
  opener: "הצטרף לדו-קרב" CTA. If matched: shows both users and a
  countdown to resolution. If settled: shows winner.

### 7.5 Auto-cancel on deadline

A new cron entry in `src/lib/sync.ts` (runs every 5 min, same cadence
as `scoreFinalMatches`): finds all duels with
`status='open' AND join_deadline_at < now()` and cancels them, refunding
the opener's stake.

### 7.6 Auto-settle for stat-based duels

If the duel's question maps cleanly to an API-Football stat (e.g.
"more than 2 yellow cards in the selected match"), the admin can mark
it `gradingSource='auto_api_football'` at open time. The existing
`gradeAutoCustomBets()` pass settles it automatically once the fixture
is final. Otherwise it queues for manual settle in the admin grade
view.

### 7.7 Concurrency edge case

Two users tap "Join" at the same instant. The advisory lock per duel
id ensures only one wins the txn. The other receives
`{ ok: false, error: "DUEL_ALREADY_JOINED" }` and the UI shows
"מישהו אחר הצטרף לפניך".

---

## 8. Leaderboards

### 8.1 Tabs

`/[lang]/leaderboard` keeps its existing route. Adds 4 tabs:
- **כללי / Overall** — total bank balance (current behavior, but with
  duel deltas folded in).
- **משחקים / Matches** — `Σ match_bets.points_earned`.
- **לייב / Live bets** — `Σ user_custom_bet_picks.points_earned −
  Σ user_custom_bet_picks.stake_paid`.
- **דו-קרב / Duels** — `Σ duel_net_for_user(uid)` from §7.3.

Each tab paginates at 50 rows. Top 3 in each tab gets a small
trophy badge in the row. Active tab stored in URL search param
(`?tab=matches`) so links are shareable.

### 8.2 Query implementation

`src/db/queries.ts:getLeaderboard(tab)` switches on `tab` and returns
the same shape `{ profileId, displayName, points, rank, tieBreakHint }`.
Tie-breaker stays "fewest stakes wasted" for the Overall tab; per-tab
tie-breakers documented inline in the query.

### 8.3 Mobile layout

Re-uses the existing leaderboard card. Tabs are pills at the top
(`overflow-x-auto`, `snap-x`). All four labels fit on 360px without
truncation; if Hebrew labels get longer, fall back to icon-only on
360px.

---

## 9. Transparency page

### 9.1 Route

`/[lang]/transparency` (or fold into `/leaderboard` as a tab — decided
inline below). For now: **new route**, linked from the bottom nav as
the 5th item.

### 9.2 Content

Default view: a feed of every locked bet across the pool, sorted by
lock time descending. Each row:
- User display name + avatar
- Bet category (Match / Live / Duel)
- Question + the user's pick
- Stake (if any)
- Lock time (Asia/Jerusalem)
- Status (open-and-locked / graded with result / settled)
- Points outcome if known

Filters (URL params): by user, by category, by date.

### 9.3 Privacy model

A bet appears in the feed only after `now() > lock_at`. The query
hard-enforces this — no client-side filtering. Before lock, only the
bet owner can read it (existing RLS pattern for `custom_bets` and
`match_bets`).

For duels: the duel becomes visible to non-participants once
`status='matched'` AND `now() > resolve_at − 5min`. While in
`status='open'`, only the opener sees the bet; everyone else sees a
list of open duels stripped of opener identity so they can choose
which to join. (We don't want a popularity effect where late joiners
pile on duels by famous players.)

Actually — reconsider on user feedback: the open-duels list does need
opener identity, otherwise joiners can't gauge who they're playing.
**Final decision:** opener identity is visible on open duels (joiners
need to know who they're playing); the bet *outcome* and the question
itself are visible from creation. This matches a "challenge" UX.

### 9.4 Rules page section

`dict.rules.transparencyTitle` + `dict.rules.transparencyBody`
explaining the timing model. New section on the rules page after
"Prizes".

---

## 10. Profile expansion (`/[lang]/me`)

### 10.1 Existing surface

`/[lang]/me/bank` already exists. We rename to `/[lang]/me` and
restructure into 3 sub-tabs:

- **בנק / Bank** — existing transaction history.
- **סטטיסטיקות / Stats** — new (§10.2).
- **ההימורים שלי / My bets** — new (§10.3).

### 10.2 Stats tab

All numbers derived from existing tables — no schema change.

| Stat | Source |
|------|--------|
| נקודות נוכחיות | `getBankBalance(me)` |
| סך כל הנקודות שהרווחת | `Σ positive deltas across all bet tables + adjustments` |
| מתוכן: על משחקים | `Σ match_bets.points_earned WHERE > 0` |
| מתוכן: על לייב | `Σ user_custom_bet_picks.points_earned WHERE > 0` |
| מתוכן: על דו-קרב | `Σ duel wins as in §7.3` |
| פגיעות במשחקים | `COUNT(match_bets WHERE was_correct = true)` |
| מתוכן תוצאות מדויקות | `COUNT(match_bets WHERE points_earned >= settings.scoringExact)` |
| דו-קרבים שנפתחו | `COUNT(duels WHERE opener_id = me)` |
| דו-קרבים שהצטרפת | `COUNT(duels WHERE joiner_id = me)` |
| אחוזי ניצחון בדו-קרב | `wins / total settled duels` |

### 10.3 My bets tab

Same shape as the transparency feed but scoped to the signed-in user
and showing bets even before lock (since they're the owner). Filter
by status: open / locked / graded / cancelled.

### 10.4 Rules page link

A small "ראה את חוקי המשחק" link on the stats card. Not a new rules
section — the profile is a derivative view.

---

## 11. Live match view (`/[lang]/live`)

### 11.1 Goal

A page that shows every fixture in the next 24h, with:
- Live score (if in-play) or scheduled time (if not started).
- The signed-in user's pick for that fixture.
- A live "what you'd score now" pill that recomputes when the score
  changes.
- A collapsed list of other players' picks (only shown if the
  fixture's lock time has passed).
- A composite "live leaderboard preview" that re-ranks players based
  on projected earnings if all current scores held.

### 11.2 Polling

API-Football `/fixtures?live=all` returns every in-play match
including incremental score updates. We poll **server-side** every
30 seconds via a Vercel cron and write the live state into a new
`live_match_state` table (or update `matches.home_score` /
`away_score` in-place with a `is_live` flag — TBD in implementation).
The page uses Next.js 15's `revalidate: 30` to refresh the cached SSR
output on each tick. **No client-side polling, no SSE in v1** —
keeps the moving pieces small.

Rate budget check: `/fixtures?live=all` is 1 call per poll. 2 polls
per minute × 60 min × 24h = 2,880 calls/day worst case. API-Football
Pro budget is 7,500/day. Safe with headroom.

### 11.3 "Live earnings" math

For each fixture with a current live score:
- If user picked exact and current score matches: pill shows "+15"
  (provisional, pending final).
- If user picked direction and current score matches direction: pill
  shows "+5".
- If user picked the wrong direction: pill shows "0" (or "−5" if
  risk on).
- If user has live-bet picks tied to the fixture: each renders with
  its provisional outcome based on the live state.

All provisional, all clearly labeled `"ברגע זה"` to avoid players
treating it as final.

### 11.4 Locked-down other players' picks

Visible only AFTER each fixture's lock time (the rule from §9.3
applies). Before lock, the section shows
"ההימורים של חברים יוצגו אחרי שריקת הפתיחה".

### 11.5 Cost flag (rule 8)

No new cost. Already on API-Football Pro. The live endpoint is
included.

### 11.6 Rules page section

`dict.rules.liveViewTitle` + `dict.rules.liveViewBody` explaining what
the page shows and that numbers are provisional until matches are
final. New section after "Live bets".

---

## 12. Rules page sync — concrete diff

Existing structure (per `src/app/[lang]/rules/page.tsx`):

1. What is this
2. How it works
3. Scoring
4. Bank
5. Prizes

After this overhaul:

1. What is this — updated copy: 4 surfaces, friends pool, Toto Mundial.
2. How it works — updated copy: matches, live bets, duels, leaderboards.
3. Scoring — split into 3 sub-cards:
   - Match scoring (+15 / +5 / 0 default; risk mode disclaimer if on)
   - Live bets (stake + payout, ratios from a bookmaker feed)
   - Duels (1v1 binary, stake ≤ 5, winner takes opponent's stake)
4. Bank — updated to 30 starting; mentions daily renewal if enabled.
5. Live view — what the new live page does and provisional disclaimer.
6. Transparency — when bets become visible (after lock).
7. Leaderboards — the 4 tabs explained.
8. Prizes — the 7-way split table.

All copy lives in `src/lib/dictionaries/he.ts` and `en.ts` under the
existing `rules` namespace. New keys are camelCase per the existing
convention.

### PR-level enforcement

Every PR in §15 must:
- Include the dictionary changes for the rule it modifies.
- Update `src/app/[lang]/rules/page.tsx` if the section structure
  changes.
- Include a `## Rules page diff` heading in the PR description with
  the before/after copy.

Reviewer (Yoav) blocks merge if any of these are missing.

---

## 13. Server actions inventory

New under `src/app/[lang]/...`:

| Path | Actions |
|------|---------|
| `admin/live-bets/suggestions/` | `fetchSuggestionsForDate`, `publishSuggestion`, `refreshOddsForFixture` |
| `admin/settings/scoring/` | extend with risk toggle + renewal toggle + prize split |
| `duels/` | `openDuel`, `joinDuel`, `cancelDuel`, `settleDuel` |
| `live/` | none (pure SSR with `revalidate`) |
| `transparency/` | none (pure SSR) |
| `me/` | `getProfileStats`, `getMyBets` |

Internal helpers (no route):
- `src/lib/odds.ts` — API wrapper
- `src/lib/odds-normalize.ts` — odds → stake/payout
- `src/lib/duels.ts` — duel-specific bank helpers
- `src/lib/live.ts` — live state fetch + cache
- `src/lib/prizes.ts` — prize split calculator

---

## 14. Security (rule 13)

- `requireAdmin(locale)` gate on every admin route (existing).
- Duel actions: serializable txn + `pg_advisory_xact_lock(hashtext('duel:' || id))`
  to serialize join attempts. Per-user `pg_advisory_xact_lock(hashtext(userId))`
  on stake debit (matches existing custom-bet pattern).
- Server is the only authority on balance. Client never sends a
  balance.
- Live view endpoint: rate-limited per session at 1 req / 5 sec to
  protect against a JS error budget runaway. Implemented via existing
  `src/lib/rate-limit.ts`.
- API-Football key stays in env (`API_FOOTBALL_KEY`), never in client
  bundles. The odds-fetcher runs server-side only.
- Transparency page query enforces lock-time gating in SQL — no
  client-side filtering. RLS as a second line of defense.
- Duel question / rule text is user-input. Strip HTML server-side
  (existing `src/lib/...` sanitizer). Max length 200 chars per field.
- Settings page form: prize-split percentages validated client + server
  to sum to 100. DB CHECK constraint as third line of defense (§4.1).
- Free-text fields (duel question / rule): rate-limit duel creation to
  20/day per user to prevent spam.

---

## 15. Observability (rule 14)

| Event | Namespace | Payload |
|-------|-----------|---------|
| Match grading | `[match score]` | `{ userId, matchId, exact, direction, pointsEarned, riskMode }` |
| Daily renewal applied | `[renewal apply]` | `{ userId, amount, balanceAfter }` |
| Duel opened | `[duel open]` | `{ duelId, openerId, stake, scope, deadlineAt }` |
| Duel joined | `[duel join]` | `{ duelId, joinerId, stake }` |
| Duel settled | `[duel settle]` | `{ duelId, resolvedValue, winnerId, loserId, stake }` |
| Duel auto-cancelled | `[duel cancel]` | `{ duelId, reason }` |
| Odds pull | `[odds pull]` | `{ fixtureId, marketsReturned, ms, rateRemaining }` |
| Suggestion published | `[live-bet publish]` | `{ adminId, customBetId, stake, payout, marketName }` |
| Live state poll | `[live poll]` | `{ fixturesUpdated, ms }` |
| Leaderboard tab read | `[leaderboard read]` | `{ tab, viewerId, top1, top1Points }` |
| Transparency page read | `[transparency read]` | `{ viewerId, filterUser?, filterCategory?, filterDate? }` |
| Settings change | `[settings updated]` | `{ field, oldValue, newValue, adminId }` |

All to Vercel logs by default; no extra deps.

---

## 16. Settings audit (rule 15)

Every new tunable in §4.1 is exposed on `/[lang]/admin/settings/scoring`
with:
- Hebrew + English label.
- A "Why" tooltip in plain language.
- A banner: "השינויים יחולו רק על הימורים חדשים — הימורים קיימים שומרים את הסכומים שלהם" (where applicable).

Grouping on the page:
- "ניקוד משחקים" — `scoringExact`, `scoringOutcome`, `matchRiskEnabled`,
  `matchRiskPenalty`.
- "התחדשות" — `dailyRenewalEnabled`, `dailyRenewalAmount`.
- "דו-קרב" — `duelMaxStake`, `duelDefaultJoinWindow`.
- "הימורי לייב" — `liveOddsBaseStake`, `liveOddsMaxPayout`,
  `liveOddsHouseEdge`.
- "פרסים" — the 7 percentage fields with a live sum indicator.

If the prize-split sum ≠ 100 the save button is disabled and the form
shows the delta.

---

## 17. Cutover & PR breakdown

### 17.1 Sequencing

All PRs target the existing branch model (one branch per PR, merged
into `main`). Each PR is independently deployable; legacy data
preserved everywhere; no destructive migrations until the very end of
the sequence.

| PR | Title | Scope |
|----|-------|-------|
| 1 | **schema + settings + match risk toggle** | Migration 0014: new settings columns, new `duels` table, `match_bets.stake_paid_main`. Admin settings page extended. Rules page reflects the toggle. Match scoring rescore wired in. |
| 2 | **Live bets rename + odds suggestions** | Dictionary changes, page titles, bottom nav. `src/lib/odds.ts` + `odds-normalize.ts`. Admin suggestions page. Rules page gets the new "live bets" section. |
| 3 | **Duels** | All duel server actions, player pages, auto-cancel cron, auto-settle hook. Rules page gets the duels section. |
| 4 | **Leaderboards + transparency + profile** | Leaderboard tabs query. Transparency route. Profile expansion. Rules page gets the leaderboards + transparency sections. |
| 5 | **Live match view + prizes UI** | `/live` page with server-side polling. Prizes page if it doesn't exist already, with the 7-way split bar. Rules page updates for both. |

Each PR's checklist:
- [ ] Migration runs cleanly against a prod snapshot in dev
- [ ] Dictionary updated (he + en)
- [ ] Rules page updated
- [ ] Mobile QA at 360 / 414 / 768 / 1024 / 1440
- [ ] Hebrew RTL verified
- [ ] Observability logs verified to fire
- [ ] Settings audit verified (no hardcoded magic numbers introduced)

### 17.2 Council pass (rule 11)

**Mandatory before PR 1.** Run `llm-council` on this plan. Common
blind spots to ask the council to pressure-test:
- The "risk-off default" decision (§3 row 4). Council should
  challenge whether this kills the bank's purpose.
- The duel "1v1 binary, opener sets stake" mechanic (§7). Council
  should challenge whether asymmetric scope (opener fully defines
  the question) gives the opener an unfair edge.
- The transparency timing for open duels (§9.3). Council should
  challenge the popularity-effect concern vs. the joiner's need to
  know who they're playing.
- The prize split with double-dipping enabled (§3 row 11). Council
  should pressure-test how it feels for a 30-person pool when one
  player walks with 45-60% of the pot.

Document the council outcomes in
`_plans/2026-05-27-betting-overhaul-council.md` (or wherever the user
prefers). Adjust §3 if any decision flips.

---

## 18. QA checklist (rule 6)

Pre-merge per PR; full sweep before PR 5 ships.

### Golden path
- [ ] User predicts a match → correct exact → +15, balance reflects.
- [ ] Same user predicts another match → direction only → +5, balance reflects.
- [ ] Admin flips `matchRiskEnabled=true`. New wrong prediction → −5. Previously-graded picks unchanged.
- [ ] Admin pulls suggestions for tomorrow's date → sees a list of markets per fixture → publishes 3 → they show up on `/play/[date]`.
- [ ] User opens a duel with stake 5 → balance −5, duel `status='open'`.
- [ ] Another user joins → both balances −5, duel `status='matched'`.
- [ ] Auto-grade settles the duel → winner +10 (net +5), loser unchanged from join.
- [ ] Transparency page shows the duel only after the resolve time passes.
- [ ] Leaderboard "duels" tab reflects net change.
- [ ] Live view shows projected +15 during a live match where user picked exact.

### Edge cases
- [ ] User tries to open a duel with stake > `settings.duelMaxStake` → server rejects.
- [ ] User tries to open a duel with insufficient balance → server rejects.
- [ ] Two users tap "Join" on the same duel at the same instant → only one wins; other gets `DUEL_ALREADY_JOINED`.
- [ ] Duel deadline passes with no joiner → status flips to `cancelled`, opener refunded, no negative net.
- [ ] Admin cancels a matched duel → both refunded; observability logs the reason.
- [ ] Prize-split form: percentages summing to 99 → save disabled.
- [ ] Daily renewal: toggle off → no `point_adjustments` rows created.
- [ ] Daily renewal: toggle on → +X to every active user at 00:00 IL; audit row visible in `/me/bank`.
- [ ] Live view loaded with no in-play matches → renders empty state, no API call burst.
- [ ] Transparency: a custom bet locked 1 minute ago is visible; a custom bet locking 1 minute from now is not.

### Mobile / RTL
- [ ] All new surfaces at 360px: no overflow, no clipping.
- [ ] Hebrew long strings in duel questions wrap correctly.
- [ ] Date labels render in Asia/Jerusalem via `formatDateTime`.
- [ ] Leaderboard tab pills overflow-scroll without breaking layout.
- [ ] Live earnings pill stays inside its card on narrow viewports.

### Regressions
- [ ] Existing custom-bet flows untouched (only renamed in UI).
- [ ] Existing `match_bets` grading still works.
- [ ] Existing points-bank balance for users with no duel activity remains identical.
- [ ] Existing pay-gate untouched.
- [ ] Existing email flows untouched.

---

## 19. Known risks

| # | Risk | Mitigation |
|---|------|------------|
| 1 | Risk-off default undermines the bank system | Toggle exists, admin can flip mid-tournament. Documented in rules page so players know the current mode. |
| 2 | Odds endpoint missing markets for some WC matches | Manual override on every published suggestion. Admin can author the same bet manually if the odds feed is bare. |
| 3 | Live polling burns API budget | 30-second cron + Pro tier headroom = safe. Add a circuit breaker (`src/lib/api-football.ts`) if daily call count crosses 5,000. |
| 4 | Duel spam | 20/day creation cap per user. Admin can hide low-quality duels (status='cancelled' with reason). |
| 5 | Friend conflict over duel outcome | Manual settle UI with mandatory `reason` field; reversal flow per existing custom-bet pattern. |
| 6 | Prize math drift if percentages edited mid-tournament | DB CHECK constraint enforces sum=100. Audit row in `point_adjustments` whenever the split changes (server action). |
| 7 | Rules page goes stale | PR checklist enforcement (§17.1) + reviewer responsibility. A CI lint check is flagged as v2. |
| 8 | Council might overturn a major decision | Section §3 is rebuilt after council pass; this is the intended workflow per rule 11. |

---

## 20. What we are explicitly NOT doing in v1

- No N-way duels (3+ participants).
- No bet sharing / WhatsApp deep links.
- No client-side SSE / WebSockets for live view.
- No internal "team power rating" surface (deferred — would be display-only, not a ratio source).
- No CI lint check that enforces rules-page sync (relies on reviewer for now).
- No automated council pass via tooling — run manually via the
  `llm-council` skill before PR 1.
- No multi-language beyond he / en.
- No "private duels" (a duel where the opener picks the joiner). Open
  to anyone in the pool, first to join wins the match. Could land in
  v2 if asked.

---

## 21. Files touched (high-level inventory)

- `src/db/schema.ts` — new settings columns, new `duels` table, `match_bets.stake_paid_main`
- `src/db/queries.ts` — `getLeaderboard(tab)`, transparency query, profile stats
- `src/db/migrations/0014_betting_overhaul.sql` — single migration
- `src/lib/bank.ts` — extend balance formula with duel deltas
- `src/lib/duels.ts` — NEW
- `src/lib/odds.ts` — NEW
- `src/lib/odds-normalize.ts` — NEW
- `src/lib/live.ts` — NEW
- `src/lib/prizes.ts` — NEW
- `src/lib/sync.ts` — extend with `scoreFinalMatches` updates + duel auto-cancel + duel auto-settle + live polling cron
- `src/lib/dictionaries/he.ts` — new keys for live / duels / transparency / live view / leaderboards / prizes
- `src/lib/dictionaries/en.ts` — same
- `src/app/[lang]/rules/page.tsx` — extend with 3 new sections, update existing scoring + bank sections
- `src/app/[lang]/leaderboard/page.tsx` — add tabs
- `src/app/[lang]/transparency/page.tsx` — NEW
- `src/app/[lang]/duels/...` — NEW (index, new, [id])
- `src/app/[lang]/duels/actions.ts` — NEW
- `src/app/[lang]/live/page.tsx` — NEW
- `src/app/[lang]/me/page.tsx` — restructure into tabs
- `src/app/[lang]/me/stats/` — NEW sub-tab
- `src/app/[lang]/me/bets/` — NEW sub-tab
- `src/app/[lang]/admin/live-bets/suggestions/` — NEW
- `src/app/[lang]/admin/settings/scoring/` — extend
- `src/components/PrizeStrip.tsx` — update split rendering
- Various nav additions (bottom nav: duels + transparency entries)

---
