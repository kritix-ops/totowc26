# API-Football activation checklist

When the World Cup is close enough that we want auto-graded "advanced
stat" bets (corners, shots, possession, cards, etc.) and auto-settled
duels, follow this checklist. Until then, the entire pipeline is
env-gated to `null` and falls back to manual grading — there is no
runtime cost for leaving it stubbed.

## Status as of 2026-05-27

- Subscription chosen: **API-Football Pro** ($19/mo, 7500 req/day).
- Code path: fully wired but stubbed. Every wrapper returns `null` when
  `API_FOOTBALL_KEY` is unset and emits a `[api-football stubbed]`
  warn so we can find any call site from logs.
- Schema column ready: `matches.api_football_fixture_id` (nullable,
  migration `0013_matches_api_football_fixture_id`). All rows are
  currently `null` and the auto-grader treats that as `not_ready`.
- Cron wired: `vercel.json` fires `/api/cron/sync` daily at 06:00 UTC
  (= 09:00 Asia/Jerusalem in summer). Auth header is
  `Bearer ${CRON_SECRET}`.
- Sync pipeline calls (in order, every fire):
  1. `syncFixtures(2026)` — pull football-data scores + status flips.
  2. `scoreFinalMatches()` — grade 1/X/2 picks for newly-final matches.
  3. `scoreAutoCustomBets()` — grade `auto_football_data` + `auto_api_football` custom bets.
  4. `cancelExpiredOpenDuels()` — expire unmatched duels past their match deadline.
  5. `scoreAutoSettleDuels()` — auto-settle matched duels via API-Football stats.

## What to do at activation

### 1. Get the key

Subscribe at <https://www.api-football.com/pricing>. Pick the Pro plan
($19/mo). Copy the key from the dashboard.

### 2. Add to Vercel env

In Vercel project settings → Environment Variables, add:

- **Name:** `API_FOOTBALL_KEY`
- **Value:** *(the key)*
- **Environments:** Production. (Optionally Preview too if you want
  preview deploys to hit the live API.)

Redeploy is not required — Vercel injects the env into the next cron
fire automatically.

### 3. Add to local `.env.local`

For running the fixture-mapping script locally:

```
API_FOOTBALL_KEY=...
```

### 4. Map fixture IDs (one-shot)

The auto-grader needs each `matches` row to know its API-Football
fixture id. Run once locally:

```bash
pnpm api-football:map
```

This calls `/fixtures?league=1&season=2026`, buckets by Asia/Jerusalem
date, then matches against our local `matches` table by TLA → name →
date. Updates `matches.api_football_fixture_id` where it was `NULL`.
Idempotent — safe to rerun if the FIFA bracket adjusts during
knockouts (re-running won't overwrite already-mapped rows; if a row's
opponents change post-bracket-draw you'll need to `UPDATE` it by hand
or clear the column first).

If the script reports `Unmatched (N)` rows at the end, those are
fixtures where API-Football's `code` field is `null` AND the
case-insensitive name match also failed. Either:

- Hand-update `matches.api_football_fixture_id` directly in SQL, or
- Add an alias in `scripts/api-football-map-fixtures.mjs` and rerun.

### 5. Verify team correlation

Sanity check the local team list against API-Football's:

```bash
pnpm api-football:verify-teams
```

Reports any team whose name/code doesn't match. Resolve before
activating so the mapper has the best chance of a clean run.

### 6. Sanity-check on the next cron run

Watch the next `/api/cron/sync` fire in Vercel logs:

- `[api-football stubbed]` lines should be **gone**.
- `[grading auto]` lines should appear for any custom bets with
  `grading_source='auto_api_football'` whose underlying match(es) are
  final + mapped.
- `[duel settle]` lines should appear for any matched duels with the
  same source whose match is final + mapped.

If you see `[api-football error]` with a 401, the key is wrong. If you
see `[api-football error]` with a 429, you've hit the daily quota
(7500/day Pro). The auto-grader treats both as `not_ready` and tries
again on the next sync — nothing breaks, just slower.

## Cost model

- **Pro tier flat:** $19/mo.
- **Per-fixture budget:** every cron run pulls `/fixtures/statistics`
  for any final-but-not-yet-graded fixture. Day-scope sum_day bets
  multiply by N matches that day. A worst-case day = 4 matches × 10
  bets queued × 1 stat-fetch each = 40 calls — well inside 7500/day.
- **Slow-moving wrappers** (`src/lib/api-football-data.ts`) cache at
  `revalidate=3600` for tournament-wide endpoints and 86400 for
  per-team metadata. Even with 100 concurrent users they won't cost
  more than a few dozen calls per hour.

## Rollback

If anything goes sideways:

1. Remove `API_FOOTBALL_KEY` from Vercel.
2. The next cron fire falls back to stub mode automatically — no
   redeploy needed.
3. Any in-flight auto-graded bets stay graded; new auto-grades pause
   until the key returns.
4. Manual grading via `/admin/bets/[id]` always works regardless of
   API state.

## Files to know

| File | Role |
| --- | --- |
| `src/lib/api-football.ts` | Live-grading wrapper (`/fixtures/statistics` + `/fixtures`) |
| `src/lib/api-football-data.ts` | Slow data wrapper (teams, squads, top scorers, team stats) — not yet consumed in UI |
| `src/lib/odds.ts` | Bookmaker odds wrapper (used by admin live-bets suggestions) |
| `src/lib/sync.ts` | Main cron entry — `scoreAutoCustomBets` + `scoreAutoSettleDuels` |
| `scripts/api-football-map-fixtures.mjs` | One-shot fixture-id mapper |
| `scripts/api-football-verify-teams.mjs` | Team-list sanity check |
| `src/app/api/cron/sync/route.ts` | Cron endpoint (auth via `CRON_SECRET`) |
| `vercel.json` | Cron schedule |
