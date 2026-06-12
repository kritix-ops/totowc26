# Bet history per surface — "Upcoming | Past" sub-toggle

**Date:** 2026-06-12
**Status:** Approved scope, ready to implement
**Owner:** Yoav

---

## 1. Problem

Once a bet "passes" (match kicks off, custom bet locks/grades), the user has no
way to see it on the betting pages anymore. They opened `/bets`, picked a score,
the match started, and the row disappeared. They want to be able to look back
and see what they bet, what actually happened, and how many points it earned.

Concretely, four of the five bet surfaces hide past entries entirely:

| Surface | Current filter | What disappears |
|---|---|---|
| `/bets` (Match picks) | `m.status='scheduled' AND m.kickoff_at > now()+5min` | Every match the moment it goes live/final |
| `/bets/live` | day `>= today (Asia/Jerusalem)` | Yesterday's matchday + every day before |
| `/bets/tournament` | `cb.status IN ('open','locked')` | Graded / reversed / cancelled bets |
| `/bets/groups` | same | same |
| `/duels` | `?tab=mine` already shows settled — but sorted oldest-first at the bottom | Past duels reachable but buried |

The user cross-references their bank history on `/me/bank`, but that page shows
**transactions** (point deltas), not the **bets themselves** (pick + result +
context). They want the bets.

---

## 2. Goal

Each bet surface gains an "Upcoming | Past" sub-toggle. The user can flip to
"Past" and see every bet of that type they have placed (or could have placed),
newest first, with: their pick, the actual result, points earned/lost, and the
date/time. Read-only — no editing or re-picking from the history view.

---

## 3. Constraints (from CLAUDE.md + project CLAUDE.md)

- **Clean & ordered code** (rule 2): sub-toggle follows existing `BetsTabs`
  styling. New past-view rows live alongside existing components in
  `src/components/`, named to match (`PastMatchPickRow`, `PastCustomBetRow`).
- **Mobile-first** (project rules): toggle is a 44px-tall pill pair on a single
  row, history rows stack vertically, no horizontal scroll at 360px.
- **Lazy user** (rule 10): the toggle sits exactly where the user already looks
  for filters — directly under the `BetsTabs` strip. Default stays "Upcoming"
  so existing muscle memory is preserved.
- **Don't look AI-generated** (rule 5): reuse existing tokens (`bg-primary`,
  `bg-surface-container-lowest`, `border-outline-variant`) — no new gradients,
  no fresh "Polished History" pattern.
- **User bets are sacred** (memory): history surfaces are pure SELECTs.
  Zero mutation code paths on these pages. Verified by trace.
- **Jerusalem timezone** (memory): every date in the history view uses
  `formatDateTime(..., locale, {...})` — never raw `Intl.DateTimeFormat`.

---

## 4. Decisions locked (from clarification round, 2026-06-12)

| Question | Choice |
|---|---|
| Where does history live? | Sub-toggle in each bet type (Upcoming \| Past) |
| What per row? | My pick + actual result + points earned/lost + date/time |
| Scope? | Everything, newest-first |
| URL design | `?view=upcoming\|past`, default `upcoming` |
| Duels exception | `?tab=open\|mine` stays. Mine gets re-sorted newest-first |

---

## 5. Chosen approach

### 5.1 New component: `BetsSubTabs`

`src/components/BetsSubTabs.tsx` — server component, two pills:
"בעתיד | עברו" (Upcoming | Past). Reads the active view, links to the same
route with `?view=upcoming` / `?view=past`. Identical visual rhythm to
`BetsTabs` (44px height, snap-x scroll on mobile) so the two strips read as a
pair.

### 5.2 Past view per surface

