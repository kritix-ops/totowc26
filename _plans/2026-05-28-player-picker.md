# Player picker for tournament bets

**Date:** 2026-05-28
**Owner:** /loop initiated 2026-05-28 by user
**Status:** approved, ready to execute

## 1. Goal

Let users pick a single player out of the full 1,357-player DB on tournament-scope bets (top scorer, golden ball, best young player, ...). The picker must:

1. Surface global superstars (Messi, Ronaldo, Mbappé, Haaland, Bellingham, ...) first.
2. Then players from the strongest national teams (Brazil, Argentina, France, England, Spain, ...).
3. Then everyone else, alphabetically by display name.
4. Show 10 names by default with a "Load more" button (+10 each click) so the initial view is short.
5. Smart search across all 1,357 players — typing in English or Hebrew matches `name_en`, `name_he`, team name, jersey number.
6. Mobile-first: full-width sheet on small screens, popover on `md+`, 48px+ row height, 16px input font.

## 2. Constraints

1. Don't bloat each bet's `answer_config` JSONB with 1,357 options. Bets store *a reference to a dynamic source*, the picker hydrates options at view time.
2. Don't render 1,357 DOM nodes on first open. Use `lazyChunkSize` to render the first N and reveal more on demand; rely on `next/image` lazy-loading so the long tail of player photos never hits the network unless surfaced.
3. Reuse `SearchableChoicePicker` — don't duplicate its sheet/popover/keyboard infra.
4. Hebrew and English must both find Messi: search matches `name_he`, `name_en`, and the team names in both locales.
5. `name_he` may be null for ~5 fringe rows (translation pipeline never produced anything). Fall back to `name_en` in `labelHe`.

## 3. Approach

### 3.1 Data layer

- New `loadPlayersForPicker(locale)` in `src/db/queries.ts`. Returns the full list shaped as `SearchableOption[]`:
  - `value` = `api_football_id` as string (stable identifier for grading later).
  - `labelHe` / `labelEn` = `name_he` (or `name_en` fallback) / `name_en`.
  - `groupHe` / `groupEn` = team name in each locale.
  - `subtitleHe` / `subtitleEn` = formatted as `#10 · חלוץ` / `#10 · Forward`. Drop the `#N · ` segment if jersey/position is null.
  - `icon` = `teams.flag` (emoji).
- Sort server-side, single query with `left join teams ... order by ...`. The order key is computed in a CTE / case-when:
  1. `star_rank` (0 for hardcoded stars, 999 otherwise).
  2. `team_rank` (curated 1..48).
  3. Display name ascending (Hebrew when locale = he, English when en).

### 3.2 Curation

New file `src/lib/players/curation.ts`:

```ts
export const STAR_PLAYER_API_IDS: ReadonlyMap<number, number> = new Map([
  [154, 0],    // Lionel Messi (Argentina) — placeholder ids, will be verified
  [...],       // ~25-30 globally-recognised players, ranked
]);

export const TEAM_RANK: ReadonlyMap<string, number> = new Map([
  ["BRA", 1],  ["ARG", 2],  ["FRA", 3],  ["ENG", 4],  ["ESP", 5],
  ["GER", 6],  ["POR", 7],  ["NED", 8],  ["BEL", 9],  ["CRO", 10],
  // ... all 48 teams
]);
```

`STAR_PLAYER_API_IDS` is hardcoded with `api_football_id` (stable across squad re-syncs). Star values are also ranked 0..N so we can break ties between two stars (Messi above any other Argentine).

`TEAM_RANK` is a pragmatic ordering: WC contenders first, then traditional powers, then qualifying-tournament strength. Easy to edit later.

### 3.3 API route

New `src/app/api/picker-options/players/route.ts`:

- `GET /api/picker-options/players?locale=he|en`.
- Returns `{ options: SearchableOption[] }`.
- `Cache-Control: public, s-maxage=300, stale-while-revalidate=900`. Player roster + translations change rarely.
- No auth required — player names are public info.
- Logging: `[picker-options players] locale=he count=1357 ms=N`.

### 3.4 Type-system bridge

`src/lib/bets/types.ts` — extend `MultiChoiceConfig`:

```ts
export type MultiChoiceConfig = {
  kind: "multi_choice";
  options: MultiChoiceOption[];
  dynamicSource?: "players";  // new optional field
};
```

When `dynamicSource === "players"`, `options` should be empty at storage time. The picker hydrates from the API.

### 3.5 SearchableChoicePicker extension

