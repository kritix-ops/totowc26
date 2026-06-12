# Home dashboard: "Today's bets" section

**Date:** 2026-06-11
**Status:** Draft — building
**Owner:** Yoav

---

## 1. Goal

On the signed-in home page, show every signed-in user a single section
that aggregates **all of their own bets that touch today's matches**,
plus a points-from-today badge. Reduces the click cost of "what did I
bet on for today?" from two taps (home → bets → today) to zero.

Scope today (Asia/Jerusalem):

- **Match predictions** (`match_bets`) for every fixture whose
  `kickoff_at` lands on today's date in Asia/Jerusalem.
- **Live match-scope custom bets** (`custom_bets.scope='match'`) whose
  underlying match is on today.
- **Live day-scope custom bets** (`custom_bets.scope='day'`) anchored
  to today's matchday.
- **Total points from today** = Σ `match_bets.points_earned` (today's
  graded matches) + Σ `user_custom_bet_picks.points_earned` minus
  `stake_paid` (today's graded custom bets — live only; free
  outright bets have stake 0).

Out of scope (today): tournament/stage/group bets and duels. Those have
no per-day anchor; they belong on their own tab and would muddy the
"today" lens.

## 2. Where it goes

Inserted between `SmartHubAsync` ("Up next") and `UpcomingSectionAsync`
("Upcoming matches") in `src/app/[lang]/page.tsx`. Reasoning:

- SmartHub is *action-first* ("you still need to pick X"). The new
  section is *snapshot* ("here's what you've placed"). They read as a
  natural call-and-response.
- Upcoming below it still serves users on non-match days, and gives
  context for *future* matches once today is shown.

The section returns `null` when (a) there are no fixtures today AND
(b) the user has placed no day-scope bets that resolve today — so
non-match days lose the widget rather than rendering an empty card.

## 3. Data layer

New cached server query in `src/db/queries.ts`:

```ts
export type TodayBetSummaryFixture = {
  id: string;
  homeCode: string;
  homeNameHe: string;
  homeNameEn: string;
  awayCode: string;
  awayNameHe: string;
  awayNameEn: string;
  kickoffAt: string;
  status: "scheduled" | "live" | "final";
  homeScore: number | null;
  awayScore: number | null;
  myHome: number | null;
  myAway: number | null;
  myPoints: number | null;
  myExact: boolean | null;
};

export type TodayBetSummaryCustomBet = {
  id: string;
  scope: "match" | "day";
  questionHe: string;
  questionEn: string;
  status: "open" | "locked" | "graded" | "reversed";
  matchId: string | null;
  matchLabel: string | null;
  lockAt: string;
  myAnswer: PickAnswer | null;
  myStakePaid: number | null;
  myPointsEarned: number | null;
  myWasCorrect: boolean | null;
};

export type TodayBetsSummary = {
  date: string;                // YYYY-MM-DD Asia/Jerusalem
  fixtures: TodayBetSummaryFixture[];
  customBets: TodayBetSummaryCustomBet[];
  totals: {
    matchPoints: number;       // graded match_bets only
    customPoints: number;      // graded custom bets net of stake
    pendingMatchBets: number;  // count w/ pick, not yet graded
    pendingCustomBets: number; // count w/ pick, not yet graded
    placedMatchBets: number;
    placedCustomBets: number;
  };
};

export async function getTodayBetsSummary(
  userId: string,
): Promise<TodayBetsSummary>;
```

All filtering anchors on `(kickoff_at at time zone 'Asia/Jerusalem')::date`
or `matchdays.date`, matching the patterns already used by
`getPlayDayDetail` and `getTransparencyDigest`. The query never reads,
mutates, or recomputes a placed bet — read-only joins to
`match_bets` and `user_custom_bet_picks`.

## 4. Presentation

New server component `src/components/TodayBetsSection.tsx`:

- Header strip: section title + small pill showing `+N נק׳ היום` /
  `+N pts today` (only when `totals.matchPoints + totals.customPoints
  !== 0`), and a "view full day" link into
  `/bets/live/{today}`.
- Fixtures list (only if `fixtures.length > 0`):
  - Card per match.
  - Status pill (scheduled / live / final) + kickoff time.
  - Two team rows with flags and the user's score guess (or
    "—" when no pick).
  - For graded matches: small chip with `+N` and an "exact" badge when
    `myExact`.
- Custom bets list (only if `customBets.length > 0`):
  - Compact rows showing question + user's answer + status pill.
  - Match-scope rows show the team-pair label so they don't lose
    context outside the fixture they hang off.
- Empty state suppressed entirely (component returns `null`).

Suspense skeleton mirrors the new layout (header + two card rows).

Component is server-rendered; no client state, no Date.now() calls (per
existing `serverNow()` pattern; we don't need a countdown here — the
existing `/bets/live/[date]` page owns that).

## 5. Internationalisation

Strings to add to `src/app/[lang]/dictionaries/he.ts` and `en.ts`:

```
dashboard.todayBetsTitle
dashboard.todayBetsViewAll
dashboard.todayBetsScoreLabel
dashboard.todayBetsNoPick
dashboard.todayBetsPointsBadge        ("+{n} pts today" / "+{n} נק׳ היום")
dashboard.todayBetsExactBadge
dashboard.todayBetsCustomMatchScope   ("vs", inferred from match label)
dashboard.todayBetsPending
dashboard.todayBetsCorrect
dashboard.todayBetsWrong
```

All times rendered via `formatDateTime` from `@/lib/format` (memory
rule: Jerusalem timezone is mandatory).

## 6. Security / safety

- Read-only. No new mutation surface.
- The query joins `match_bets` and `user_custom_bet_picks` by
  `user_id = $userId`. No bet rows from other users are exposed.
- The component is server-rendered behind the same `getRequestUser()`
  gate the rest of the dashboard uses.

## 7. Observability

`console.info('[dashboard today-bets] loaded', { userId, date,
fixtureCount, customCount, matchPoints, customPoints })` once per
render. Mirrors existing `[bets/live/date]` logs in shape.

## 8. Tests

- `getTodayBetsSummary` unit test verifying:
  - Returns today's fixtures + bets only.
  - Total points sums correctly over graded match + custom bets.
  - Custom bets net stake_paid only for live (match/day) scopes.
  - Returns `fixtures: []` + `customBets: []` when nothing scheduled
    today.
- Skipped if no test seed harness for these tables exists already —
  in which case noted explicitly.

## 9. Settings

No user-tunable knob yet. The widget is always-on when there is data,
auto-hides when empty. If users later ask to mute it we add a single
boolean to `settings` or a profile column; not warranted on day one.
