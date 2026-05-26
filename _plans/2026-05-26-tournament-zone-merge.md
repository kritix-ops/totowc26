# Tournament zone — merge /club + /standings

Date: 2026-05-26
Status: Approved, ready to implement
Follows: 2026-05-26-nav-realignment.md

## Goal

Collapse "מועדון" (`/club`) and "המונדיאל" (`/standings`) into a single
"אזור מונדיאל" / "World Cup Zone" page at `/tournament` with internal
tabs. The two pages overlap heavily today (the club page already
includes a standings preview) and neither name communicates clearly
what the page is for.

The new page is the home for *tournament context* — everything happening
on the FIFA side that helps a player decide their next bet or just
soak in the World Cup. It is distinct from `/leaderboard` (which is
about the friends pool, not the tournament itself).

## Decisions taken with the user

- Name: **אזור מונדיאל** / **World Cup Zone**
- URL: `/tournament`
- Tabs in V1, in order:
  1. **סיכום** / **Summary** — stat strip, recent results, top scorers,
     group leaders preview, goals-per-day chart
  2. **טבלאות** / **Tables** — full live group standings (the current
     /standings content)
  3. **נבחרות** / **Teams** — the teams grid grouped by FIFA group
     (current /club bottom section)
  4. **חדשות** / **News** — placeholder with a coming-soon card;
     reserved for the future RSS feed
- Mobile tab bar: sticky under the page title, horizontal scroll when
  needed
- `/club` → redirect to `/tournament`
- `/standings` → redirect to `/tournament?tab=tables` (so deep links
  still land on the right tab)

## Architecture

### Tab state via URL query parameter

`/tournament?tab=summary|tables|teams|news`

- Default tab is `summary` when no query param is present.
- Server component reads `searchParams.tab`, validates it, renders the
  matching content section.
- Tab bar is a client component (`TournamentTabs.tsx`) that uses
  `usePathname` + `useSearchParams` to compute the active tab and
  renders each tab as a `<Link>` for instant-feeling navigation (Next
  prefetches the linked URL).
- Benefits over pure-client state: deep linking, browser back/forward
  works, server can render the right tab on first paint (no flash of
  wrong tab content).

### Component layout

```
/tournament/page.tsx (server)
├── <TournamentHeader />         page title + subtitle
├── <TournamentTabs />           client, sticky horizontal bar
├── <Suspense fallback=…>
│   └── one of:
│       ├── <SummaryTab />       reuses Summary strip + Recent + Top scorers + Group leaders + Goals chart
│       ├── <TablesTab />        full LiveStandings (reused from /standings)
│       ├── <TeamsTab />         All teams grid (current /club bottom)
│       └── <NewsTab />          placeholder, coming-soon card
```

All four tab components live alongside the page:
`src/app/[lang]/tournament/{SummaryTab,TablesTab,TeamsTab,NewsTab,TournamentTabs}.tsx`

The reusable bits already exist as helpers inside the current
`/club/page.tsx` (SummaryStrip, RecentResultsList, GoalsChart,
TopScorersCard, StandingsPreview, TeamsGrid, TeamLine, TeamCard,
GoalsBars). They get extracted into a shared spot or moved with the
new files so they can be reused without duplication.

### Sticky tab bar — visual + behavior

- Position: `sticky top-14 md:top-16` (matches the header height, so
  it docks immediately below it when scrolled).
- Background: `bg-surface-container` with a `border-b border-outline-variant`
  shadow that appears once stuck. We can fake this with a permanent
  thin border + a subtle `shadow-sm` while sticky.
- Tabs are rendered as `<Link>` elements styled as pills (rounded-full,
  px-4 py-2, min-h-[40px]) so they hit the 44x44 touch target with
  vertical padding accounted for in min-height. RTL handled via the
  parent's `dir`.
- Active state: filled background `bg-primary` with `text-on-primary`,
  inactive: `bg-surface-container-lowest text-on-surface-variant`.
- Mobile: `overflow-x-auto snap-x snap-mandatory` so the bar scrolls
  horizontally if the four labels don't fit. Snap stops on each tab.
- Auto-scroll the active tab into view on mount (helps when the user
  arrives via a deep link to `?tab=teams` on a narrow screen).
- News tab gets a small "בקרוב" / "Soon" badge so users know it's
  intentional-empty, not broken.

## Affected files

### New
- `src/app/[lang]/tournament/page.tsx`
- `src/app/[lang]/tournament/TournamentTabs.tsx` (client)
- `src/app/[lang]/tournament/SummaryTab.tsx`
- `src/app/[lang]/tournament/TablesTab.tsx`
- `src/app/[lang]/tournament/TeamsTab.tsx`
- `src/app/[lang]/tournament/NewsTab.tsx`

