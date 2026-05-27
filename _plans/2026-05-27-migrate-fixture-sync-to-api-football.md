# Migrate fixture sync from football-data.org → API-Football

**Date:** 2026-05-27
**Owner:** Yoav
**Status:** Draft, awaiting approval

## TL;DR

Today the daily sync at `/api/cron/sync` pulls fixtures from
`api.football-data.org` (free tier, `FOOTBALL_DATA_TOKEN`). Statistics
for auto-grading already come from API-Football (`API_FOOTBALL_KEY`,
Pro $19/mo). The user has a Pro subscription. We will move **all
match/scorer data** to API-Football as the primary provider with a
DB-backed team-id mapping so the recurring "32 unknown teams" bug
stops dropping rows. football-data is kept on disk as a **degraded-
mode fallback** — when API-Football fails or `API_FOOTBALL_KEY` is
missing, the sync transparently falls back to the old TLA-based
flow so the tournament never goes silent during an outage.

## Goals

1. Single data provider for all World Cup fixture, score, status,
   stage, scorer, and statistic data.
2. Eliminate the silent name-based team mapping that is currently
   marking 32 teams as `unknown` on every cron fire and causing 32
   matches to be skipped each run.
3. No regression in admin UX: the sync panel still works, history
   stays interpretable, manual "Sync now" still works.
4. No regression in tournament-zone enrichment (top scorers, etc.).
5. Same cron schedule (06:00 UTC daily) unless we choose to tighten
   it now that we have a real rate budget.

## Constraints

- We must not lose existing data in `matches` or `sync_runs`.
- The cron endpoint signature and auth (`Bearer ${CRON_SECRET}`) must
  not change — it is wired to Vercel cron in `vercel.json`.
- `matches.api_fixture_id` (the football-data integer ID) is a
  populated column with a unique constraint and is the current
  upsert key. We need a deterministic switch-over strategy.
- The tournament starts 2026-06-11. We have ~2 weeks. Migration
  must ship and bake on staging before the first real match.
- Hebrew team names + flags must remain stable — `data/team-names.json`
  is the source of truth for display.

## Requirements

- All current callers of `fetchWorldCupMatches` and `fetchTopScorers`
  keep working through their existing signatures (the wrappers in
  `src/lib/stats.ts` and `src/lib/sync.ts`).
- `getLiveTopScorers` in `src/lib/stats.ts` keeps the same return shape
  for `PlayersTab.tsx` and `SummaryTab.tsx`.
- Team-name resolution is **DB-backed**, not code-string-matching.
  Add `teams.api_football_team_id` (nullable integer, unique-where-not-null)
  so the cron looks up by primary key, not by fuzzy name.
- The sync panel's "unknown teams" warning becomes useful again:
  it lists teams where the API returned a `team.id` we have not yet
  mapped, not teams where two strings did not match.
- Per CLAUDE.md rule 14 (observability): every step of the new pipeline
  emits a namespaced `console.info` with the actual values
  (`[sync fixtures fetch]`, `[sync team-map miss]`, `[sync upsert]`, etc).

## Cost

- API-Football Pro: $19/mo, **7,500 requests/day**, ~450 req/min burst.
  User already pays this. Incremental cost = **$0**.
- football-data.org: free tier we are removing. **$0** saved.
- Sizing: the new sync makes 3 calls per fire (`/standings`,
  `/fixtures?league=1&season=2026`, `/players/topscorers`) plus
  ~5–10 `/fixtures/statistics` calls for newly-final matches. A
  daily cron at 06:00 UTC = ~20 req/day. Even at 4× a day (every 6h)
  we are 0.5% of the daily budget. Plenty of headroom to tighten
  the schedule later.
- Verification needed (CLAUDE.md rule 8): I could not fetch
  api-football.com/pricing directly (403). Pro tier numbers above
  come from the existing `_plans/2026-05-27-api-football-activation-checklist.md`
  and the `src/lib/api-football.ts` header comment. **Action item:**
  user to confirm Pro tier is still 7500 req/day and the dashboard
  shows current usage well under cap before we ship.

## Approach: 4 PRs, smallest blast radius first

### PR 1 — Schema + team-id mapping (no behaviour change)

Add the column and backfill it. Sync still uses football-data after
this PR — pure prep work.

- New migration `0020_teams_api_football_team_id.sql`:
  ```sql
  alter table public.teams
    add column api_football_team_id integer;
  create unique index teams_api_football_team_id_uq
    on public.teams (api_football_team_id)
    where api_football_team_id is not null;
  ```
