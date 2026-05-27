# PR 2 + PR 3 — World Cup zone deep enrichment

Pre-approved by user. Shipped as a single combined commit because the
two PRs share helpers (apiNameToLocalTla, getApiTeamIdByCode) and the
match page consumes both PR 2 enrichment and PR 3 predictions.

## Goal

Take "אזור המונדיאל", the team page and the match page from "lists +
tables" to "TV-broadcast level", using the rich API-Football payloads
the activation unlocks.

## What ships

### Team page (`/[lang]/teams/[code]`)
- **Head coach card** — photo, name, nationality, age, start year.
- **Season stats card** — clean sheets, failed-to-score, goals avg, form string.
- **Squad grid** — bucketed by position (GK / DEF / MID / ATT) with
  jersey number, photo (`unoptimized` for API-Sports CDN), age.
- **Team-specific injuries section** — subset of the tournament-wide
  feed filtered by team name + alias.

### Match page (`/[lang]/match/[matchId]`)
- **AI suggestion card** (PR 3) — pre-match only. Win probabilities as
  horizontal bars + suggested score + advice text. Disclaimer: never
  feeds scoring.
- **Match events timeline** — minute-stamped, home/away tinted,
  Goal/Card/Sub icons.
- **Lineups** — formation + starting XI per team with collapsible subs.
- **Player ratings 0-10** — sorted highest-first per team, with
  goal/yellow/red glyphs and captain badge.

### Live page (`/[lang]/live`)
- Inline **events strip** under each live match: most recent 5 goals +
  cards with minute, scorer, team. Only fetched for matches in `live`
  status (cache 30s) to keep API budget tame.

### Tournament page
- **New "Players" tab** — three-column layout: top scorers, top
  assists, top yellow cards. Each row: rank, photo, name, flag, team,
  primary value, optional secondary value (assists, goals, reds).

## Helpers added

### `src/lib/api-football-data.ts`
- `fetchHeadCoach(apiTeamId)` — 24h cache.
- `fetchMatchDetails(fixtureId, liveMode)` — `liveMode=true` → 30s
  cache, else 12h. Embedded events/lineups/statistics/players parsed.
- `fetchPrediction(fixtureId)` — 1h cache. Percent strings coerced.

### `src/lib/stats.ts`
- `getApiTeamIdByCode(code)` — resolves our TLA → API-Football team id
  via name match + inverse alias table.
- `getTeamSquad / getTeamCoach / getTeamStats / getTeamRecentFixtures / getTeamInjuries`
  — all key off the TLA, fail gracefully to null.
- `getMatchEnrichment(matchId, liveMode?)` — lookup
  `api_football_fixture_id` → fetch rich match details. Auto-picks
  live mode when the match is in `live` status.
- `getMatchPrediction(matchId)` — same lookup pattern.

## Caching budget

| Surface | Endpoint | Revalidate | Worst-case calls/day |
| --- | --- | --- | --- |
| Team page (squad) | `/players/squads?team=X` | 24h | ~48 |
| Team page (coach) | `/coachs?team=X` | 24h | ~48 |
| Team page (stats) | `/teams/statistics?team=X` | 1h | ~50 |
| Match page (details) | `/fixtures?id=X` | 12h finished, 30s live | ~120 |
| Match page (prediction) | `/predictions?fixture=X` | 1h | ~70 |
| Live page (per-live-match) | `/fixtures?id=X` (live=30s) | 30s | ~480 (4 hr peak window) |
| Players tab | reuses existing top-X wrappers | 1h | 0 (shared) |

**Total estimated daily worst-case: ~820 calls** out of 7500. ~11% of
budget. Live-page contribution dominates; everything else is rounding.

## Empty-state policy

Every new helper returns `null` cleanly on:
- `API_FOOTBALL_KEY` unset
- Team not found in API
- 4xx/5xx
- `api_football_fixture_id` not yet mapped

Each UI consumer short-circuits with `&&` checks rather than a heavy
"unavailable" banner. Banners only appear for non-empty positive cases
(e.g. the injuries banner is hidden when the array is empty).

## Observability

New `[wc-zone team]` and `[wc-zone match]` namespaces in console logs.
Each helper logs `code/matchId + fixtureId + count` on success, the
underlying wrapper logs `[api-football stubbed]` or `[api-football
error]` on failure.

## Mobile

- Squad grid: 2 cols under sm, 3 under sm+. Card height min-h-[64px].
- Lineups: 1 col under sm, 2 cols sm+. Subs in a `<details>` so the
  card stays compact on phones.
- Player ratings: 1 col under sm, 2 cols sm+. Top 11 per team only,
  rest accessible via scroll.
- Live events strip: vertical list, 11px minute label so it never
  wraps at 360px.
- Prediction card: 3-column probability grid on all viewports — labels
  truncate per team-name length.

## Security

- All fetches server-side (`"server-only"` import).
- API key never crosses the bundle boundary.
- No new mutations, no new user input. Read-only enrichment.
- Image sources from `media.api-sports.io`. We use `unoptimized` so
  `next/image` doesn't proxy — keeps the source URL list out of
  `next.config.ts` and stops API-Sports from billing per-image hits
  back through Vercel's image optimization.

## Out of scope

- Photo CDN allow-list in `next.config.ts` — defer until we want
  `next/image` optimization for player photos (currently `unoptimized`).
- Live odds — wrapper exists in `src/lib/odds.ts` (PR 2 from the other
  session) but we don't surface it here. The AI suggestion card covers
  the pre-match decision-support need for v1.
- Push notifications on goals — separate feature.