| Surface | Past query | Per-row content |
|---|---|---|
| `/bets` | `m.status IN ('live','final') OR (m.status='scheduled' AND m.kickoff_at <= now()+5min)` — ordered by `kickoff_at desc` | Home/Away with flags, my score, final score, points (+15/+5/0/-N), kickoff date |
| `/bets/live` | matchdays before today (Asia/Jerusalem), ordered desc — same `listOpenPlayDays` shape with reversed date filter; each card already links to `/bets/live/[date]` which renders the day in read-only fashion via existing `getPlayDayDetail` (already shows live, final and graded bets) | Date, flags preview, count of bets I picked |
| `/bets/tournament` | `cb.status IN ('graded','reversed','cancelled')` ordered by `graded_at desc nulls last, lock_at desc`. Returned even when I didn't pick — the user asked for "everything", so each row shows my pick or "—" | Question, my answer, resolved value (decoded for human read), points earned, graded_at |
| `/bets/groups` | same as tournament, scoped to `cb.scope='group'`, bucketed by group like the upcoming view | same as tournament |
| `/duels` | leave the existing `?tab=open\|mine` structure. Re-sort the `mine` query: `case status when 'settled' then ... newest first` so past matched/settled duels rise to the top | (existing duel row, just reordered) |

### 5.3 URL & navigation

- Both `?view` and `BetsTabs` co-exist. `?view=past` is the only knob the
  sub-toggle touches; tab switches preserve it via the existing link `href`.
- When the user switches `BetsTabs` (e.g., Match picks → Tournament), the
  `?view` resets to the new tab's default (= upcoming). This is intentional —
  the user is moving to a different surface, they expect a fresh starting
  point.
- Back button works naturally because each state is a real URL.

### 5.4 Read-only row components

- `PastMatchPickRow` (server component, in `src/app/[lang]/bets/`):
  - Inputs: locale, match data (codes, names, kickoff), my pick (or null),
    final score (or live + status), points earned (or null = ungraded yet).
  - Output: A card with team names + flags, two score lines (mine / actual),
    a points chip (positive = success-container, negative = error-container,
    zero = surface-container-high), kickoff date right-aligned.
- `PastCustomBetRow` (server component, in `src/components/`):
  - Inputs: locale, question, my answer (decoded), resolved value (decoded),
    points earned, graded_at, status.
  - Output: question on top, "ניחוש | תוצאה" two-column row, points chip,
    status badge for `reversed` / `cancelled` so the user understands why
    points might be unusual.

Decoding answer JSONB (yes_no / number / multi_choice / free_text) reuses the
helpers already living in `src/lib/bets/`. No new decoding logic — if there's
a gap, fix the existing helper rather than duplicate.

---

## 6. Alternatives rejected

### Alt A — Sixth "History" tab in `BetsTabs`
A unified history tab showing every bet type in one chronological feed.
**Rejected** because the user explicitly chose per-tab sub-toggle. Also:
mixing bet types in one feed makes scanning harder for the lazy user (rule 10)
— "show me my tournament picks" should not require scrolling past 30 match
picks to find them.

### Alt B — Inline "past" section under "upcoming" on each page
Show past bets directly below the upcoming list on the same view, no toggle.
**Rejected** because past lists will be long (104 matches × everyone picking
all), and the user landing on `/bets` to pick the next match would scroll past
hundreds of resolved rows before finding the live picks. Worse for the primary
flow.

### Alt C — Dedicated `/history` route
Single page combining past bets across types with filters.
**Rejected** for the same reason as Alt A — splits the mental model.

---

## 7. Security & safety (rule 13)

- All history queries are **read-only SELECTs** with `user_id = current user`
  in the JOIN. No mutation code paths added.
- `user_custom_bet_picks.answer` is JSONB controlled by the picking flow;
  rendering on the past view passes it through the same i18n decoder as the
  upcoming view, no new XSS surface.
- `getRequestUser()` already gates each page. The past view inherits the same
  auth flow — no new auth code.
- Pay-gate (`access.canEdit`) is irrelevant for past view (no picking happens)
  but we keep the page reachable so unpaid users can still see what they
  picked back when access was open / before lapse.
- RLS is unchanged. No new tables, no new columns. Verified.

---

## 8. Observability (rule 14)

Every past-view query gets a namespaced log on the page entry so an empty
list can be diagnosed from the function logs:

