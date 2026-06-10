# Admin "Everyone's bets" — resolve player names, add search/filter, per-user drawer, editable player picks

Date: 2026-06-10
Surface: `/[lang]/admin/bets-overview` (+ touches `/admin/users/[id]/bets` and the admin pick editor)

## Goals (from the user)
1. Show real player **names** instead of raw IDs in the player markets
   ("מי יהיה מלך השערים" / top scorer, "מי יזכה בכדור הזהב" / golden ball) — and
   anywhere else an ID leaks.
2. A smart, mobile-friendly, smooth, fast way to see **all of one user's
   per-game score bets** (the 2–1, 0–0 they entered for each match).
3. **Search + filters** to find users fast, especially on mobile.

Plus a decision taken with the user:
4. Make the player markets **editable** in the admin pick editor (today the
   editor renders zero options for dynamic-roster bets).

## Root cause of the IDs
Top-scorer / golden-ball bets are `multi_choice` with `dynamicSource: 'players'`.
Their `options` array is empty by design (the ~1,357-row roster is hydrated
client-side), so the user's pick stores the raw `api_football_id`. The shared
`renderAnswer` only resolves values found in `config.options`, so it prints the
raw id. Team markets carry inline options, so they resolve fine.

## Approach (chosen)
- **Score view**: slide-in drawer from the overview (no full nav). Lazy-loads
  the user's full bet detail on open, with a client cache so re-opens are
  instant. Drawer = a compact, complete version of the per-user page.
- **Editor**: add the existing `SearchableChoicePicker` (fed by
  `usePickerOptions('players')`) to `AdminPickEditor` for dynamic-roster bets.

Rejected: (B) just link to the per-user page — too many full navigations;
(C) all-users × all-matches grid — too wide/heavy for the phone-first audience.

## Work items

### A. Shared formatter + player-name resolution (Goal 1)
- New `src/lib/bets/format.ts`: `renderPickAnswer(answerType, config, answer,
  isHebrew, playerNames?)`. Same logic as the two duplicated `renderAnswer`
  helpers, plus: when a `multi_choice` value isn't in `config.options` AND
  `config.dynamicSource === 'players'`, resolve it from `playerNames`
  (`Map<string,{he,en}>`, keyed by api_football_id). Falls back to the raw value.
- `queries.ts`: `fetchPlayerNamesById()` → `Map<string,{he,en}>` from
  `select api_football_id, name_he, name_en from public.players`
  (name_he may be null → fall back to name_en).
- Update both render sites to delegate to the shared formatter:
  - `users/[id]/bets/page.tsx` (server) — pass the player map.
  - `bets-overview` — resolve each matrix cell's label server-side and hand the
    client a ready `pickLabel` string (no map shipped to the browser).

### B. Overview → searchable client explorer + drawer (Goals 2 & 3)
- `bets-overview/page.tsx` (server): fetch matrix + player map, pre-resolve each
  cell label, pass `users`, `bets`, `cells(+label)`, `locale` to a new client
  `BetsOverviewExplorer`. Keep the page's admin gate + data fetch server-side
  (same split as `users/page.tsx` → `UsersExplorer`).
- New `bets-overview/BetsOverviewExplorer.tsx` (client):
  - Toolbar mirroring `UsersExplorer`: search (name) + filter chips
    (all / missing picks / completed). Sticky, mobile-first, 44px targets.
  - Desktop: the existing matrix table, filtered; names link to open the drawer.
  - Mobile: per-user cards, filtered, tap to open the drawer.
  - Empty state when nothing matches.
- New drawer (in the explorer file or its own): right sheet (like `UserDrawer`).
  Lazy-loads full detail via a server action; shows custom answers grouped by
  scope + every match scoreline (pick or —, points), with inline `AdminPickEditor`
  for each, and a link to the full per-user page. `router.refresh()` + refetch
  after an inline save so the matrix and drawer stay in sync.
- New `bets-overview/actions.ts`: `loadUserBetDetail(userId, locale)` — admin
  gated; returns `fetchUserBetsForAdmin` rows (each with a server-resolved label)
  + `fetchUserMatchPicksForAdmin` rows. Client caches per userId.

### C. Editable player picks (Goal 4)
- `AdminPickEditor.tsx` `CustomAnswerInput`: for `multi_choice` with
  `config.dynamicSource === 'players'`, render `SearchableChoicePicker` fed by
  `usePickerOptions('players', locale)` (lazyChunkSize ~20), instead of the empty
  button grid. Selecting a player calls the existing save path; `validateAnswer`
  already accepts dynamic player values, and `writeCustomPickAdmin` handles the
  rest. Keep the button grid for static (team) multi_choice.
- Add optional `onSaved?: () => void` to `AdminPickEditor` so the drawer can
  refetch after an inline edit.
- Extend the actions' `revalidatePath` to also cover `/admin/bets-overview`.

## Security / safety
- Every new server action re-checks admin (defense in depth on top of the page
  gate) — Next docs warn server functions are reachable by direct POST.
- No new write surface beyond what already exists; `loadUserBetDetail` is
  read-only and admin-gated. Player names are public squad data.
- Reason + lock-bypass audit flow is unchanged (reused via `AdminPickEditor`).

## Mobile checklist (project rule)
- Drawer: full-width sheet, `max-h-[100dvh]`, `pb-[env(safe-area-inset-bottom)]`.
- Toolbar/filters: horizontal snap scroll, 44px targets.
- Matrix table stays desktop-only; mobile uses stacked cards (no h-scroll).
- Verify at 360 / 414 / 768 / 1024 / 1440, RTL Hebrew, landscape.

## Open questions
- None blocking. Player-pick editability scoped to the editor + drawer; no
  bulk edit.
