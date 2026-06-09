# Transparency Coverage Audit + Dashboard Pool Digest

**Date:** 2026-06-09
**Status:** Draft — awaiting user approval before any code
**Owner:** Yoav

---

## 1. Goal

Two related fixes that land together so the tournament-day experience
actually reads as a shared pool, not a private feed:

1. **Transparency page coverage.** Today the feed bundles every locked
   `custom_bet` under the "Live bet" label regardless of whether the
   row is a match-level live bet, a daily live bet, a tournament
   one-shot, a stage prediction, or a group ranking. A player who
   wants to ask "who picked Argentina to win Group A?" cannot filter
   to that surface — they get a wall of mixed rows. Split categories
   so the filter mirrors the four `/bets/...` surfaces a player
   already understands, plus duels.

2. **Dashboard pool digest.** The home dashboard has no social proof.
   Once a player's own pick locks, the page goes silent until the
   match finishes. Add a single card between the upcoming-matches
   strip and the bottom grid that shows the pool's locked picks for
   today: total bettors, top question, vote split, plus a button into
   the full Transparency page.

Both pieces only render data that is already publicly visible per the
existing lock rules in `src/db/queries.ts` §1880-1888. No new
visibility surface; we are reorganising what the player can already
see.

---

## 2. Constraints (from `~/.claude/CLAUDE.md` and project `CLAUDE.md`)

- **Verify, never guess** (rule 1): every existing query, dictionary
  key, and component referenced below was read in this planning
  session; no path is taken from memory.
- **Clean ordered code** (rule 2): new query slots into `queries.ts`
  next to `getTransparencyFeed`. New component lives in
  `src/components/` alongside the other dashboard sections, named
  `PoolDigestSection.tsx` to match `LastBetSection` / `TrendSection`
  / `LeaderboardSection`.
- **Alignment before code** (rule 3): this document is the alignment.
  User already confirmed (this session): 5 categories, widget below
  Upcoming, today's-summary depth.
- **Project-style alternatives** (rule 4): three were considered for
  the category split; option A (5 categories) chosen — see §4.
- **Designs not AI-generated** (rule 5): widget reuses existing `Card`,
  `Chip`, `LabelCaps`, `SectionHeading` primitives. No new gradients,
  no glassmorphism.
- **Extreme QA after task** (rule 6): manual walk through
  `/he/transparency` and `/he/` covers pre-tournament, day-with-locks,
  empty-state, no-pool-data state.
- **Plan into `_plans/`** (rule 7): this file.
- **Costs** (rule 8): no third-party service touched. Pure DB read.
- **Context7** (rule 9): no library API changes; sticking to React
  19 / Next 16 idioms already in repo. No fetch needed.
- **Lazy user** (rule 10): widget is one card with a single CTA.
  Player sees pool consensus without filtering, without clicking,
  without scrolling.
- **Council** (rule 11): scope is intentionally small (one query,
  one component, one category enum change). Skipped — user already
  picked the path and the surface is reversible.
- **Brutal honesty** (rule 12): risks listed in §9. Biggest one is
  that pre-tournament the widget has nothing to show and feels like
  dead weight; mitigation in §7.
- **Security** (rule 13): every row in the digest passes the same
  lock filter the transparency feed uses. No new endpoint, no
  client-side data; widget is a server component rendered behind
  the existing auth check on `/[lang]`.
- **Observability** (rule 14): every new query logs
  `[transparency feed]` and `[dashboard digest]` with namespaced
  counts (`bets`, `bettors`, `topQuestion`).
- **Settings audit** (rule 15): one new admin toggle —
  `settings.dashboardDigestEnabled` (default `true`). The
  transparency page already has its own gate via `gatePage`. No
  per-user setting; the widget is small enough that opting individual
  players out is overkill.
- **UI/UX friendly** (rule 16): mobile-first, single column at
  `<md`, mirrors `LastBetSection` framing so it reads as part of the
  same family.
- **Tests** (rule 18): three Vitest unit tests on the new
  `getTransparencyDigest` query: empty pool, single-question, multiple
  questions with a clear top consensus. Manual UI walkthrough at
  360/414/768/1024/1440 per project `CLAUDE.md`.

---

## 3. Scope

**In scope:**
- Expand `TransparencyCategory` enum from 3 → 5 values.
- Split the `live` UNION branch in `getTransparencyFeed` into three by
  `custom_bets.scope`.
- New dictionary keys: `transparency.categoryTournament`,
  `transparency.categoryGroup` (he + en).
- Update `categoryLabel`, `categoryTone`, and `CATEGORIES` in
  `src/app/[lang]/transparency/page.tsx`.
- New query `getTransparencyDigest(userId, locale)` returning today's
  pool aggregates.
- New component `PoolDigestSection` rendered inside a `<Suspense>` in
  `src/app/[lang]/page.tsx` between `UpcomingSectionAsync` and the
  bottom grid.
- New skeleton `PoolDigestSectionSkeleton` in `PageSkeleton.tsx`.
- New admin toggle `dashboardDigestEnabled` in `settings` table and
  `/he/admin/dashboard` (or whichever admin pane hosts dashboard
  toggles — verify before edit).

