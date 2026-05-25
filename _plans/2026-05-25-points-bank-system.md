# Points Bank ("Stake & Payout") System

**Date:** 2026-05-25
**Status:** Ready for implementation — all decisions locked
**Owner:** Yoav

---

## 1. Goal

Every user starts the tournament with a configurable bank of points (default **100**). Every action *beyond* the regular 1/X/2 main pick costs a **stake** that is deducted from the bank at submit time. A correct prediction pays a **payout** that goes back into the bank. Wrong → stake is lost.

Outcome: forces strategic budgeting. Today users sprinkle BTTS/Over 2.5/HT/bracket/specials on everything for free — that flattens the game. With a bank, every side bet is a deliberate "is this one worth the risk?" decision.

The admin (Yoav) gets a first-class surface to **adjust any user's bank** with a delta + mandatory reason, fully audited.

---

## 2. Constraints (from CLAUDE.md)

- **Clean & ordered code** (rule 2): new columns slot into `settings.ts` in the existing pricing block; new tables match Drizzle conventions in `src/db/schema.ts`.
- **Mobile-first responsive** (project CLAUDE.md): bank widget must be readable at 360px; insufficient-funds banner must not horizontally scroll.
- **Cost flagging** (rule 8): zero new paid services. No third-party dependency added.
- **Security from day one** (rule 13): admin endpoints role-gated; adjustments append-only; reason required; server is the only source of truth for bank balance.
- **Observability from day one** (rule 14): every stake debit, payout credit, and admin adjustment emits a namespaced `console.info`.
- **Settings audit** (rule 15): every stake cost, payout, and the starting bank are stored in `settings` so the admin can tune mid-flight.
- **Brutally honest** (rule 12): we explicitly clear stale tournament-level picks (special/bracket/group) so users re-decide under the new pricing — grandfathering would corrupt the leaderboard.

---

## 3. Decisions already locked (from clarification round)

| Question | Choice |
|---|---|
| Cost model | **Stake & Payout** (pay to enter, win full payout if right, lose stake if wrong) |
| Bank below zero allowed? | **No** — server blocks any submit that would push balance < 0 |
| Admin control surface | **Append-only adjustments table** + admin UI with mandatory reason |
| When to charge tournament bets (special/bracket/group) | **On submit** (matches per-match side-bet behavior — single mental model) |
| Tunable starting bank + stake costs | **Yes**, via `settings` table — admin-editable |
| Existing tournament-level data | **Clear & re-prompt** (special_bets, bracket_predictions, group_predictions reset to zero; users get a banner inviting them to re-submit under the new system) |

---

## 4. Data model changes

### 4.1 `settings` — new columns (admin-tunable)

Add to `src/db/schema.ts:242` block, immediately after the existing scoring columns:

```ts
// Points bank
startingBank:           smallint("starting_bank").notNull().default(100),
// Stake costs (deducted on submit)
stakeMain:              smallint("stake_main").notNull().default(0),   // main 1/X/2 is FREE
stakeBtts:              smallint("stake_btts").notNull().default(1),
stakeOver25:            smallint("stake_over_25").notNull().default(1),
stakeHt:                smallint("stake_ht").notNull().default(2),
stakeGroupTeam:         smallint("stake_group_team").notNull().default(2), // per team in a group
stakeBracketChampion:   smallint("stake_bracket_champion").notNull().default(5),
stakeBracketRunnerUp:   smallint("stake_bracket_runner_up").notNull().default(3),
stakeBracketThird:      smallint("stake_bracket_third").notNull().default(2),
stakeBracketFourth:     smallint("stake_bracket_fourth").notNull().default(2),
stakeTopScorer:         smallint("stake_top_scorer").notNull().default(5),
stakeFinalPenalties:    smallint("stake_final_penalties").notNull().default(3),
```

### 4.2 Existing scoring values — recalibrate so payouts include stake recovery

`pointsEarned` represents the **gross payout** (not net). Net = payout − stake. We bump payouts so net = current scoring values:

| Setting | Current | New default | Rationale |
|---|---|---|---|
| `scoringExact` | 15 | **15** | unchanged (main = free) |
| `scoringOutcome` | 3 | **3** | unchanged (main = free) |
| `scoringBtts` | 2 | **3** | net +2 if right, −1 if wrong |
| `scoringOver25` | 2 | **3** | net +2 if right, −1 if wrong |
| `scoringHtExact` | 5 | **8** | net +6 if exact, −2 if wrong (stake=2) |
| `scoringHtOutcome` | 2 | **5** | net +3 if only outcome right, +6 if exact (above) |
| `scoringChampion` | 25 | **30** | net +25 if right, −5 if wrong |
| `scoringRunnerUp` | 15 | **18** | net +15 if right, −3 if wrong |
| `scoringThird` | 8 | **10** | net +8 if right, −2 if wrong |
| `scoringFourth` | 5 | **7** | net +5 if right, −2 if wrong |
| `scoringTopScorer` | 20 | **25** | net +20 if right, −5 if wrong |
| `scoringFinalPenalties` | 10 | **13** | net +10 if right, −3 if wrong |
| `scoringGroupPerfect` | 20 | **8** | now a *bonus* on top of per-team |

