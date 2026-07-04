# Duplicate knockout fixtures — root cause, display fix, data cleanup, prevention

Date: 2026-07-04
Reporter: Or Koren (team), via WhatsApp screenshots
Status: Phase 0 (display guard) DONE + validated. Phase 1 (data cleanup) DONE +
verified against prod (2026-07-05, committed). Phase 2 (prevention) drafted.

Phase 1 outcome: 23 shadow rows merged into their canonical twins and deleted.
For the 26 score picks where a user had bet BOTH twins with DIFFERING scores,
the user's MOST RECENT pick (all 26 were on the shadow row, newer) was copied
onto the canonical/grading row before deleting the shadow — approved by the
owner, so no one is graded on a stale pick. 50 redundant shadow score picks + 17
advance picks removed. 0 stranded, 0 duplicates remain, 0 shadow-only bettors.
Advance picks: 0 differed, so canonical kept as-is. Verified: Or's account shows
one card per fixture with correct picks; the 26 merged picks hold the newest
value; no already-graded (final) match changed (finished shadows had 0 bets).

## What Or reported

1. The same match card (France vs Paraguay, R16) appeared **twice** on the
   daily bets screen.
2. On finished knockout matches (ARG-CPV, COL-GHA, Morocco) his "who advances?"
   pick showed **"לא ניחשת"** even though he got the points for it.

Both symptoms share one root cause.

## Root cause (verified against prod, read-only)

A single real fixture exists as **two `public.matches` rows**:

- A **canonical** row with `api_football_fixture_id` set (the API-Football sync
  path). This row receives the result, `advancing_team`, live bets, and grading.
- A **shadow** row with `api_football_fixture_id = NULL` and `api_fixture_id`
  set (the legacy football-data path / seed).

Mechanism: `src/lib/sync.ts` has two upsert paths keyed on **different** ID
columns and there is **no natural-key uniqueness** on fixtures:

- API-Football path (`sync.ts:441`):
  `on conflict (api_football_fixture_id) where api_football_fixture_id is not null do update …`
- Legacy football-data path (`sync.ts:545`):
  `on conflict (api_fixture_id) do update …`

When a knockout fixture already exists as a seed/legacy row
(`api_football_fixture_id` NULL) and the API-Football sync later ingests it, the
partial-index conflict target can never match a NULL, so the sync **INSERTs a
second row** instead of updating the existing one. Every knockout fixture got
doubled this way.

### How each symptom follows

- **Duplicate card**: `loadEditableMatches` (`src/app/[lang]/bets/page.tsx`)
  and `getPastMatchPicks` (`src/db/queries.ts`) select all `matches` rows, so
  both twins render. The user's bets join to whichever twin holds them, so both
  cards can look identical.
- **Phantom "לא ניחשת"**: the finished-match past view renders BOTH twins. The
  shadow twin carries no pick, so `PastMatchPickRow` shows `match.myAdvanceTeam`
  as null → "לא ניחשת" (`PastMatchPickRow.tsx:158`, `he.json:188`). Meanwhile
  the points/bank feeds sum `match_advance_bets` by `user_id` with no `matches`
  join (`queries.ts:454`, `729`), so the +10 shows regardless of which twin the
  bet lives on. Correct points, lying display.

## Damage assessment (verified, read-only — see `_scripts/verify-dup-*.mjs`)

- **23 duplicate knockout fixtures**, 46 rows. Every group: exactly one
  canonical (api_football) + one shadow (legacy). Clean 1:1.
- **Finished fixtures: 0 stranded bets.** Every score/advance/live bet landed on
  the canonical row and graded correctly. No points were lost. Damage on
  finished matches is **display only** (phantom + duplicate cards).