Add a `lazyChunkSize?: number` prop. Behavior:

- When unset (default): existing behavior — render all filtered options.
- When set:
  - If `query === ""`: render first `chunkSize` × `loadedChunks` options, plus a "Load more" pill at the bottom that increments `loadedChunks`.
  - If `query !== ""`: render all filtered matches. Search bypasses chunking.
- "Load more" pill copy: `טען עוד 10` / `Load more`. Disappears once `loadedChunks * chunkSize >= filtered.length`.
- Reset `loadedChunks` to 1 every time the picker re-opens.

### 3.6 CustomBetCard hook-up

`src/components/CustomBetCard.tsx`:

- When `cfg.kind === "multi_choice"` and `cfg.dynamicSource === "players"`:
  - On mount (after picker is opened), call `usePickerOptions("players", locale)` — a new client hook in `src/lib/picker-options/client.ts` that wraps `fetch` with `SWR`-ish behavior (in-memory cache keyed by `${source}:${locale}`, dedupes concurrent fetches).
  - While loading, render a skeleton row inside the picker trigger (`טוען רשימה…` / `Loading…`).
  - Pass hydrated options + `lazyChunkSize={10}` to `SearchableChoicePicker`.

### 3.7 Admin tournament-bet template wiring

`src/app/[lang]/admin/tournament-suggestions/page.tsx` already loads players. Update templates so:

- "Top scorer", "Golden ball", "Best young player", "Golden glove" → answer_config = `{ kind: "multi_choice", dynamicSource: "players", options: [] }`.

No DB migration needed — `answer_config` is JSONB.

## 4. Alternatives considered

1. **Stuff all 1,357 options into `answer_config`.** Rejected — every bet card payload becomes ~100 KB. Multiple tournament bets on one page = ~500 KB initial HTML.
2. **Virtualization (react-window) instead of "Load more".** Rejected per user's explicit request. Virtualization has slightly better discoverability ("just scroll") but the user prefers explicit pagination.
3. **Server-side search with debounced fetch on every keystroke.** Rejected — single full fetch + client-side filter is simpler, instant, and 1,357 players × ~150 bytes/row = ~200 KB once (with `Cache-Control` it's free after the first hit).
4. **A separate `<PlayerPicker>` component.** Rejected — `SearchableChoicePicker` is 95% of the way there; extending it with `lazyChunkSize` is 50 lines.

## 5. Security & safety (rule 13)

1. API route is unauthenticated GET. Data is non-sensitive (public player names from API-Football).
2. Locale param is whitelisted to `he | en`. Any other value → 400.
3. No user-controlled inputs reach the DB query (locale is the only param and it's an enum check).
4. Response payload is bounded (~200 KB). No risk of unbounded fetches.

## 6. Observability (rule 14)

- `[picker-options players] locale=he count=1357 cache=miss ms=42` on every request (cache=hit when served from in-memory).
- `[bet picker hydrate] source=players locale=he ms=12 from=network|memory` on the client when the picker opens.
- `[bet picker load-more] from=10 to=20 visible=20` when user clicks the pill.
- `[bet picker search] q="messi" matches=3` when query is non-empty.

## 7. Settings audit (rule 15)

- `lazyChunkSize` is a code constant (10). Not user-controllable; not enough demand to expose it.
- The star list and team ranking live in code (`src/lib/players/curation.ts`) — easy for me to edit when next year's tournament reshuffles the favourites.
- No new Settings entries needed.

## 8. Cost analysis (rule 8)

- No external paid services. API-Football already paid for. Supabase egress is the only meaningful axis: ~200 KB per cold load × ~50 daily users × 30 days ≈ 300 MB/month. Free tier limit on Supabase is well above this.
- No LLM calls at runtime — translation already done.

## 9. QA gates

1. `/he/bets` → open a tournament bet with player picker → top of list is Messi, Ronaldo, Mbappé (or whichever stars are in our list).
2. Type `messi` → only Messi visible (+ any other "Messi"-named players).
3. Type `מסי` → same result.
4. Click "Load more" → 20 names visible, then 30, etc.
5. At 360px width: picker opens as full-screen sheet, all touch targets ≥ 44px, no horizontal scroll.
6. Locale switch `/he/` → `/en/`: same picker, English labels, English team groups, no leftover Hebrew.
7. Pick a player → close picker → bet card shows the chosen Hebrew/English name + jersey + position. Submit → record persists `value = api_football_id` as string.