NEW: `scoringGroupTeam` (default **3**) — points per correctly ranked team within a group, additive with the perfect-group bonus. Net for a perfect group of 4 = (4×3) + 8 − (4×2) = 12 stake = **+12 net**.

### 4.3 Snapshot stake costs on each bet row

Stake costs are settings, so the admin could change them mid-tournament. To stay deterministic and audit-friendly, snapshot the stake into each bet row at submit time. Future setting changes only affect *new* submissions.

**`match_bets`** — add (`src/db/schema.ts:115`):
```ts
stakePaidBtts:    smallint("stake_paid_btts"),    // null if user didn't opt in
stakePaidOver25:  smallint("stake_paid_over_25"),
stakePaidHt:      smallint("stake_paid_ht"),
```

**`group_predictions`** — add:
```ts
stakePaid: smallint("stake_paid").notNull().default(0),
```

**`bracket_predictions`** — add:
```ts
stakePaid: smallint("stake_paid").notNull().default(0),
```

**`special_bets`** — add:
```ts
stakePaid: smallint("stake_paid").notNull().default(0),
```

### 4.4 New table: `point_adjustments`

Append-only audit log of admin-issued bank changes. No UPDATE, no DELETE — if the admin mis-typed, they enter a corrective row.

```ts
export const pointAdjustments = pgTable(
  "point_adjustments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    delta: integer("delta").notNull(),         // positive or negative
    reason: text("reason").notNull(),          // required, length >= 3
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
```

DB-level enforcement of "no edits":
```sql
REVOKE UPDATE, DELETE ON point_adjustments FROM PUBLIC;
ALTER TABLE point_adjustments ADD CONSTRAINT reason_not_empty CHECK (length(reason) >= 3);
ALTER TABLE point_adjustments ADD CONSTRAINT delta_nonzero CHECK (delta <> 0);
```

---

## 5. Bank balance formula

Single source of truth, computed in SQL (one query):

```
balance = settings.startingBank
        + COALESCE(SUM(match_bets.pointsEarned),    0)
        + COALESCE(SUM(match_bets.pointsBtts),      0)
        + COALESCE(SUM(match_bets.pointsOver25),    0)
        + COALESCE(SUM(match_bets.pointsHt),        0)
        + COALESCE(SUM(group_predictions.pointsEarned),   0)
        + COALESCE(SUM(bracket_predictions.pointsEarned), 0)
        + COALESCE(SUM(special_bets.pointsEarned),        0)
        − COALESCE(SUM(match_bets.stakePaidBtts),   0)
        − COALESCE(SUM(match_bets.stakePaidOver25), 0)
        − COALESCE(SUM(match_bets.stakePaidHt),     0)
        − COALESCE(SUM(group_predictions.stakePaid),      0)
        − COALESCE(SUM(bracket_predictions.stakePaid),    0)
        − COALESCE(SUM(special_bets.stakePaid),           0)
        + COALESCE(SUM(point_adjustments.delta),    0)
```

Lives in a new helper `src/lib/bank.ts`:
- `getBankBalance(userId: string): Promise<number>`
- `canAfford(userId: string, cost: number): Promise<boolean>`
- `getBankBreakdown(userId: string)` → returns `{ starting, stakesPaid, payoutsEarned, adjustments, balance }` for the user's transaction history page

Leaderboard query (`src/db/queries.ts:121`) is rewritten to use the formula above as the single `points` column. Tie-breaker: fewest stakes wasted, then `displayName ASC`.

---

## 6. Server actions — bet submission

Every existing submit endpoint (`src/app/[lang]/bets/`, `bracket/`, `standings/`, `specials/`) gets one new step **before** writing the row:

```ts
const cost = computeStakeForSubmission(payload, settings);
const balance = await getBankBalance(userId);
if (balance < cost) {
  return { ok: false, error: "INSUFFICIENT_BANK", needed: cost - balance };
}
// proceed; write stakePaid = cost into the row in the same DB transaction
```