- **Live bets (`custom_bets`): 0 on shadows.** **Duels: 0 on shadows.**
- **Upcoming fixtures: ~41 score+advance bets by early bettors sit on shadow
  rows** across 7 fixtures (BRA-NOR, MEX-ENG, POR-ESP, USA-BEL, ARG-EGY,
  SUI-COL, and PAR-FRA which kicks off 2026-07-05 00:00 IL). When each match
  finalizes, only the canonical row grades — **shadow bets would score 0 even if
  correct.** This is a scoring-integrity risk, still preventable because none of
  these have finalized yet.
- **0 users** have their score bet on one twin and advance bet on the other
  (checked). So collapsing to one row per fixture never hides a bet.

## Phase 0 — Display guard (DONE, validated on prod, safe/reversible)

Defense-in-depth: both read queries now collapse to one row per real fixture
with `distinct on (home_team, away_team, kickoff_at)`, preferring (1) the row
where THIS user has a pick — never hide a bet — then (2) the canonical
API-Football row (where results and grading live).

- `src/app/[lang]/bets/page.tsx` — `loadEditableMatches` (upcoming cards).
- `src/db/queries.ts` — `getPastMatchPicks` (finished cards).

Validated against prod on Or's real account (`bf61c27d`, אור קורן):
- PAST: 91 rows, 0 duplicate fixtures. ARG-CPV now shows advance = ARG (+10),
  COL-GHA = COL (+10). The phantom "לא ניחשת" is gone.
- EDITABLE: 0 duplicate fixtures.
- Full suite: 864/864 pass. `tsc --noEmit` clean.

This is defense-in-depth, NOT the root fix. It masks duplicates on these two
surfaces; other surfaces (and grading) still see two rows until Phase 1 runs.

## Phase 1 — Data cleanup (PROD MUTATION — needs explicit go-ahead)

Every table that references `matches.id` is **ON DELETE CASCADE** (except
`bet_admin_audit` = SET NULL): `match_bets`, `match_advance_bets`, `custom_bets`,
`match_status_audit`, `live_odds_snapshot`, `duels`. So a naive `DELETE` of a
shadow row would **cascade-delete the early bettors' bets** — the opposite of
what we want. The cleanup MUST re-point bets to the canonical row first.

Order (single transaction):
1. Build `dup_map(shadow_id → canonical_id)` for the 23 fixtures
   (shadow = `api_football_fixture_id is null`, canonical = not null, same
   home/away/kickoff).
2. `match_bets`, `match_advance_bets`: delete shadow rows that would collide
   with an existing canonical bet by the same user (keep canonical — it is what
   the UI now shows and where grading runs), then re-point the rest to canonical.
3. `custom_bets`, `duels`, `match_status_audit`, `bet_admin_audit`: re-point
   shadow → canonical (all 0 or few; no per-user unique constraint to collide).
4. `live_odds_snapshot`: delete the shadow's snapshot (PK is `match_id`, so it
   can't be re-pointed onto canonical; odds snapshots are ephemeral).
5. `DELETE from public.matches where id in (shadow_ids)`.

Re-grade: **none required.** Finished shadows had 0 bets; upcoming re-pointed
bets grade normally when their match finalizes. Caveat: if any upcoming
duplicate finalizes BEFORE this runs, its shadow bets strand and the grader must
be re-run for that one match. As of drafting, all 7 upcoming duplicates are
still `scheduled` — run before the next knockout finalizes.

Safety: wrap in a transaction; take a row-count snapshot before/after; dry-run
the SELECTs first. Script to be written as `_scripts/cleanup-dup-fixtures.mjs`
and reviewed here before running.

## Phase 2 — Prevention (DONE in code, on `sandbox`)

1. **Adopt-by-natural-key guard in BOTH ingest paths** (`_ingestFromApiFootball`
   and `_ingestFromFootballData`). Before the upsert, a guarded `UPDATE` claims
   an existing row with the same `(home_team, away_team, kickoff_at)` that lacks
   this path's provider id, stamping the id onto it so the following
   `ON CONFLICT (<provider id>) DO UPDATE` updates that row instead of inserting
   a duplicate. The `NOT EXISTS` guard prevents stamping an id already on another
   row (which would break the partial unique index), so reschedules — which still
   match on the provider id — are unaffected. Validated against prod read-only:
   the adopt is a correct no-op for already-mapped fixtures.