```
console.info('[bets past] match-picks loaded', { userId, rowCount, view: 'past' });
console.info('[bets past] live-days loaded',   { userId, dayCount, view: 'past' });
console.info('[bets past] tournament loaded',  { userId, rowCount, view: 'past' });
console.info('[bets past] groups loaded',      { userId, rowCount, view: 'past' });
```

Errors caught with `try/catch` per page section (matching the defensive
pattern already in `/me/bank/page.tsx`), so a single failing section renders
its empty-state rather than blanking the whole page.

---

## 9. Settings audit (rule 15)

No new settings introduced. Past view has no editable defaults — it's a pure
display surface. Considered:

- **Auto-default to Past when all upcoming bets are placed?** Rejected.
  Surprises the user. Default stays "Upcoming".
- **Pagination size?** No pagination needed for a ~30-person friends pool.
  All-time fits in one query with `limit 500` as a safety backstop.
- **Optional "include unpicked" toggle?** Considered, deferred. The user asked
  for "everything"; we ship "everything" and revisit only if cluttered.

---

## 10. Testing (rule 18)

- **`getPastMatchPicks(userId)` unit test** — fixtures: one final match where
  user nailed exact score, one live match where user picked but no points yet,
  one final match where user didn't pick. Assert: all three returned, sorted
  by kickoff desc, points null on the ungraded one.
- **`getPastTournamentBets(userId)` unit test** — fixtures: graded bet user
  picked, graded bet user didn't pick, reversed bet, cancelled bet. Assert
  all four returned with the correct status badge value.
- **`getPastGroupBets(userId)` unit test** — same shape, scope='group'.
- **`getPastPlayDays()` unit test** — fixtures: 5 matchdays spanning past +
  today + future. Assert past view returns only the 2 past days, ordered desc.
- **Page-level rendering smoke** — render each page in both `view=upcoming`
  and `view=past`, assert the BetsSubTabs strip is present, active pill
  matches the view, and the empty-state copy is shown when zero rows.
- Run the full `pnpm test` after the changes; no regression in any existing
  query.

---

## 11. Mobile QA checklist (project rules)

Before the task is called done:
1. Open `/bets?view=past` at 360px width. Read every label. No clipping.
2. Toggle Upcoming/Past at 360px. Pills are tappable (≥44px).
3. Scroll a long past list. Bottom nav (80px) doesn't obscure the last row.
4. Switch to landscape at 414px. Layout doesn't break.
5. Re-do steps 1–4 for `/bets/tournament?view=past`, `/bets/groups?view=past`,
   `/bets/live?view=past`.

---

## 12. File-by-file changes

```
+ src/components/BetsSubTabs.tsx          New sub-toggle (Upcoming | Past)
+ src/components/PastCustomBetRow.tsx     Read-only row for tournament/groups
+ src/app/[lang]/bets/PastMatchPickRow.tsx Read-only match-pick row

~ src/app/[lang]/bets/page.tsx            Reads ?view, splits into upcoming/past
~ src/app/[lang]/bets/live/page.tsx       Reads ?view, splits index into upcoming/past
~ src/app/[lang]/bets/tournament/page.tsx Reads ?view, splits into upcoming/past
~ src/app/[lang]/bets/groups/page.tsx     Reads ?view, splits into upcoming/past
~ src/app/[lang]/duels/page.tsx           Mine tab re-sorted newest-first

~ src/db/queries.ts                       Adds getPastMatchPicks,
                                          getPastTournamentBets,
                                          getPastGroupBets,
                                          listPastPlayDays

~ src/lib/dictionaries/he.ts, en.ts       Adds:
                                          betsSubTabs.upcoming, .past,
                                          pastBets.emptyMatch, .emptyLive,
                                          .emptyTournament, .emptyGroups,
                                          .myPick, .result, .points, .noPick

+ src/db/queries.past-bets.test.ts        Unit tests per §10
```

No migrations, no settings columns, no third-party deps, no cost implications
(rule 8 N/A).
