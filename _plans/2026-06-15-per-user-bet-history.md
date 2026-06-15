# Per-user complete bet history on the שקיפות (transparency) page

**Date:** 2026-06-15
**Status:** Implemented (2026-06-15). Pending: apply migration 0060
(`pnpm db:migrate` locally / auto on Vercel prebuild) and a live
mobile/RTL eyeball pass. Automated gates green: `tsc` (0 src errors),
eslint, vitest (10 new + all existing src tests), `next build` compiled
successfully (the build's type-check step fails only on the pre-existing
`scripts/qa-agent` missing-`@anthropic-ai/sdk`, unrelated to this work).
**Owner:** Yoav

---

## 1. Goal

Let any pool member open the transparency page, pick another member, and
see that person's **complete betting history across all five bet types**
(match score picks, live bets, tournament outright, group rankings,
1v1 duels) from day one — the exact pick, the stake, the result, and the
points won/lost — led by a summary (net up/down, staked, won, lost,
record, pending). Plus a **head-to-head** "me vs. them" comparison.

It is virtual **points, not money**. The page is members-only (behind
`getRequestUser()` + `gatePage("transparency")`), not public web.

The user's original framing was "just add a date picker so people can go
back to past games." A single-date filter already exists
([page.tsx:157-166](../src/app/[lang]/transparency/page.tsx)) and already
spans past played matches. The real gap is that the feed is organized
**by question across 5 tabs**, so there is no single per-person story.
This plan delivers that per-person view.

---

## 2. Decisions locked with the user

| Fork | Decision |
|------|----------|
| View shape | **Per-user, summary-first profile** with full timeline below |
| Pending (locked-but-unresolved) bets | **Show as "awaiting result"** |
| Privacy posture | **Fully open + one admin kill-switch.** No per-user opt-out. Neutral tone, **no "biggest loser" ranking** |
| v1 scope | **Profile + head-to-head** ("me vs. them") in the same release |

---

## 3. LLM council findings folded in

- **Summary first, never a wall of rows.** Header card up top; full
  timeline below; pending separated from settled.
- **Reuse the lock-filtered transparency SQL; never the bank-history
  query** (it emits a `stake_custom` event at *pick time*, before lock —
  a leak). Confirmed in [queries.ts:2065-2072](../src/db/queries.ts).
- **Points, not money, in the copy.** "Stake" reads as cash to a normal
  user; "net" is jargon. Use "up X" / "down X" in green/red and state
  "נקודות, לא כסף" once.
- **Correctness traps (must do in SQL, keep JS dumb):**
  - one canonical `sort_ts` per branch (wrong timestamp = wrong
    chronology, the one thing this page cannot get wrong),
  - one pre-computed signed `net` column (mixed per-type semantics),
  - one `is_pending` boolean keyed off **status/grade**, not null points.
- **Edge cases:** exclude voided/`cancelled` bets and cancelled duels
  (phantom stakes); handle duel `open` (no joiner yet) as pending;
  `reversed` custom bets count as graded.
- **Design the data shape so head-to-head is cheap** (it is in scope).
- **Mobile = stacked cards, RTL-aware.** No tables.

Naming note (non-blocking): "Transparency"/שקיפות reads like a privacy
policy to a newcomer, but it is an existing page with a nav entry,
page-visibility catalog key, and inbound links — renaming is out of
scope. The subtitle already explains it; the new mode gets a clear
"היסטוריית שחקן / Player history" header.

---

## 4. Data contract (the load-bearing piece — build & log first)

New query in `src/db/queries.ts`, next to `getTransparencyByQuestion`.

```ts
export type UserHistoryCategory =
  | "match" | "live" | "tournament" | "group" | "duel";

export type UserHistoryRow = {
  category: UserHistoryCategory;
  refId: string;              // match/custom_bet/duel id (react key)
  question: string;           // localized
  contextLabel: string | null;// "BRA vs GER", scope label, etc.
  sortTs: string;             // canonical chronological anchor
  pickLabel: string;          // localized (renderPickAnswer / score / yes-no)
  stake: number;              // points at risk
  net: number | null;         // signed net points; null when pending
  isPending: boolean;
};

export type UserHistorySummary = {
  totalBets: number; settledCount: number; pendingCount: number;
  wins: number; losses: number; pushes: number;
  totalStaked: number; totalWon: number; totalLost: number; net: number;
  byCategory: Record<UserHistoryCategory, { net: number; count: number }>;
};
```

`getUserBetHistory(userId, locale)` = the five lock-safe branches of
`getTransparencyByQuestion`, **filtered to one user, no date filter,
unioned, sorted `sort_ts DESC`**. Summary computed in JS from exactly
those rows so headline numbers always reconcile with the list
(`net === totalWon - totalLost`).

### Per-branch rules (verified against schema)

| Branch | Source / lock filter | `sort_ts` | `stake` | `net` | pending when |
|--------|----------------------|-----------|---------|-------|--------------|
| match | `match_bets` ⋈ `matches`, `m.status in ('live','final')` | `m.kickoff_at` | `coalesce(stake_paid_main,0)` | `points_earned` (already net) | `m.status <> 'final'` |
| live | `custom_bets scope in ('match','day')`, `lock_at <= now()`, `status <> 'cancelled'` | `cb.lock_at` | `stake_paid` | `points_earned - stake_paid` | `status not in ('graded','reversed')` |
| tournament | same but `scope in ('tournament','stage')` | `cb.lock_at` | `stake_paid` | `points_earned - stake_paid` | as above |
| group | same but `scope = 'group'` | `cb.lock_at` | `stake_paid` | `points_earned - stake_paid` | as above |
| duel | `duels` where opener=u or joiner=u, `status <> 'cancelled'` | `coalesce(joined_at, created_at)` | `stake` | `duelCaseSql(userId)` | `status in ('open','matched')` |