2. **Duplicate-fixtures watchdog**: `countDuplicateFixtures()` runs each sync and
   sets `report.duplicateFixtures`, logging `[sync duplicate-fixtures]` with the
   offending fixtures. It is wrapped so it can NEVER throw — a watchdog must not
   take the sync down (cf. the prod-uptime lessons in the pool-saturation plan).
3. **Hard `UNIQUE(home_team, away_team, kickoff_at)` index — deliberately
   DEFERRED.** A hard constraint inside the per-fixture upsert loop can throw and
   abort a whole sync run (the api_football upsert conflicts on the provider id,
   not the natural key, so a natural-key violation would not be swallowed by its
   `ON CONFLICT`). During a live tournament that uptime risk outweighs the
   benefit, since the adopt guards already prevent the insertion and the watchdog
   surfaces any slip. Revisit post-tournament as a backstop.

## Alternatives considered / rejected

- **Display dedup only (no data cleanup).** Rejected as the sole fix: it hides
  duplicates on two surfaces but leaves bets fragmented; upcoming shadow bets
  still score 0, and grading/leaderboard still see two rows. Kept only as
  defense-in-depth (Phase 0).
- **Delete shadows without re-pointing.** Rejected: CASCADE would destroy the
  early bettors' upcoming bets.
- **Merge on `(home, away, date)` or a kickoff time window.** Rejected: verified
  twins share an identical `kickoff_at` to the second, so the exact natural key
  is both sufficient and safer (no risk of merging genuinely distinct fixtures).
- **Prefer canonical row unconditionally in the display dedup.** Rejected in
  favor of "prefer the row with the user's pick first": during the window before
  Phase 1 runs, unconditional canonical-preference would transiently hide the
  ~6 early bettors' shadow picks from their own screen.

## Security / safety

- No new attack surface. Cleanup is a one-shot admin migration, transaction-
  wrapped, read-verified first. No user input involved.
- Data integrity is the core safety concern: re-point before delete, dry-run the
  SELECTs, snapshot counts, single transaction so it is all-or-nothing.

## Observability

- Cleanup script logs a per-fixture before/after row count and the exact
  shadow→canonical mapping (`[dup-cleanup]` namespace).
- Phase 2 sync fix logs when it adopts an existing row vs inserts
  (`[sync upsert] action: adopted`).
- Verification scripts (`_scripts/verify-dup-*.mjs`) are kept until Phase 1 runs,
  then deleted to leave the tree clean.

## Testing

- Phase 0: full unit suite green (864), typecheck clean, and direct prod
  read-only validation on the reporter's account. The dedup is raw SQL with no
  pure-function seam, so prod validation stands in for a unit test (documented).
- Phase 1: dry-run SELECT counts, run in a transaction, re-verify with
  `verify-dup-damage.mjs` showing 0 duplicate fixtures and 0 shadow bets after.
- Phase 2: add a migration test / sync unit test asserting a second ingest of an
  existing natural-key fixture updates rather than inserts.

## Deploy

- Phase 0: normal pipeline. Branch `sandbox` → PR → `master` → deploy. No prod
  data touched.
- Phase 1: run the reviewed cleanup script against prod once, manually, with
  go-ahead. Ideally the SAME evening, before the next knockout finalizes, and
  ordered so Phase 0's display guard and the cleanup are both live together (so
  no early bettor sees their pick vanish).
- Phase 2: migration + sync change through the normal pipeline; the unique-index
  migration must be sequenced to run after Phase 1 cleanup.

## Open questions

- For the handful of users who bet on BOTH twins of an upcoming match with
  DIFFERENT picks, Phase 1 keeps the canonical pick and drops the shadow one. Is
  that the desired tie-break, or should they be notified?
- Should Phase 2 add a user-facing admin "duplicate fixtures" panel, or is a
  sync-report warning enough?
