# Migrate ALL match/fixture data to API-Football

**Date:** 2026-05-27
**Status:** approved, ready to execute
**Owner:** Yoav

## Goal

Consolidate every match/fixture/scorer data fetch in the app onto **one provider** — API-Football (api-sports.io v3) — and retire `api.football-data.org` entirely. Today `football-data` owns fixture sync and is a fallback for top scorers, while API-Football already owns fixture statistics, squads, lineups, events, predictions, standings, injuries, coaches, team statistics, and recent fixtures. The split provider isn't paying off and is actively masking bugs (see `unknownTeams` below).

## Why we are doing this

### 1. The split is already lopsided
- API-Football handles **12 distinct endpoints** in `src/lib/api-football-data.ts` + the auto-grading stat fetch in `src/lib/api-football.ts`.
- `football-data` handles **2 things**: fixture sync (`fetchWorldCupMatches`) and a fallback for top scorers.
- So 13 of 15 data integrations already run on API-Football. Football-data is the outlier holding back consolidation.

### 2. The current sync is silently corrupting team data every run
- The last three sync runs (visible in the admin sync history screenshot) each reported **32 unknown teams** out of ~48 entries. That means football-data's TLA codes don't match `data/team-names.json` for roughly two thirds of the World Cup 2026 teams.
- `sync.ts:140-150` skips the whole fixture when either TLA can't be resolved — so the matches table is missing huge swathes of the tournament data.
- API-Football uses numeric team IDs (not TLAs), and we already have alias-map infrastructure in `scripts/api-football-sync-squads.mjs`. The migration also fixes this team-resolution bug.

### 3. Pro tier features unlock real product surface
- `/fixtures?live=all` — actual live scores for the `/live` page (currently a static "live bets" tab, no actual live scoreboard).
- `/fixtures/events` — minute-by-minute goals/cards/subs for live duels and tournament feed.
- `/players/topscorers` — already prioritised in `getLiveTopScorers`; killing the fallback means one code path, not two.
- Pro tier per `src/lib/api-football.ts:18` = **7,500 req/day, $19/mo** (Yoav confirms active Pro subscription — **incremental cost = $0**).

### 4. Cost honesty
- football-data free tier → $0 → $0 saved (it was free).
- API-Football Pro → already paid → $0 incremental.
- **No new spend.** The plan is pure consolidation.
- ⚠️ **Verify before execute:** I could not load the API-Football pricing page during research (403). Yoav to confirm Pro plan limits in the dashboard before we push the production cron to 6-hour intervals.

## Constraints

- **Backwards-compat for in-flight matches.** The existing `matches.api_fixture_id` column references football-data IDs. Existing rows must stay queryable until the new sync writes API-Football IDs into `api_football_fixture_id` for every row. We do *not* delete `api_fixture_id` in this migration — phase 4 (cleanup) is a separate, later PR.
- **Cron timing must not break.** The Vercel cron runs daily at 06:00 UTC (`vercel.json` `0 6 * * *`); the new sync must be a drop-in replacement so the cron route doesn't need rescheduling on day one.
- **Pre-tournament safety.** Tournament starts 2026-06-11. We have ~15 days. The migration must ship and stabilise before then — *not* during the tournament.
- **Resilient to API outages.** If API-Football returns 5xx or rate-limits, the sync must record the run as failed and leave matches/scores untouched, never overwrite existing data with zeros.
- **No live-traffic regression.** The `/transparency`, `/live`, tournament zone, leaderboard, and bets pages all depend on the matches table. A partial migration that leaves the table empty is a P0.
- **Single source of truth for team IDs.** Don't keep dual-mapping logic across `scripts/api-football-sync-squads.mjs`, `lib/stats.ts:getApiTeamIdByCode`, and the new sync. Promote it to a DB column.

## Requirements

- All World Cup 2026 fixtures (104 matches) sync successfully from API-Football.
- Stages map: group / r32 / r16 / qf / sf / third_place / final.
- Statuses map: scheduled / live / final.
- Half-time scores, full-time scores, penalties flag, kickoff time (UTC), venue all populated.
- Top scorers page uses API-Football exclusively (no football-data fallback path).
- `FOOTBALL_DATA_TOKEN` env var removed from code, `.env.example`, Vercel, and docs.
- Sync history UI continues to work (the `sync_runs` table contract is unchanged).
- Admin "Sync now" button continues to work.
- Daily cron at 06:00 UTC continues to work.
- A team-resolution failure should be a *warning* row in `unknownTeams`, not a silent skip of 32 fixtures.

## Out of scope