- Pick label reuse: match = `home_score-away_score`; custom = the exact
  `renderPickAnswer(answer_type, answer_config, answer, isHebrew, playerNames)`
  path already in `getTransparencyByQuestion` (so player-roster bets
  resolve names too); duel = opener/joiner answer or option label.
- When `is_pending`, `net` is `null` and the row shows "awaiting result";
  `stake` still shows (points are at risk).
- `cancelled` custom bets and duels are excluded (refunded → not history).
  Verify during build how cancellation/reversal touches `stake_paid` /
  `points_earned` before trusting net (grep grading + reversal code).

### Head-to-head

`getUserHeadToHead(aId, bId, locale)`:
- both `UserHistorySummary` (reuse the same branch SQL),
- **shared questions** (same `match_id` or same `custom_bet_id` both
  picked, both locked): both pick labels + each net → who won that one,
- **duel record** between the two: settled duels where {opener,joiner} =
  {a,b}, tally wins each side.
Keep v1 tight: two summary columns + a head-to-head record strip + the
shared-question list. No charts.

---

## 5. Frontend

`src/app/[lang]/transparency/page.tsx`:
- New `view` param: `"questions"` (default, existing UI) | `"player"`.
- New `vs` param (second userId) for head-to-head.
- A mode switch (two pills, `TransparencyTabs` visual contract):
  "לפי שאלה / By question" vs "היסטוריית שחקן / Player history".
- `player` mode (gated by the admin kill-switch):
  - user picker (select, reuse `getTransparencyUsers`) + optional
    "compare with" picker,
  - summary card(s) — net up/down (green/red), staked, won, lost,
    record (W-L-pending), by-category tiles. Model on
    [`/me/bank` BreakdownCell/StatsCard](../src/app/[lang]/me/bank/page.tsx),
  - **pending section** first (awaiting-result rows), then the settled
    timeline newest-first, grouped by date. Stacked cards (EventRow
    pattern), never a table.
  - "נקודות, לא כסף" helper line.
- New components in `src/components/`:
  `TransparencyModeTabs.tsx`, `UserHistoryView.tsx` (+ row/summary
  subcomponents), `HeadToHeadView.tsx`. Match existing naming/order.

Mobile (project CLAUDE.md): mobile-first, 44px targets, `pb-24`, no
horizontal scroll, RTL via `bdi`/`dir`, test 360/414/768/1024/1440.

---

## 6. Admin kill-switch (mirrors DashboardDigest exactly)

- Migration `0060_transparency_history_toggle.sql`: add
  `settings.transparency_history_enabled boolean not null default true`.
- Schema: add `transparencyHistoryEnabled` to `settings`
  ([schema.ts:566](../src/db/schema.ts) neighborhood).
- `getSettingsRow` ([queries.ts:69](../src/db/queries.ts)): add the column.
- Server action `transparency-history-actions.ts` (copy
  `dashboard-digest-actions.ts`: `isAdmin` gate, `db.update(settings)`,
  `revalidatePath("/[lang]/transparency","page")` +
  `revalidatePath("/[lang]/admin/system","page")`).
- Client `TransparencyHistorySettingsPanel.tsx` (copy
  `DashboardDigestSettingsPanel.tsx`).
- Mount in `admin/system/page.tsx` settings section + add column to its
  `settings` select.
- When off: `player` view falls back to `questions`; the player-history
  mode pill is hidden. By-question feed always stays up.

---

## 7. Dictionary keys (he + en)

Add under `transparency` in
`src/app/[lang]/dictionaries/{he,en}.json`:
`modeByQuestion`, `modePlayerHistory`, `pickAUser`, `compareWith`,
`pointsNotMoney`, `summaryNet`, `summaryStaked`, `summaryWon`,
`summaryLost`, `summaryRecord`, `pending`, `awaitingResult`, `settled`,
`won`, `lost`, `push`, `headToHead`, `sharedQuestions`, `duelRecord`,
`historyEmpty`, plus admin-panel strings. No existing keys change.

---

## 8. Security & correctness (rule 13)

- Only lock-safe SQL is read; bank-history is never exposed.
- `cancelled` bets/duels excluded; `is_pending` keyed off status.
- Members-only (existing auth + gate); admin kill-switch.
- Read-only query — no INSERT/UPDATE on bet tables (bets-are-sacred).
- Net reconciles with the visible rows by construction.

## 9. QA (rule 6 + project mobile checklist)

Golden path (user with all 5 types), empty user, all-pending user,
voided-bet user, duel-no-joiner, self-vs-self guard, head-to-head with no
shared questions, kill-switch off. Mobile sweep 360→1440, RTL, no
horizontal scroll. Verify `sort_ts`/`net`/`is_pending` by logging raw
rows for one user before wiring UI.

## 10. Order of work

1. `getUserBetHistory` + log raw rows for one user; verify the 3 columns.
2. Summary aggregation + unit-test the pure JS reducer.
3. `getUserBetHistory` UI (mode tabs, picker, summary, pending, timeline).
4. `getUserHeadToHead` + compare UI.
5. Migration + schema + settings read + admin panel/action + mount.
6. Dictionaries.
7. Extreme QA + mobile/RTL sweep.

## 11. Out of scope (designed for, not built)

Shareable WhatsApp cards, streaks/awards, accuracy charts, per-user
opt-out. The data shape supports adding these later.