Critical: balance check + insert must be in a **single SERIALIZABLE transaction** to prevent race conditions where a user double-submits and overspends. Postgres advisory lock per `userId` is enough; if Drizzle doesn't expose one cleanly, use `pg_advisory_xact_lock(hashtext(userId))`.

When a user **edits** an existing bet (e.g. adds BTTS to an already-submitted match bet), we treat it as: refund old stake, charge new stake atomically. Refund only happens for *unscored* bets (still null `pointsEarned`). Once the match goes live/final, edits are blocked by existing `locked` logic.

---

## 7. UI changes

### 7.1 User-facing

**Bank widget** — sticky pill in the header on every authenticated page:
```
💰 87 / 100 pts
```
At 360px viewport this stays under 120px wide. Tap → opens transaction history modal.

**Each bet form** shows cost + projected balance inline, e.g.:
```
[✓] BTTS (yes/no)        Cost: 1 pt · Bank after: 86
[ ] Over 2.5             Cost: 1 pt
[ ] Halftime score       Cost: 2 pts
```
If a checkbox would overdraw, it is **disabled** and shows: `"חסר: X נקודות"`.

**Submit button** is disabled with explanation if total cost > balance. Confirmation dialog if cost ≥ 50% of current balance.

**Transaction history page** (`/[lang]/me/bank`):
- Running balance from 100 down/up
- Each row: timestamp (Jerusalem TZ via `formatDateTime`), description (`"BTTS על BRA-GER"`, `"תשלום אדמין: בונוס פתיחה"`), delta (`-1`, `+3`, `+10`)

**Leaderboard** (`/[lang]/leaderboard`): existing column rebranded `"בנק"` instead of `"נקודות"`.

### 7.2 Admin-facing

**New page** `/[lang]/admin/users/[id]/bank`:
- Header: current balance, breakdown card (starting / stakes / payouts / adjustments)
- Adjustment form: `delta` (numeric, +/−), `reason` (textarea, min 3 chars), submit
- Audit table: every past adjustment with `createdAt`, `delta`, `reason`, `createdBy`

**New page** `/[lang]/admin/settings/scoring`:
- Form to edit `startingBank`, all `stake*` and all `scoring*` values
- Banner: "שינויים לא ישפיעו על הימורים קיימים (stake שמור בשורת ההימור)"
- Save → audit row in a new `settings_changes` table (out of scope here, but flagged in §11)

Per project CLAUDE.md: 44×44px touch targets, mobile-first, no horizontal scroll on `<md`.

---

## 8. Security (rule 13)

- `requireAdmin(locale)` gate on every admin route (already exists, `src/lib/admin.ts`).
- `point_adjustments` insert: server action validates `delta` is non-zero integer, `reason.length >= 3`, `createdBy` = session admin id (not trusted from client).
- DB constraint mirror: `CHECK (delta <> 0)`, `CHECK (length(reason) >= 3)`.
- `REVOKE UPDATE, DELETE` on the table.
- Balance check uses server-side SQL only — never trust a client-supplied balance.
- Rate limit: max 100 adjustments per admin per hour (Supabase Edge → middleware counter, or simple in-memory bucket for v1).
- Server actions wrapped in a serializable transaction per `userId` so a malicious double-submit can't double-spend.

PII concern: `reason` is free-text. Admin must not paste sensitive data. Add inline hint on the form: `"לא לכתוב מידע אישי - הטקסט נשמר לעד."`

---

## 9. Observability (rule 14)

Namespaced logs:

| Event | Log |
|---|---|
| Side bet submitted | `console.info('[bank stake]', { userId, betType, cost, oldBalance, newBalance, matchId? })` |
| Insufficient bank rejection | `console.warn('[bank rejected]', { userId, betType, cost, balance })` |
| Match scored → payout | `console.info('[bank payout]', { userId, betType, payout, matchId })` |
| Admin adjustment | `console.info('[admin adjustment]', { targetUserId, delta, reason, by, oldBalance, newBalance })` |
| Settings change | `console.info('[settings updated]', { field, oldValue, newValue, by })` |

All five are surfaced to Vercel logs by default. No extra deps.

---

## 10. Migration plan