- Live mid-match score updates (the `/fixtures?live=all` polling). That's a follow-up PR after we have a stable nightly sync.
- Mid-tournament group-bracket auto-population beyond what `syncTeamGroups()` already does.
- Removing `api_fixture_id` (football-data's column). Leave it in place this migration; drop in a later cleanup once we're confident.
- Migrating any currently-orphaned data (rows with `api_fixture_id` but no `api_football_fixture_id`). They get reconciled by the script in Phase 1.

## Alternatives considered

### A — keep both providers, just fix the team mapping
- **Pros:** Smallest diff. We add a few TLA aliases and the sync stops skipping 32 fixtures.
- **Cons:** Doesn't fix the deeper problem (two providers, two cost centres, two failure modes). Doesn't unlock live scores or events. Still has a code path that depends on football-data being up. Architecturally we'd be patching not consolidating.
- **Verdict:** rejected. Treats symptom, not cause.

### B — full migration, single PR (recommended) ✅
- **Pros:** One reviewable diff. One day of risk window. Clean break.
- **Cons:** Larger blast radius on one merge.
- **Verdict:** chosen. Sized small enough to land in one PR if we phase the DB work behind a flag.

### C — full migration phased across 3 PRs
- **Pros:** Each step independently revertable.
- **Cons:** Three windows of half-migrated state where the sync could be writing to the wrong column / using the wrong source. More chances for inconsistency. With <15 days to tournament, less time-budget-friendly.
- **Verdict:** rejected, but the structure of the phases below mirrors what option C would look like, so we can split it if review feedback demands.

## Approach (option B)

### Phase 0 — schema work (one new migration)
- New Drizzle migration `0020_teams_api_football_team_id.sql`:
  - `ALTER TABLE teams ADD COLUMN api_football_team_id integer UNIQUE;`
  - Backfill is **deferred to the activation script in Phase 1**, not run in the migration itself (so the migration is reversible and the backfill is observable).
- No changes to `matches`, `sync_runs`, or `players`.

### Phase 1 — backfill `api_football_team_id`
- New one-shot script `scripts/api-football-backfill-team-ids.mjs`:
  1. Fetch `/teams?league=1&season=2026` from API-Football.
  2. For each API team, normalise its name and try to resolve to one of our `teams.code` rows using the same logic that already exists in `stats.ts:getApiTeamIdByCode` (lifted into a shared helper at `src/lib/team-resolve.ts` so the new sync and this script share one resolver).
  3. UPDATE `teams.api_football_team_id`.
  4. Print a "unresolved" table at the end so the operator can patch the alias map and re-run.
- After the script finishes, every WC 2026 participant has a non-null `api_football_team_id`. The script is **idempotent and safe to re-run**.

### Phase 2 — new fixture client + sync rewrite

**New file `src/lib/api-football-fixtures.ts`** (deliberately separate from `api-football.ts` and `api-football-data.ts` to keep diffs reviewable):
- `fetchWorldCupFixtures(season: number): Promise<ApiFootballFixtureFull[]>` — calls `/fixtures?league=1&season=<S>`.
- `mapApiFootballStage(round: string): { stage; groupId | null }` — API-Football returns `round` as a string like "Group Stage - 1", "Round of 32", "Round of 16", "Quarter-finals", "Semi-finals", "3rd Place Final", "Final". Parse + map.
- `mapApiFootballStatus(short: string): "scheduled" | "live" | "final"` — maps `TBD`, `NS`, `1H`, `HT`, `2H`, `ET`, `BT`, `P`, `SUSP`, `INT`, `FT`, `AET`, `PEN`, `PST`, `CANC`, `ABD`, `AWD`, `WO`. Unknown → log warn, treat as `scheduled`.
- Returns a `ApiFootballFixtureFull` typed object with: `fixtureId`, `apiHomeTeamId`, `apiAwayTeamId`, `homeName`, `awayName`, `kickoffUtc`, `venue`, `statusShort`, `round`, `groupName`, `score.fullTime.{home,away}`, `score.halfTime.{home,away}`, `wentToPenalties`.
- Same `next: { revalidate: 0 }` / `cache: "no-store"` pattern as the existing football-data fetch (we want fresh data at sync time).
- Retry helper: 3 attempts with 2/4/8s backoff on 5xx and 429; respect `Retry-After` header (capped at 30s like the translate-players script does).
- Per-request log: `console.info("[api-football fixtures]", { endpoint, status, count, durationMs })`.

**`src/lib/sync.ts` rewrite:**
- Replace `fetchWorldCupMatches` import with `fetchWorldCupFixtures`.
- Replace `mapStage`/`mapStatus` imports with the new mappers.
- Replace the `ensureTeam(homeCode, …)` + TLA-based resolution with a **DB lookup** by `api_football_team_id` to resolve to `teams.code`. If the lookup misses, push the (numeric ID + name) to `unknownTeams` and skip — but warn loudly with the API team ID so the operator can patch the backfill.
- Replace `api_fixture_id` UPSERT key with `api_football_fixture_id`. The matches table will now write API-Football IDs going forward; existing rows keyed by `api_fixture_id` get a new `api_football_fixture_id` on their first migration-era refresh.
- Reconciliation safety: the existing `UNIQUE (api_fixture_id)` index stays, but the new INSERT/UPDATE no longer sets `api_fixture_id` for new rows — old rows keep theirs (legacy column), new rows set only `api_football_fixture_id`. Both columns coexist; we drop `api_fixture_id` in a future cleanup PR.

### Phase 3 — top scorers cleanup

- Remove the `football-data` fallback branch from `src/lib/stats.ts:getLiveTopScorers` (lines 62-83).
- `getLiveTopScorers` now always calls `fetchTopScorersApiFootball` and returns whatever it gets (or empty).
- Logging: `console.info("[wc-zone enrichment] top scorers fetched", { count, source: "api-football" })` (the `source: "football-data"` branch is gone).

### Phase 4 — file + env cleanup

- **Delete** `src/lib/football-data.ts`.
- **Delete** `scripts/api-sync-fixtures.mjs` (calls football-data's `fetchMatches`; was the manual one-off before the cron existed; unused now).
- Remove `FOOTBALL_DATA_TOKEN` from `.env.example` and any local `.env.local` reference (we won't touch your `.env.local` — that's your file — but call it out in the PR description so you can delete the row).
- Remove the env var from Vercel project settings — **manual step**, noted in the PR description, not code.
- Update the bilingual copy in `SyncPanel.tsx:52` and the matching i18n string: `"Sync from football-data"` → `"Sync from API-Football"` (English) and the Hebrew is already neutral ("מהאתר הרשמי") so no change there. Same in `sync.ts:809` re-export comment.

### Phase 5 — observability

Per rule 14 (observability from day one), every step ships with namespaced console logs:
- `[api-football fixtures]` — endpoint, status, count, durationMs, retries.
- `[sync fixture upsert]` — { apiFootballFixtureId, homeCode, awayCode, action: "inserted" | "updated", status, stage }.
- `[sync unknown team]` — { apiTeamId, apiTeamName, side: "home" | "away" }. **Required:** the previous sync silently dropped 32 fixtures because this log line didn't exist with enough detail.
- `[sync run summary]` — same shape as the current report, plus a new field `unmappedApiTeamIds: number[]` so we can debug an unknown-team row without reading the DB.
- `[stats top scorers]` — { count, source: "api-football" } (already exists, retained).

## Security

Per rule 13:
- **Secrets:** `API_FOOTBALL_KEY` already lives in Vercel env. The migration doesn't introduce new secret-handling code paths.
- **Cron auth:** the existing `Authorization: Bearer ${CRON_SECRET}` check at `src/app/api/cron/sync/route.ts:7-14` stays unchanged. No new admin or public surface.
- **PII:** none. The data is public-tournament information.
- **Input validation:** API-Football responses are validated via the new typed `parse*` helpers in `api-football-fixtures.ts` (same pattern as `api-football-data.ts`). Untrusted strings (round, status) flow through whitelist mappers before they touch the DB.
- **Log hygiene:** the API key never appears in logs. Endpoints we log are paths (no query string with sensitive params).
- **Fail closed:** API failures abort the sync (existing behaviour) — we never overwrite a successful match record with stale zeros.

## Settings audit

Per rule 15:
- This migration introduces **no new user-facing settings**. The provider is an implementation detail.
- Considered and rejected:
  - "Sync source" dropdown — overkill, single source is the whole point.
  - "Sync interval" admin field — the daily cron is fine; an admin can already trigger ad-hoc syncs from `/admin`.
  - Per-tournament season override — out of scope, hardcoded `2026` matches the current code.

## Test plan

No automated tests exist for sync (the agent confirmed there's no `tests/` or `__tests__/` directory). The test plan is manual + dev-DB:

1. **Pre-flight:**
   - Confirm Pro plan is active in API-Football dashboard.
   - Verify `API_FOOTBALL_KEY` is set in Vercel + local `.env.local`.
   - Snapshot current `matches`, `teams`, `sync_runs` row counts so we have rollback reference.

2. **Phase 0 + 1 (in dev DB):**
   - Run the schema migration. Confirm `teams.api_football_team_id` column exists.
   - Run the backfill script. Confirm every WC 2026 team row has a non-null `api_football_team_id`. Resolve any "unresolved" team aliases by extending `src/lib/team-resolve.ts`.

3. **Phase 2 (dev):**
   - Trigger `/api/cron/sync?secret=…` against dev DB.
   - Confirm `sync_runs` shows ok=true, fetched ≈ 104, unknownTeams = [].
   - Spot-check 5 matches in the DB: kickoff time, stage, status, score (where final), venue, both `api_fixture_id` (legacy NULL is fine for new rows) and `api_football_fixture_id` (must be set).
   - Run a finished-match grading test by manually flipping one match to `final` and confirming `scoreFinalMatches` still settles bets correctly.

4. **Phase 3 (dev):**
   - Visit `/tournament` → Players tab → confirm top scorers render with photos.
   - Visit `/tournament` → Summary tab → confirm top scorers cell.

5. **Production (after dev passes):**
   - Deploy migration via `pnpm db:migrate` to prod.
   - Hit admin "Sync now" to do a manual prod sync.
   - Watch the new sync_runs row — must show `unknownTeams = []` (the smoke test that proves the original 32-unknown bug is fixed).
   - Wait one daily cron cycle (06:00 UTC), confirm the cron run succeeds.

6. **Responsive check (rule 6):**
   - Admin SyncPanel: 360 / 414 / 768 / 1024 / 1440 — already-shipped UI, but confirm no regression from copy changes.
   - Tournament Players tab: 360 / 414 / 768 / 1024 / 1440 — confirm top scorers list renders with photos at every breakpoint.

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| API-Football rate-limit during a sync run | low | sync fails, retried next cron | exponential backoff + Retry-After cap; sync failure is recorded but doesn't poison the matches table |
| Team alias gap (a country with a name we don't expect) | medium | one team's matches skipped, logged with full ID/name | backfill script prints unresolved list before the new sync ever runs; alias map is one edit + re-run |
| API-Football changes their `round` strings between now and tournament start | low | stage mapper falls back to "group" | warn log on any unseen round value; we monitor via the `sync_runs.error_message` field |
| Vercel cron auth misconfigured after env change | low | cron silently 401s | the cron returns 401 visibly; no env change is needed for `CRON_SECRET` — only `FOOTBALL_DATA_TOKEN` is removed |
| Pro plan limits lower than the documented 7,500/day | low | hit quota during heavy match-day polling | this PR is just a daily nightly sync, ~1 request/sync; the live-polling follow-up will size for real load |
| Roll-back needed | low | revert the PR | migration 0020 is `ADD COLUMN`, which is safe to leave in place even on revert; the column is just unused |

## Open questions

None. Yoav has clarified: "yes, move all responsibility to it for everything."

## Execution checklist (the actual diff)

When implementing, the work to do, in order:

1. ☐ `src/db/schema.ts` — add `apiFootballTeamId: integer("api_football_team_id").unique()` to teams table.
2. ☐ `src/db/migrations/0020_teams_api_football_team_id.sql` — generated by `pnpm db:generate`.
3. ☐ `src/lib/team-resolve.ts` (new) — extract `getApiTeamIdByCode`'s normalisation + alias logic into a shared helper, with both `resolveApiTeamIdForCode(code)` and `resolveCodeForApiTeamId(apiId)` exports.
4. ☐ Refactor `src/lib/stats.ts:getApiTeamIdByCode` to call the new helper.
5. ☐ `scripts/api-football-backfill-team-ids.mjs` (new) — one-shot to populate the new column.
6. ☐ `src/lib/api-football-fixtures.ts` (new) — fetch + mappers + retry helper.
7. ☐ `src/lib/sync.ts` — rewrite `_runSync` to use the new client + DB-based team resolution; replace `ensureTeam` to no longer rely on TLAs.
8. ☐ `src/lib/stats.ts:getLiveTopScorers` — drop the football-data fallback branch.
9. ☐ `src/lib/football-data.ts` — delete.
10. ☐ `scripts/api-sync-fixtures.mjs` — delete.
11. ☐ `.env.example` — remove `FOOTBALL_DATA_TOKEN` row.
12. ☐ `src/app/[lang]/admin/SyncPanel.tsx:52` — English copy "Sync from football-data" → "Sync from API-Football". Hebrew unchanged.
13. ☐ Run the backfill script against dev DB; verify; merge alias additions back.
14. ☐ Trigger admin sync in dev; verify; manual QA per Test plan above.
15. ☐ Open PR with this plan linked in the body.
16. ☐ Merge → run prod migration → trigger prod admin sync once → confirm next-day cron.
17. ☐ Manual step (not in code): delete `FOOTBALL_DATA_TOKEN` from Vercel env after a clean cron run.

## Files touched (summary)

**New:**
- `src/lib/api-football-fixtures.ts`
- `src/lib/team-resolve.ts`
- `src/db/migrations/0020_teams_api_football_team_id.sql`
- `scripts/api-football-backfill-team-ids.mjs`

**Modified:**
- `src/db/schema.ts`
- `src/lib/sync.ts`
- `src/lib/stats.ts`
- `src/app/[lang]/admin/SyncPanel.tsx`
- `.env.example`

**Deleted:**
- `src/lib/football-data.ts`
- `scripts/api-sync-fixtures.mjs`

**Net:** +4, -2, 5 modified.