- New script `scripts/api-football-map-teams.mjs`:
  - Hit `/teams?league=1&season=2026`, get all WC team ids + names.
  - For each row, resolve to our `teams.code` using:
    1. `teams.name_en` exact match (case-insensitive, normalised)
    2. Alias map (port from `src/lib/stats.ts:481-489`, extended)
    3. Print `UNRESOLVED:` lines for the operator to patch.
  - Write `api_football_team_id` for each resolved team.
- Add a new section to the admin sync panel showing `N teams missing
  api_football_team_id` so the operator knows when prep is incomplete.
  (Pure read query, no new server action.)

### PR 2 — Fixtures via API-Football (the substantive change)

- Extend `src/lib/api-football.ts` (NOT `api-football-data.ts` — that
  file caches at 1h+ and we want `no-store` for cron) with:
  ```ts
  export type ApiFootballMatch = {
    fixtureId: number;
    kickoffAt: string;
    statusShort: string;           // NS / 1H / HT / 2H / ET / BT / P / FT / AET / PEN / PST / CANC / SUSP / ABD / AWD / WO
    elapsed: number | null;
    homeTeamApiId: number;
    homeTeamName: string;
    awayTeamApiId: number;
    awayTeamName: string;
    homeScoreFt: number | null;
    awayScoreFt: number | null;
    homeScoreHt: number | null;
    awayScoreHt: number | null;
    homeScorePen: number | null;
    awayScorePen: number | null;
    venue: string | null;
    round: string;                 // "Group Stage - 1" / "Round of 32" / etc.
  };

  export async function fetchWorldCupFixtures(season: number): Promise<ApiFootballMatch[]>;

  // Pulled separately because /fixtures does not carry group letters.
  // Returns a Map<apiTeamId, "A".."L"> so the caller can tag group-stage
  // matches.
  export async function fetchWorldCupGroupMap(season: number): Promise<Map<number, string>>;

  export function mapApiFootballStatus(short: string): "scheduled" | "live" | "final";
  export function mapApiFootballRound(round: string, groupLetter: string | null): {
    stage: "group" | "r32" | "r16" | "qf" | "sf" | "third_place" | "final";
    groupId: string | null;
  };
  ```
- Status mapping:
  - `NS`, `TBD`, `PST` → `scheduled`
  - `1H`, `HT`, `2H`, `ET`, `BT`, `P`, `LIVE` → `live`
  - `FT`, `AET`, `PEN`, `AWD`, `WO` → `final`
  - `CANC`, `ABD`, `SUSP`, `INT` → keep current status (do not flip a
    finalised match to scheduled if the upstream marks it abandoned
    after the fact). Emit `[sync status anomaly]` log.
- Round → stage mapping:
  - `/^Group Stage/` → `group` (group letter pulled from standings map)
  - `/^Round of 32/` → `r32`
  - `/^Round of 16/` → `r16`
  - `/^Quarter-finals/` → `qf`
  - `/^Semi-finals/` → `sf`
  - `/^3rd Place Final/` or `/Third Place/` → `third_place`
  - `^Final$` → `final`
  - Anything else → log `[sync round unknown]` and skip the row.
- Rewrite `_runSync` in `src/lib/sync.ts` with **provider preference
  + transparent fallback**:
  ```
  if API_FOOTBALL_KEY is set:
    try API-Football path
    on success → return report tagged provider="api-football"
    on failure (catch / 4xx / 5xx / empty response) →
      log [sync provider fallback] and continue to football-data path
  football-data path (current behaviour, TLA-based):
    fetchWorldCupMatches → ensureTeam → upsert by api_fixture_id
    return report tagged provider="football-data"
  ```
- API-Football path:
  - Fetch standings (group map) + fixtures in parallel.
  - For each fixture, resolve team via
    `select code from teams where api_football_team_id = ?`. On miss,
    push `{ teamApiId, name }` into `unknownTeams` and skip.
  - Upsert using `api_football_fixture_id` as the conflict key.
    Existing `api_fixture_id` column is left in place but no longer
    written by this path.
  - `wentToPenalties = statusShort === "PEN"`.
- New `sync_runs.provider` column (text, default `"api-football"`)
  added in PR 1 so the admin history shows which provider each row
  used. Old rows backfilled to `"football-data"`.
- Adjust the sync-panel "Unknown teams" copy: existing text is
  generic; nothing to change in the UI, only the underlying source
  of the list.

### PR 3 — Top scorers cleanup (NO file deletion)

`getLiveTopScorers` already has a clean fallback shape — leave it
intact. The only change: make API-Football the explicit default
and keep football-data as the secondary branch.

- `src/lib/stats.ts:44-84` (`getLiveTopScorers`) — small refactor to
  make the "tried API-Football first, fell back to football-data"
  log line easier to spot in production (`[scorers provider]
  { used: 'api-football' | 'football-data', count }`). No
  behaviour change.
