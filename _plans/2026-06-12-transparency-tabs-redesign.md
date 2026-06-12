# Transparency page — tab-per-category redesign

**Owner:** Yoav
**Status:** Proposed (awaiting approval)
**Surface:** `/he/transparency` and `/en/transparency`
**Related files:**
- `src/app/[lang]/transparency/page.tsx`
- `src/db/queries.ts` (getTransparencyFeed, getTransparencyUsers)
- `src/app/[lang]/dictionaries/{he,en}.json`
- `src/components/BetsTabs.tsx` (visual pattern to mirror)

---

## Goal

Replace the single flat feed on `/transparency` with a tabbed layout
(one tab per bet category) where each tab is organized **by question**
rather than by individual pick. Inside a question, the default view is
"who bet on this" with a small counter for users who did not bet on it.

## Why now

Live custom bets and duels have low participation per question — only
some of the pool plays each one — and the current flat feed hides that
shape under a wall of per-pick rows. A user who wants to answer "who
played the Argentina–Brazil live bet?" today scrolls past every other
pick to find it. Tabs cut to the right category; per-question grouping
puts the answer on one row.

## Out of scope

- Reworking the admin `/admin/bets-overview` page.
- Reworking the dashboard "Pool digest" widget.
- Adding new filters beyond the existing `user` + `date`.
- Changing what `/transparency` reveals (same bets stay public; same
  ones stay hidden — locked-only).

## Requirements

1. **Five tabs**, mirroring the categories in the existing
   `TransparencyCategory` enum: `match`, `live`, `tournament`, `group`,
   `duel`. Same display order, same dictionary labels.
2. **Row per question**, not per pick. Examples:
   - match tab: one row per match that has reached `live`/`final`
   - live/tournament/group tabs: one row per locked `custom_bet`
   - duel tab: one row per duel
3. **Each row shows** the question text, the lock/kickoff time
   (Asia/Jerusalem via `formatDateTime`), the list of users who bet
   with their pick + earned points + status, and a footer counter
   `+N לא הימרו` (`+N didn't bet`) that expands to the list of
   non-bettors. Duels do not get the counter (1v1 by design).
4. **Filters preserved**: user filter and date filter from the current
   page. User filter, when active, scopes the picker list inside each
   row to just that user, and hides rows where that user did not bet.
5. **Default view**: no filters, current tab = `match`, showing every
   match in reverse-chronological order with its picker list.
6. **Performance**: server-rendered (Server Component); each tab change
   is a real URL navigation, same as `BetsTabs`. No client state.
7. **Mobile-first**: per CLAUDE.md rule — tabs horizontally scrollable
   with `snap-x snap-mandatory`, rows readable at 360px, expandable
   non-bettor list collapses cleanly.

## Approach

### URL contract

Current: `?user=<uuid>&category=<key>&date=<yyyy-mm-dd>`

New: `?tab=<key>&user=<uuid>&date=<yyyy-mm-dd>` (rename `category` →
`tab`; tab is now part of the page contract, not just a filter). The
old `?category=` param is silently mapped to `?tab=` for back-compat so
existing links and the dashboard digest "see all" links keep working.

### Data layer

Add a new server-side function:

```
getTransparencyByQuestion({
  tab: TransparencyCategory,
  userId?: string,
  date?: string,
  locale: 'he' | 'en',
}): Promise<TransparencyQuestionRow[]>
```

`TransparencyQuestionRow` shape:

```
{
  questionId: string;
  question: string;
  eventTime: string;
  pickers: Array<{
    userId: string;
    displayName: string;
    pickLabel: string;
    stake: number;
    pointsEarned: number | null;
    status: string;
  }>;
  nonBettors: Array<{ userId: string; displayName: string }>;
}
```

Implementation:

- Reuse the existing per-category SQL inside `getTransparencyFeed`
  (already battle-tested) but switch the projection to aggregate by
  `question_id` instead of returning one row per pick. Use
  `json_agg(...)` to fold pickers into a single column.
- For `match`, `live`, `tournament`, `group`: the "expected pool" is
  every user with an approved payment (mirrors `paidParticipantsSql`
  from `src/db/pot.ts`). `nonBettors = expectedPool - pickers`.
- For `duel`: omit `nonBettors` (duels are 1v1; "didn't bet" is
  meaningless). The query returns it as an empty array.