**Out of scope:**
- Changing the lock rules. Nothing here changes when bets become
  visible.
- Aggregations on the transparency page itself. Rows stay as
  individual rows; only the dashboard digest aggregates.
- Per-match social-proof on `DashboardPickCard` (people-also-picked).
  Worth its own pass later; do not bundle here.
- Real-time updates. Both surfaces are server-rendered on each
  navigation; no SSE/polling.

---

## 4. Category split — chosen approach

Three options were considered:

**A. Five categories mirroring `/bets` (CHOSEN).** Match picks, Live,
Tournament, Group rankings, Duels. The category filter now matches
the four bet surfaces a player navigates inside `/bets/...` plus
duels. Cost: one new enum value (`tournament`, `group`), two new
dictionary strings per locale, one extra branch in the UNION SQL.

**B. Three categories with a chip beside each row.** Keep `match`,
`live`, `duel`. Add a sub-label chip rendered on each row to
distinguish tournament vs stage vs group vs daily inside the "live"
bucket. Cheaper to ship, but the filter dropdown still cannot answer
"show me only tournament bets." Rejected.

**C. No categories.** Drop the filter entirely, surface each row's
scope as a label. Cheapest of all but trades the filter affordance the
page already advertises. Rejected.

A wins because (1) the player already understands the four `/bets`
surfaces, so the filter reads as familiar, (2) tournament/group bets
are the most asked-about post-lock because they are the long-running
storylines, (3) cost is linear in enum size — no architectural
escalation.

---

## 5. Backend changes — `src/db/queries.ts`

### 5.1 `TransparencyCategory` and the UNION

```ts
export type TransparencyCategory =
  | "match"
  | "live"        // custom_bets where scope in ('match','day')
  | "tournament"  // custom_bets where scope in ('tournament','stage')
  | "group"       // custom_bets where scope = 'group'
  | "duel";
```

The current UNION's "live" branch becomes three identically-shaped
branches that differ only in the `WHERE cb.scope IN (...)` clause and
the `'live' / 'tournament' / 'group'` literal in the SELECT. The lock
filter (`cb.lock_at <= now()`) stays unchanged on all three.

### 5.2 `getTransparencyDigest`

New query, returns one digest for the dashboard:

```ts
type TransparencyDigestItem = {
  category: TransparencyCategory;
  question: string;          // localised
  topPickLabel: string;      // most-picked answer
  topPickCount: number;
  totalPickers: number;
  // For yes/no bets we will surface both counts via these:
  altPickLabel: string | null;
  altPickCount: number | null;
  href: string;              // deep link into /transparency?category=...&date=...
};

type TransparencyDigest = {
  date: string;              // Asia/Jerusalem today
  totalPickersToday: number; // distinct user_id with any locked pick today
  totalQuestionsToday: number;
  highlights: TransparencyDigestItem[]; // up to 3
};

export async function getTransparencyDigest(
  locale: "he" | "en",
): Promise<TransparencyDigest>;
```

Highlight selection rule: top 3 by `totalPickers DESC` so the most
participated-in questions surface first. Ties broken by `lock_at DESC`
(most recently locked wins) so the card stays fresh as the day
progresses.

"Today" anchor: Asia/Jerusalem date of either (a) the matchday for
scope=day bets, (b) `m.kickoff_at::date` for scope=match bets, or (c)
the kickoff date of the bet's `match_id` for `match_bets`. All times
converted with `at time zone 'Asia/Jerusalem'` per the user's
mandatory-timezone memory.

If `totalPickersToday === 0`, the widget renders an empty-state card,
not nothing. Copy decided in §7.

### 5.3 Logging

```ts
console.info("[transparency feed]", {
  category: filters.category ?? "all",
  userId: filters.userId ?? "all",
  date: filters.date ?? "all",
  rows: result.length,
});
console.info("[dashboard digest]", {
  totalPickersToday: digest.totalPickersToday,
  totalQuestionsToday: digest.totalQuestionsToday,
  highlights: digest.highlights.length,
});
```

---

## 6. Frontend changes

### 6.1 Transparency page

`src/app/[lang]/transparency/page.tsx`:
- Bump `CATEGORIES` from 3 → 5.
- Extend `categoryLabel` switch.
- Extend `categoryTone` switch (`tournament` → `"warning"`, `group`
  → `"default"` so the four custom-bet rows are visually
  distinguishable from each other and from match picks).

Dictionaries:
- `transparency.categoryTournament`: `"הימור טורניר"` / `"Tournament bet"`
- `transparency.categoryGroup`: `"דירוג בית"` / `"Group ranking"`

### 6.2 Dashboard widget

New `src/components/PoolDigestSection.tsx`:

