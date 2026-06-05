# Auto-grade group-winner bets

**Date:** 2026-06-05
**Author:** Yoav + Claude
**Status:** Approved (user said "תתחיל")

## Goal

The 12 group-winner bets (`scope='group'`, question "מי תנצח בקבוצה X?") currently grade manually, which means an admin has to click "the winner is X" for every group after the group stage ends. The user wants this to happen automatically from match results, same way match/day bets already auto-grade.

## Context

- Auto-grading infrastructure already exists: `scoreAutoCustomBets()` in `src/lib/sync.ts` runs on every cron sync pass. It handles `scope='match'` and `scope='day'` for `grading_source IN ('auto_football_data', 'auto_api_football')`.
- `tryResolve()` returns `"skip"` for `scope='group'` because there is no group resolver.
- `getLiveStandings()` in `src/db/queries.ts` already computes per-group standings sorted by points → goal_diff → goals_for. The Live Standings page on `/tournament` consumes this and shows position #1 in every group.
- Group bets are created by `scripts/auto-publish-outright.mjs` with `grading_source='manual'`. They use `answer_type='multi_choice'` with the 4 team codes as `answer_config.options`.

## Approach (chosen)

**Resolve from the existing standings query, defer ambiguous cases to manual.**

1. New `resolveGroupScope(bet)` in `sync.ts`:
   - Pulls the standings for `bet.groupId` via the same SQL shape as `getLiveStandings` (inline CTE, scoped to a single group).
   - Returns `"not_ready"` until all 6 group-stage matches are final (each of the 4 teams has `played === 3`).
   - When ready, returns `{ type: 'multi_choice', value: <team_code> }` for the team at position #1.
   - **Safety gate.** If the top two teams are tied on points AND goal_diff AND goals_for, returns `"not_ready"` and logs a warn (`[grading group ambiguous]`). Admin grades manually in that case. This avoids the FIFA head-to-head / fair-play tiebreaker rabbit hole, which is rare in practice; bet sanctity (memory `feedback_user_bets_are_sacred`) demands we never grade ambiguously.

2. Wire into `tryResolve`: when `bet.gradingSource === 'auto_football_data'` and `bet.scope === 'group'`, call `resolveGroupScope`.

3. Migration `0040_auto_grade_group_bets.sql`:
   - Updates existing `custom_bets` rows where `scope='group' AND grading_source='manual'` to `grading_source='auto_football_data', grading_config = '{"source":"football_data","field":"group_winner"}'::jsonb`.
   - Idempotent (`WHERE grading_source='manual'` only).
   - Restricted to multi_choice rows whose question matches the auto-publish-outright pattern, with `grading_config IS NULL`, so any hand-rolled custom group bet is left alone.
   - Does NOT touch user picks. Bet immutability preserved.

4. Update `scripts/auto-publish-outright.mjs` to create new group bets with the auto config so any future re-run stays auto-graded.

5. Tests: extract the tiebreaker decision into a pure function `pickGroupWinner(rows)` and unit-test it in `src/lib/grade-group.test.ts`:
   - clean winner
   - tied on points only (goal_diff breaks)
   - tied on points + GD (goals_for breaks)
   - tied on all three → returns `ambiguous`
   - all 6 matches not yet played → returns `not_ready`

## Alternatives (rejected)

- **Full FIFA tiebreakers including head-to-head + fair-play points.** Rejected: complex, requires cards data we may not have, and ambiguous group winners are rare enough that manual fallback is cheaper than building the full ladder. Can be added later if a real WC 2026 group hits the head-to-head case.
- **Per-bet "auto/manual" admin toggle.** Rejected: friends pool, no need for per-bet config. Whole-class flip is cleaner.

## Security / safety

- Bet immutability: the grading flow already writes through `db.transaction` per bet. Group resolver reuses the same path with no new write surface.
- Ambiguous-tie fallback is a hard rule, not a fallback default: when the resolver is unsure, no points are credited and admin sees the bet still in the manual queue.
- Migration is additive (changes grading metadata, never touches `user_custom_bet_picks`).

## Observability

- `console.info("[grading auto]", { betId, scope: 'group', ... })` is already emitted by the shared grading path.
- `console.warn("[grading group ambiguous]", { betId, groupId, tied: [{code, points, goalDiff, goalsFor}, ...] })` is new and fires when the safety gate trips.
- `console.warn("[grading skipped]", ...)` is already emitted by the shared path for unsupported combos.

## Testing

- Unit: `src/lib/grade-group.test.ts` covers the pure `pickGroupWinner` logic across all 9 scenarios listed above.
- Manual: after deploy, hit `/api/cron/sync` once (or the new "סנכרון ידני" pill on `/admin/bets`) and confirm the 12 group bets stay `open` while groups are incomplete, then auto-flip to `graded` once each group's 6 matches are final.
- The first real grading event will be visible on the existing `/admin/bets` page; no UI change needed.

## UI / Settings

- One small UI add: a "סנכרון ידני / Sync now" pill button on `/admin/bets` linking to `/admin/system`. The full sync panel already exists; the pill makes the button discoverable from the page admin visits when thinking about bets.
- Updated the SyncPanel copy to explicitly call out that the button grades group winners, not just match bets.
- No new Settings entry. This is a behavior fix, not a configurable knob.

## Out of scope

- Full 1→4 ranking (which two friends asked about in the WhatsApp thread). That is a new bet shape with a new answer type; saved for next tournament.
- Auto-grading of `scope='stage'` and `scope='tournament'` bets (champion, runner-up, top scorer). Those need different data sources and are graded once at the very end; admin overhead is minimal.