- Keep the existing `getTransparencyFeed` and `getTransparencyUsers`
  functions in place. They feed the admin `bets-overview` explorer and
  removing them would be cross-surface churn. The new function lives
  beside them.

### UI layer

`src/app/[lang]/transparency/page.tsx`:

1. Render a `TransparencyTabs` component (new, modeled on
   `BetsTabs.tsx`) at the top.
2. Render the filter form below the tabs. Drop the category `<select>`
   (now redundant). Keep user + date.
3. Render the list of questions for the active tab. Each row is a
   `<Card>` with:
   - header: question text + event time
   - body: list of pickers (`<Chip>` per picker with name + pick + Δpts)
   - footer: `<details>` with summary `+N לא הימרו` that expands to a
     chip list of non-bettor names. `<details>` is native HTML, zero
     client JS, fully accessible. Hidden entirely for the `duel` tab.
4. Empty states: `dict.transparency.emptyTab` for "no rows in this
   tab", and `dict.transparency.allBet` for "everyone bet" (no
   `<details>` rendered).

### Settings audit (per rule 15)

No new user-controlled knobs surfaced. Tab and filters are URL state,
which is correct for shareable links. Will revisit if the user wants a
"my default tab" or "always hide non-bettors" preference.

### Observability (per rule 14)

- `console.info("[transparency tab] query", { tab, userId, date, locale })`
  on entry to `getTransparencyByQuestion`.
- `console.info("[transparency tab] result", { tab, questions, pickers, nonBettors })`
  with row + aggregate counts on exit.

### Security (per rule 13)

- Same auth gate as today: `getRequestUser` + `gatePage("transparency")`.
- No new data exposed: every question shown is already locked (the
  bet/match is past its lock-time), so we are not revealing in-flight
  picks. The "non-bettor names" exposure is no new risk either — the
  user list is already public to logged-in members via `/admin`,
  `/leaderboard`, and the existing `?user=` filter dropdown.
- Defensive try/catch around each query call, identical to the
  current page (this surface "must always be up").

### Testing (per rule 18)

- Unit test for `getTransparencyByQuestion` covering: empty pool, one
  picker per question, full-pool participation (nonBettors = []),
  date filter scoping, user filter hiding non-matching rows.
- Snapshot test for the page row markup at one row per category to
  guard against accidental column renames.
- Manual verification on 360px and 1024px viewports per the project
  responsive checklist.

## Alternatives considered

### A. Tabs with row-per-question + non-bettor counter (chosen)

Summary: tabs across the top, each tab lists locked questions in that
category in reverse-chronological order, each row expands to show who
did and didn't bet.

Detail: matches the user's mental model from `/bets/*` (same five
tabs), reads as "what happened today" at a glance, and surfaces the
participation gap (who skipped) without burying it. Reuses the
existing SQL CTEs and the existing `BetsTabs` visual pattern, so the
new surface feels native on day one. Cost: one new query function and
a 200-line page rewrite.

**Recommendation: do this.** It is what the user asked for and the
data shape (locked bets per question) supports it cleanly.

### B. Tabs + flat per-pick feed (status quo with tabs only)

Summary: keep the flat per-pick list, just add tabs to scope it.

Detail: cheaper to ship (no query change). But the "didn't bet"
signal is lost — the flat feed cannot show absence, only presence —
and that is the exact gap the user called out for live/duel.
Rejected.

### C. Per-user pivot (table: user × question)

Summary: rows are users, columns are questions, cells are picks.

Detail: dense, great for power users who want to compare bettors
side-by-side. But unreadable on mobile (the primary surface per
CLAUDE.md) without horizontal scroll on a primary content table,
which the project rules forbid. Rejected.

## Open questions

None blocking. Will surface during implementation if the
`json_agg(...)` projection for `pickers` runs hot under WC traffic
(at the scale of 32 pool members × 104 matches, we are at ~3,300 rows
in one CTE, which Postgres handles fine — but worth measuring before
shipping).

## Acceptance criteria

- All 5 tabs render and are reachable from the page.
- Each tab shows row-per-question, default reverse-chronological.
- Each non-duel row shows pickers inline + a `+N` collapsed
  non-bettor list.
- User + date filters still work.
- Old `?category=` links keep working.
- Page renders cleanly at 360px / 414px / 768px / 1024px / 1440px.
- All times render in Asia/Jerusalem via `formatDateTime`.
- New unit tests pass; existing `transparency`/`bets-overview` tests
  pass unchanged.