```
┌─────────────────────────────────────────────────────────┐
│ מה הקהילה ניחשה היום ·  9 ביוני                          │
│ ─────────────────────────────────────────────────────── │
│   24 משתתפים נעלו 7 שאלות היום                          │
│                                                         │
│   🎯  ארגנטינה תנצח את מקסיקו (ניחוש משחק)              │
│       18/24 הימרו על ניצחון ארגנטינה                    │
│       6/24 על תיקו או ניצחון מקסיקו                     │
│                                                         │
│   ⚡  יוסיף 3+ שערים במשחק (לייב)                       │
│       11/14 הימרו "כן"   3/14 הימרו "לא"                │
│                                                         │
│   🏆  גרמניה תעלה משלב הבתים (טורניר)                   │
│       22/22 הימרו "כן"                                  │
│                                                         │
│        [ ראה את כל ההימורים → ]                         │
└─────────────────────────────────────────────────────────┘
```

Placement: between `<UpcomingSectionAsync>` and the
`<div className="flex flex-col gap-8 ... lg:grid lg:grid-cols-12 ...">`
bottom grid, wrapped in its own `<Suspense>`. Mobile renders the card
full-width; desktop matches the same 6xl container width as its
neighbours.

CTA button: links to
`localePath(locale, "transparency") + "?date=" + todayJerusalem`
so the player lands pre-filtered to today.

### 6.3 Skeleton

Add `PoolDigestSectionSkeleton` to `PageSkeleton.tsx`:
- A `<Card>` with header line, three rows of skeleton bars, a CTA
  skeleton at the bottom. Same height as the live render so the
  layout does not jump.

---

## 7. Empty-state copy

When `totalPickersToday === 0`:

**Hebrew:**
```
מה הקהילה ניחשה היום
עוד אין הימורים נעולים להיום. ברגע שיגיע מועד הנעילה הראשון של היום,
תראה כאן מה כולם בחרו.
[ ראה את כל השקיפות → ]
```

**English:**
```
What the pool picked today
No bets have locked yet for today. As soon as the first lock-time
hits, you will see what the rest of the pool went with.
[ See full transparency → ]
```

This is the answer to risk R1 below — even on a quiet day the card
links forward to the full feed so it does not feel useless.

---

## 8. Settings + admin

Add column `dashboard_digest_enabled` (boolean, default `true`) to
`settings`. Surface in `/he/admin/...` (confirm exact admin page in
implementation — `admin/dashboard/page.tsx` if it exists, else add a
row to `admin/sandbox/page.tsx` or wherever pool-wide UI toggles live).
Plan keeps the widget on by default; toggle only matters if the
organizer wants to mute it.

---

## 9. Risks

R1 — **Quiet days feel empty.** First two days of group stage may
have 1-2 matches per day. Mitigation: empty-state copy in §7 + the
widget shows the day's locked count even when it's small (3 pickers
on 1 question is still a real datapoint).

R2 — **Dashboard query cost.** The digest joins
`user_custom_bet_picks`, `match_bets`, `custom_bets`, `matches`,
`matchdays`, `profiles` filtered on today's date. Index check:
`custom_bets_matchday_idx`, `custom_bets_match_idx` already cover the
join; `match_bets` has a user/match index. Expected row count is
small (whole pool, one day, locked-only). Verify with
`EXPLAIN ANALYZE` against the sandbox once written; if it goes over
80 ms add a `WHERE cb.lock_at <= now()` push-down on every branch
(already there for safety).

R3 — **Category split changes URL params.** Anyone with a saved link
to `/transparency?category=live` still works (we kept `live`).
`tournament` and `group` are new, additive.

R4 — **Translation drift.** Adding `categoryTournament` and
`categoryGroup` keeps existing keys intact; nothing to migrate.

R5 — **Bets-sacred memory.** The new query is read-only; no
`INSERT`/`UPDATE` anywhere. Cross-checked against the
`user_bets_are_sacred` memory note.

---

## 10. Testing plan

**Unit (Vitest):**
- `getTransparencyFeed` returns rows for each of the five categories
  (seeded fixtures cover one row per scope).
- `getTransparencyDigest` returns `totalPickersToday > 0` and
  `highlights.length ≤ 3` when seeded.
- `getTransparencyDigest` returns the empty shape (totals = 0,
  highlights = []) when nothing is locked yet for the day.

**Manual:**
- `/he/transparency` — verify the new dropdown options render and
  filter correctly.
- `/he/` (dashboard) — verify the digest card renders below the
  upcoming-matches strip, the CTA jumps to `/he/transparency` with
  the `date=` query string applied, the empty-state card renders
  when nothing is locked.
- Mobile sweep: 360, 414, 768, 1024, 1440. No horizontal scroll, no
  clipped labels.

**Regression:**
- `/he/transparency?category=live` still returns rows (back-compat).
- Bottom grid of `/he/` (Last bet / Trend / Leaderboard / Specials)
  still lays out correctly with the new card above it.

---

## 11. Order of work

1. DB query changes + tests (`getTransparencyFeed` split,
   `getTransparencyDigest` new).
2. Dictionary keys.
3. Transparency page wiring (5 categories).
4. `PoolDigestSection` + skeleton + dashboard wiring.
5. Admin toggle.
6. Manual QA sweep + screenshots.

---

## 12. Open questions

None blocking. If the admin toggle location is unclear during
implementation, surface it before adding a new admin route.