### Modified
- `src/app/[lang]/dictionaries/he.json`, `en.json`
  - Add `nav.tournament` ("אזור מונדיאל" / "World Cup Zone")
  - Remove `nav.club`, `nav.worldCup`
  - Add `tournament.*` block with: `title`, `subtitle`,
    `tabSummary`, `tabTables`, `tabTeams`, `tabNews`,
    `newsComingSoonTitle`, `newsComingSoonBody`,
    `tabBadgeSoon`
- `src/app/[lang]/club/page.tsx` — replace with `redirect("/tournament")`
- `src/app/[lang]/standings/page.tsx` — replace with
  `redirect("/tournament?tab=tables")`
- `src/components/AppShell.tsx`
  - Top nav: replace the `club` + `standings` entries with a single
    `tournament` entry. Position: where `club` currently sits.
    Resulting order: ראשי · הימורים · מובילים · **אזור מונדיאל** · תשלום
    (5 items for player, 4 + admin for admin).
  - Bottom nav (mobile): `BottomNavLink path="tournament"` replaces
    `path="club"`. New order: ראשי · הימורים · מובילים · **אזור מונדיאל** · עוד.
  - `MobileMoreSheet`: drop the `worldCup` (standings) row since it's
    no longer a standalone destination. Sheet contents shrink to:
    תשלום (player), ניהול (admin), פרופיל, התנתקות.
- `src/components/MobileMoreSheet.tsx`
  - Remove the `worldCup` item and its label prop.
- `src/app/[lang]/teams/[code]/page.tsx` line 60: update the back link
  from `localePath(locale, "standings")` to
  `localePath(locale, "tournament?tab=tables")`.
  (The internal link inside the old club page at line 425 goes away
  with the redirect.)

## Observability (rule 14)

- `[tournament render]` — server log on each page render with
  `{ tab, isAdmin, isHebrew, hasResults, scorerCount, groupCount,
    teamCount }`.
- `[tournament tab change]` — client log inside `TournamentTabs` when
  a tab link is clicked, with `{ from, to }`.

## Settings (rule 15)

No new user-facing settings. The default tab is `summary` and we do
not expose a "preferred starting tab" preference — it would add a
knob the user does not need. If a power user later asks for it, that
becomes the moment to add it, not now.

## Out of scope

- The RSS feed itself. The News tab ships as a placeholder with
  copy that says we are working on it.
- Visual redesign of the existing summary/results/teams sub-cards —
  they keep their current styling.
- Restructuring the data layer (`getLiveStandings`, `getLiveTopScorers`,
  etc. stay where they are).

## QA checklist

1. `/tournament` (no query param) → Summary tab is active, content renders.
2. `/tournament?tab=tables` → Tables tab active, full LiveStandings.
3. `/tournament?tab=teams` → Teams tab active, grid by group.
4. `/tournament?tab=news` → News tab active, coming-soon card.
5. `/tournament?tab=bogus` → falls back to Summary (no 500).
6. `/club` → 308 redirect to `/he/tournament`.
7. `/standings` → 308 redirect to `/he/tournament?tab=tables`.
8. Top nav (desktop): single "אזור מונדיאל" entry. No more "מועדון"
   or "המונדיאל" labels anywhere in the chrome.
9. Bottom nav (mobile): "אזור מונדיאל" sits in slot 4. The "More"
   sheet no longer lists "המונדיאל".
10. Sticky tab bar: at 360px width, scroll the page — tabs dock under
    the header and stay visible.
11. Tab bar at 360px with all four labels: horizontal scroll works,
    active tab is visible.
12. RTL: tab order reads right-to-left in Hebrew. LTR for English.
13. Team detail page back link → lands on `/tournament?tab=tables`.
14. Admin viewing-as a player: page still works, no admin-only chrome
    inside the tab content.
15. Typecheck + build green; no remaining import of `nav.club` /
    `nav.worldCup`.

## Alternatives considered and rejected

- **Pure client tab state (no URL query param)**: faster on initial
  click but loses deep linking and back/forward. Users can't share a
  link to the standings. Rejected.
- **Folder-based tabs (`/tournament/tables`, `/tournament/teams`)**:
  cleaner URLs but heavier — every tab becomes its own page with its
  own layout boundary, and the shared `<TournamentTabs />` would need
  to live in a layout. With four tabs and tight reuse, search-params
  is lighter.
- **Keep `/club` URL, rename label only**: minimal churn but the URL
  would lie about what the page is (`tournament` zone at a `/club`
  path). One-time redirect cost is worth the clarity.
- **Roll `/leaderboard` into the same page as a fifth tab**: the
  leaderboard is about the *friends pool*, this page is about the
  *tournament*. Mixing them dilutes both. Keep separate.