1. **Migration `0007_points_bank.sql`** (manual SQL, Drizzle doesn't generate everything we need):
   - Add new columns to `settings` (with defaults so existing row auto-populates).
   - Add stake snapshot columns to `match_bets`, `group_predictions`, `bracket_predictions`, `special_bets`.
   - Create `point_adjustments` table with constraints + revokes.
   - **TRUNCATE** `special_bets`, `bracket_predictions`, `group_predictions` (user chose "Reset"). `match_bets` is preserved — main picks were free anyway, and existing side-bet stakes snapshot as 0 so legacy side bets are grandfathered free. Flag this as an open question (see §11.A).
   - Bump `scoring*` defaults per §4.2 by `UPDATE settings SET ...`.

2. **Code merge** (single PR — see CLAUDE.md rule for "validated judgment call" on bundling vs. splitting; this change crosses too many surfaces to split safely without temporary inconsistency).

3. **Banner** on first login post-deploy: `"הוספנו מערכת בנק. ההימורים הקבוצתיים שלך אופסו — לחץ כאן למלא מחדש."`

4. **Manual QA** (rule 6): golden path, edge cases — see §12.

5. **Council pass** (rule 11) — recommend running this plan through `llm-council` before implementation since it has compounding consequences on leaderboard integrity. Worth one round.

---

## 11. All decisions locked

| ID | Question | Decision |
|---|---|---|
| **A** | Legacy `match_bets` side bets (BTTS/Over/HT already submitted) | **Clear** `bet_btts`, `bet_over_25`, `bet_ht_home`, `bet_ht_away` (and their `points_*` columns) on every existing row. Main `homeScore`/`awayScore` preserved. Users re-submit side bets under the new pricing. |
| **B** | Leaderboard tie-breaker | **Fewest stakes wasted** (highest hit rate), then **displayName ASC**. Rewards skill, not submission speed. |
| **C** | Bank-only vs. bank + gross on leaderboard | **Bank balance is primary** (default sort, the leaderboard number). **Gross points won** shown as a secondary column for transparency — reveals sharp bettors vs. conservatives without confusing the primary ranking. |
| **D** | Group prediction scoring not wired into leaderboard today | **Fix it as part of this PR.** Write `scoreGroupPredictions()` in `src/lib/sync.ts` alongside `scoreFinalMatches()`, trigger after every group's final match. Per-team `scoringGroupTeam` + perfect-group bonus, as defined in §4.2. This is a pre-existing bug we are not deferring. |
| **E** | Cap on a single admin adjustment | **±500 max per row.** Enforce via `CHECK (abs(delta) <= 500)` on the table and client-side validation on the form. Admin can split into multiple rows for larger corrections — forces a pause-and-reconsider on big numbers without blocking legitimate use. |
| **F** | Bank widget visibility | **Hidden for unauthenticated viewers.** Public pages don't show bank info. |

---

## 12. QA checklist (rule 6)

Before declaring done, walk these in dev + prod-like data:

**Golden path:**
- [ ] New user lands → bank shows 100/100.
- [ ] Submit main bet only → bank still 100.
- [ ] Submit BTTS → bank 99.
- [ ] Match goes final, BTTS right → bank 102.
- [ ] Match goes final, BTTS wrong → bank 99.

**Edge cases:**
- [ ] User tries to submit a side bet when balance = 0 → form disabled, server rejects with `INSUFFICIENT_BANK`.
- [ ] User submits bet, edits to add another side bet within the same form, balance dips below zero → server rejects.
- [ ] Two browser tabs submit the same bet simultaneously → only one wins (advisory lock).
- [ ] Admin sets a stake to 0 mid-tournament → new bets free, existing stakes unchanged.
- [ ] Admin issues −1000 adjustment that would push balance below 0 → ALLOWED (admin override is intentional); UI shows negative balance with warning style.

**Error paths:**
- [ ] Adjustment form: empty reason → 400.
- [ ] Adjustment form: delta = 0 → 400.
- [ ] Non-admin hits `/admin/users/[id]/bank` → redirected.
- [ ] DB-level INSERT into `point_adjustments` with `length(reason) < 3` → constraint error.

**Mobile (per project CLAUDE.md):**
- [ ] Bank widget at 360px: no overflow.
- [ ] Bet form at 360px: cost text doesn't push checkbox off-screen.
- [ ] Admin adjustment form at 360px: textarea is 48px+ tall, font 16px+.

**Regressions in adjacent code:**
- [ ] Old `scoreFinalMatches()` still writes `pointsEarned` correctly.
- [ ] Payment approval flow untouched.
- [ ] Sync from football-data API still works.

---

## 13. What we are explicitly NOT doing

- No "buy back into the bank with real money." Adjustments are the only way the bank changes outside scoring.
- No multipliers / doubles / jokers. (Reasonable next iteration; not this PR.)
- No live in-game betting price changes.
- No per-user starting bonuses (e.g. early-bird payers get 110). Could be done easily via `point_adjustments` insert at payment approval time — flag as v2.
- No public visibility of admin adjustment reasons (private to admin + the affected user on their own bank page).
