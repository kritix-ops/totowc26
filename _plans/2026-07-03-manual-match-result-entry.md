# Manual match result entry (admin)

Date: 2026-07-03
Owner: full admin only
Status: built (2026-07-04) — pending migration run + deploy. Penalty toggle was
dropped during build: a knockout level after extra time is decided on penalties
by definition, so the shootout inputs show automatically instead.

## Problem

Match scores today come **only** from the 5-minute API sync (`src/lib/sync.ts`,
`_ingestFromApiFootball`). There is no admin screen to type a result in by hand.
When the feed lags, the admin is stuck:

- The 1/X/2 (`match_bets`) and "who advances" (`match_advance_bets`) picks stay
  ungraded because the match never flips to `status = 'final'`.
- The existing "who advances" manual override (`AdvanceTeamCard`) is gated on
  `status = 'final' AND stage <> 'group'` (`admin/matches/page.tsx:108`), so it
  does not even appear until the API finalizes the match. **Both of the user's
  complaints share this one root cause.**

## Goal

A full-admin manual result editor on `/admin/matches` that lets the admin punch
in a match result when the API is delayed (or wrong), mark the match final, and
trigger grading — with the manual entry protected from later API overwrite.

## Decisions (confirmed with user 2026-07-03)

1. Editor covers: 90-minute result (grades 1/X/2), who-advances + penalties for
   knockout, and re-grade of match-scoped live bets.
2. **Manual wins forever.** Once a result is entered manually, the API sync is
   blocked from overwriting it. (Consistent with the "manual override always
   wins" project rule.)
3. Full admin only (same gate as postpone/cancel/set-advancing-team).

## Design

### Data model — new column + migration

`0071_matches_manual_result.sql`:

```sql
alter table public.matches
  add column manual_result boolean not null default false;
```

Add to `src/db/schema.ts` matches table:

```ts
manualResult: boolean("manual_result").notNull().default(false),
```

### Sync guard — protect the manual entry

In `_ingestFromApiFootball` (`sync.ts:463`) extend the DO-UPDATE guard:

```
where matches.status not in ('postponed', 'canceled')
  and matches.manual_result is not true
```

Mirror the same guard in `_ingestFromFootballData` upsert if it has one.
This is the whole "manual wins forever" mechanism: the row is simply invisible
to upstream updates once `manual_result = true`, exactly like a postponed hold.

### Server action — `setMatchResult`

New action in `src/app/[lang]/admin/matches/actions.ts`, modeled on
`setAdvancingTeam` + `resolveCanceledMatch`:

Signature:
```ts
setMatchResult(matchId, {
  regHome, regAway,          // required, 0..99 — grades 1/X/2
  finalHome, finalAway,      // required, 0..99, >= reg — display + live-bet grading
  wentToPenalties,           // knockout only
  penHome, penAway,          // optional, only when wentToPenalties
  advancingTeam,             // knockout only: home code | away code | null
}, reason): Result<{ scored1x2, scoredAdvance, scoredLive }>
```

Validation (fail closed):
- Full-admin gate (`requireFullAdmin`).
- reason >= 3 chars.
- Match exists; status is NOT `postponed`/`canceled` (those have their own flow —
  admin must reopen first).
- Kickoff has passed (can't finalize a match that hasn't started).
- Scores are integers 0..99; final >= reg per side.
- Knockout: `advancingTeam` is home/away/null; penalties only when
  `wentToPenalties` and the knockout is level after 90.
- Group: `advancingTeam` forced null, penalties forced off.

Transaction:
1. `update matches set status='final', manual_result=true, home_score, away_score,
   reg_home_score, reg_away_score, went_to_penalties, pen_home_score,
   pen_away_score, advancing_team, finalized_at=coalesce(finalized_at, now()),
   status_changed_at=now()`.
2. Reset already-graded 1/X/2 picks on this match to ungraded
   (`points_earned=null, was_exact=null, was_correct_outcome=null`) so a
   correction re-grades — same reset semantics as `setAdvancingTeam`.
3. Reset already-graded advance picks (`points_earned=null, was_correct=null,
   locked=false`).
4. Insert `match_status_audit` row, `action='set_result'` (the action column is
   free `text`, no enum migration needed), payload snapshots the full scoreline +
   previous values.

After commit, re-grade forward (idempotent, only touches ungraded picks):
- `scoreFinalMatches()` — grades 1/X/2.
- `scoreAdvanceBets()` — grades who-advances.
- `scoreAutoCustomBets()` — grades ungraded auto-gradeable live bets on the match.
  (Needs to be exported from `sync.ts`; today it is module-private.)

**Boundary (documented):** already-graded **live/custom** bets are NOT
auto-reversed here, because a graded live bet has already moved points in the
bank and reversal is the audited per-bet flow (`GradeForm` / reverse action).
1/X/2 and who-advances resets are safe because they touch only points columns,
no bank. If a live bet was mis-graded off bad API data, the admin corrects it in
the existing per-bet grade/reverse screen. This is called out in the UI copy.

Then `revalidateMatchSurfaces(matchId)` + notify affected players (feed-only,
after commit) that the result is in.

### UI — `MatchResultCard`

New client component `src/app/[lang]/admin/matches/MatchResultCard.tsx`, styled
like `AdvanceTeamCard` (mobile-first, 44px targets, 48px/16px inputs to avoid iOS
zoom, single column under md). Rendered on `/admin/matches` for matches that are
**past kickoff and not yet final** (a new query slice), plus a compact "edit
result" affordance on already-final matches so a wrong API score can be corrected.

Fields:
- 90' score: two number inputs (home / away).
- Final score: two number inputs, prefilled from 90' (bump for extra time).
- Knockout only: "went to penalties" toggle → pen score inputs + advancing-team
  selector (home / away / undecided), reusing the `AdvanceTeamCard` selector.
- Reason (required), Save button.

Hebrew-first copy. Success line: "התוצאה נשמרה. X ניחושים נוקדו." Error map reuses
`translateAdminError` + the existing `ERROR_MAP` keys.

## Security

- Full-admin only, checked in the action (not just the page).
- Immutable audit row for every entry (`match_status_audit`, action `set_result`).
- Fail-closed validation; scores bounded; group/knockout invariants enforced.
- No secrets, no PII in logs — log matchId, scoreline, actor id, counts.

## Observability

`console.info('[match set-result]', { matchId, reg, final, pen, advancingTeam,
manual: true, by, scored1x2, scoredAdvance, scoredLive })` on success;
`console.error('[match set-result] failed:', err)` on failure. Namespace
`[match set-result]` to match the existing `[match postpone]` / `[admin
set-advancing-team]` convention.

## Settings audit

No new user setting. This is an admin operational tool, not a player-facing
preference. Nothing to expose in the settings layer.

## Testing

- Unit: `setMatchResult` validation table — bad scores, group-with-advancing,
  penalties-without-knockout, reason too short, non-admin, postponed match.
- Unit: reset-and-regrade — a pick graded off a wrong score re-grades to the
  corrected points (fails on old code path, passes on new).
- Unit: sync guard — a `manual_result=true` row is skipped by the upsert even
  when the API reports a different score (extend existing sync test).
- Run the affected suite (sync + admin matches) green before done.

## Deploy

Migration `0071` runs ahead of the code that reads `manual_result`. Standard
flow: PR into `master`, CI, merge. No manual promotion. Migration is additive
(new column, default false) so it is backward compatible with the running app.

## Out of scope

- Auto-reversing already-graded live bets (use the per-bet flow).
- Editing halftime score (not graded against; skip).
- Bulk result entry (one match at a time is fine for the delay case).
```