- `src/lib/football-data.ts` — **kept on disk** as the degraded-mode
  fallback for sync + scorers. Not deleted.
- `scripts/api-sync-fixtures.mjs` — kept (CLI offline backfill from
  football-data; useful if API-Football is down and an operator
  needs a manual pull).
- `FOOTBALL_DATA_TOKEN` — **kept** in `.env.example` with a comment
  noting it is the fallback provider.
- `mapStage` / `mapStatus` from `football-data.ts` — kept; used by
  the fallback path in `_runSync`.
- The `matches.api_fixture_id` column **stays permanently**
  (per user decision 2026-05-27 — historical data + needed for the
  football-data fallback to keep upserting).

### PR 4 — Observability polish + admin-side confidence

- New row in the sync panel: "Source: API-Football" / "Source:
  football-data" badge per sync-run row (driven by the new
  `sync_runs.provider` column from PR 1), plus a small
  "Last team-mapping run" timestamp pulled from a new
  `settings.team_mapping_last_run` row.
- Show `unknownTeams` from the latest run as actionable: each entry
  becomes a chip with a "Map manually" button that opens a tiny
  admin form (`teams.code` selector → `api_football_team_id` input).
  Saves one round of operator-side script invocation.
- **API-Football quota card** (answers user request: "I want to see
  in admin how much of the quota I've used at any given moment"):
  - Every API-Football call captures the response headers
    `x-ratelimit-requests-limit`, `x-ratelimit-requests-remaining`,
    `x-ratelimit-requests-reset`, and stores the latest values in a
    `settings.api_football_quota` JSONB column updated each call.
  - Admin sync panel renders a card under the history with:
    `Used today: 47 / 7,500 · Remaining: 7,453 · Resets in 14h 12m`
    plus a thin progress bar. Tone shifts to warning at >80%, error
    at >95%.
  - Card has a "Refresh" pill that hits `/status` on API-Football
    (one extra call) for a fresh number without waiting for the
    next sync.
- Per-step logs in `_runSync`:
  - `[sync provider]` { used: "api-football" | "football-data" }
  - `[sync provider fallback]` { from, to, reason }
  - `[sync fixtures fetch]` { count, durationMs }
  - `[sync standings fetch]` { teamsInGroups, durationMs }
  - `[sync team-map miss]` { teamApiId, name }
  - `[sync upsert]` { fixtureId, action: "inserted" | "updated" }
  - `[sync skip]` { fixtureId, reason }
  - `[api-football quota]` { used, remaining, limit, resetIn }

## Alternatives considered and rejected

### Keep football-data, just fix the TLA mapping

Pros: zero-risk, no new dependency on a paid service for fixtures.
Cons: doesn't address the architectural smell of two providers for
the same domain; doesn't unlock API-Football's richer per-match data
(events, lineups) that we want for the `/live` and `/duels` pages;
the user is already paying for Pro and not using its fixture endpoint.
**Rejected** — the user explicitly asked to consolidate.

### Add an abstraction layer (`MatchProvider` interface)

Pros: future-proof if we ever swap providers again.
Cons: YAGNI. We are migrating away from the only competitor we ever
had. Per CLAUDE.md "don't add abstractions beyond what the task
requires," ship the direct integration.
**Rejected**.

### Code-only team mapping (extend the alias table in `stats.ts`)

Pros: no schema migration.
Cons: every operator-side correction is a code change → PR → deploy.
DB column is one migration and forever cheap. Operator UI in PR 4
becomes trivial once the column exists.
**Rejected**.

### Big-bang single PR

Pros: less commit overhead.
Cons: cannot revert just the fixture switch without also reverting
the schema change. PR 1 alone is a safe deploy and unlocks the
operator to spot-check the mapping before PR 2 flips behaviour.
**Rejected**.

## Security (CLAUDE.md rule 13)

- **Secret handling:** `API_FOOTBALL_KEY` already lives in Vercel
  env. No new secrets. No `FOOTBALL_DATA_TOKEN` after PR 3 — remove
  it from Vercel manually after deploy to avoid stale credentials.
- **Auth surface:** the cron route `/api/cron/sync` still requires
  `Bearer ${CRON_SECRET}`. Admin server action `runSyncNow` still
  checks `profiles.role === 'admin'`. No change.
- **Input validation:** API-Football responses are external input.
  Every numeric field (`fixture.id`, `team.id`, scores, elapsed) is
  validated as `Number.isFinite(...)` before being written to the
  DB. Strings (`venue`, names) are accepted as-is — they are stored,
  not eval'd, and the column types are `text`. No SQL injection
  surface because we use Drizzle's parameterised queries throughout.
- **Failure mode:** if API-Football returns 4xx/5xx, the sync row
  in `sync_runs` is marked `ok: false` with the error, no partial
  writes leak into `matches` (each upsert is its own statement,
  not wrapped in a single TX — same as today; acceptable since
  upserts are idempotent).
- **Rate-limit DoS:** Pro is 450 req/min. A worst-case malicious
  admin spamming the "Sync now" button still hits ~3 requests per
  click (standings + fixtures + scorers). Acceptable.
- **PII / logging:** no PII flows through this pipeline. Player
  names are public sports data.

## Observability (CLAUDE.md rule 14)

Already covered above in PR 2 + PR 4. Concrete log inventory:

| Step                                    | Log line                            | Includes                         |
| --------------------------------------- | ----------------------------------- | -------------------------------- |
| Sync starts                             | `[sync started]`                    | source, runId, season            |
| Fetch fixtures                          | `[sync fixtures fetch]`             | count, durationMs                |
| Fetch standings (group map)             | `[sync standings fetch]`            | teamsInGroups, durationMs        |
| Team-id miss                            | `[sync team-map miss]`              | teamApiId, name                  |
| Fixture upsert                          | `[sync upsert]`                     | fixtureId, action                |
| Fixture skipped                         | `[sync skip]`                       | fixtureId, reason                |
| Status anomaly (e.g. ABD on final)      | `[sync status anomaly]`             | fixtureId, before, after         |
| Sync finished                           | `[sync finished]`                   | report                           |

Every log uses `console.info` for normal flow, `console.warn` for
anomalies, `console.error` for thrown errors. All tagged with
`[sync …]` so the operator can filter in Vercel logs.

## Settings audit (CLAUDE.md rule 15)

New user-facing knobs introduced by this migration: **none**. The
schedule (06:00 UTC) is a developer setting in `vercel.json`, not a
runtime one — and exposing cron frequency to an admin UI would
require a per-instance scheduler we do not have. Intentionally not
exposing.

Existing admin "Sync now" button → unchanged.

Existing scoring config (in `settings`) → unchanged.

## Decisions locked in (2026-05-27)

1. **Cron frequency.** Stay daily at 06:00 UTC until **2026-06-11**;
   on that date flip to every-4h (`0 */4 * * *`). A scheduled
   routine is set up to perform the flip automatically so the user
   does not have to remember.
2. **Pre-migration team mapping.** Will run
   `scripts/api-football-map-teams.mjs` against the live DB after
   PR 1 lands and surface the unresolved list to the user before
   PR 2 deploys.
3. **football-data fallback.** Kept. `football-data.ts`,
   `FOOTBALL_DATA_TOKEN`, and `scripts/api-sync-fixtures.mjs` all
   stay on disk. `_runSync` uses API-Football as primary and falls
   back transparently.
4. **API-Football usage visibility.** Added a quota card to PR 4
   (above) showing `Used today / 7,500 · Remaining · Resets in N`,
   sourced from response headers + `/status`.
5. **`matches.api_fixture_id` lifecycle.** Permanent. Stays even
   after API-Football is the primary provider — needed for
   historical data and for the fallback to keep upserting.

## Open questions

None blocking PR 1. All five original questions answered above.

## Rollback

- PR 1 (schema): reversible — `drop column api_football_team_id`,
  `drop column provider`.
- PR 2 (sync switch): revert the PR; the football-data fallback path
  is already in `_runSync` and `football-data.ts` is permanent on
  disk, so reverting cleanly drops back to the old behaviour.
- PR 3 (cleanup): pure refactor, no file deletions. Trivial revert.
- PR 4 (polish): low-risk, purely additive UI + JSONB column.

## Definition of done

- [ ] PR 1 merged + migration applied + team mapping run + 0 teams
      unmapped on the dashboard.
- [ ] PR 2 merged + one cron fire on staging shows
      `fetched=104, inserted=0, updated=104, skipped=0,
      unknownTeams=[], provider="api-football"`.
- [ ] One forced-fail test on staging (rename `API_FOOTBALL_KEY`)
      shows the run completes with `provider="football-data"` and
      `ok=true` — the fallback actually works.
- [ ] At least one real World Cup match goes from scheduled → live
      → final on the new pipeline and a `match_bets` row gets
      auto-scored.
- [ ] PR 3 merged. Scorers log line shows `[scorers provider]
      { used: "api-football" }` on a normal fire.
- [ ] PR 4 merged. Sync panel shows the provider badge per row, the
      unknownTeams chips work, and the quota card shows live
      "Used today: N / 7,500" numbers.
- [ ] `_plans/2026-05-27-api-football-activation-checklist.md`
      updated or marked superseded.
