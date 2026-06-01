# Fix: re-creating a tournament bet wipes its published odds + dedupe

**Date:** 2026-06-01
**Owner:** Yoav, executed by Claude
**Status:** approved (owner: "clean the bets and fix the bug once and for all")

## 1. Problem (verified, not guessed)

The five tournament-wide bets (top_scorer, golden_ball, champion, runner_up,
third) were re-created today 13:10 by the admin via `publishTournamentTemplate`
(the tournament-suggestions "publish from template" action). The created bets
carry the flat template payout (10/12/12/10/8) and an EMPTY
`payoutOverridesByValue`, so every option falls back to that flat number
(Vinícius showed 10). This wiped the 20→100 odds curve I had published to the
prior bets, which were cancelled.

Root cause: a freshly created tournament bet is born WITHOUT odds. The odds
curve only gets baked in by a separate publish step
(`scripts/auto-publish-outright.mjs` or admin `publishSurfaceToBet`). Any
re-create silently drops to flat payouts until someone re-publishes.

Not a cron. `backup` (00:00 UTC) does not touch custom_bets; `odds-sync`
(12:00 UTC) only refreshes the `outright_odds_snapshot` staging table, it does
not create or publish bets. So the fix below is durable.

## 2. Fix (once and for all)

**Auto-publish the odds curve on creation.** In `publishTournamentTemplate`,
after the insert, map the question to its outright surface and call the
existing `publishSurfaceToBet({ surface, customBetId })`. Every freshly created
tournament bet is then born with the per-option curve and `payoutSnapshot` =
ceiling. Re-creating can no longer leave a bet on flat payouts.

- Best-effort: if the snapshot has no rows or publish errors, the bet is still
  created (keeps the template payout); we log a warning, never fail creation.
- Reuses the single canonical publish path (`publishSurfaceToBet`), so the
  curve math lives in exactly one place. No duplication.
- Group bets are created/priced through their own path and were unaffected;
  out of scope here.

New shared helper `src/lib/bets/outright-surfaces.ts`:
`outrightSurfaceForQuestion(questionHe): OutrightSurface | null` — the
question→surface map (mirrors `SURFACE_TO_QUESTION_PATTERN` in the .mjs). Kept
dependency-light so the server action can import it without pulling the script.

The existing duplicate guard (same question + active status → `duplicate_exists`
unless `force`) stays. Cancel-then-recreate is legitimate and now safe.

## 3. Cleanup (existing bets)

Delete the stale duplicate outright bets that are `status='cancelled'` and have
ZERO user picks (the tournament has not started, so picks are expected to be
none). Verify pick counts before deleting; never delete a bet that has picks or
is open/locked/draft. Keep exactly the one open canonical bet per surface (the
one now carrying the curve). One-off, run from a node script against the DB.

## 4. Tests / QA

- Unit: `outrightSurfaceForQuestion` maps each of the five real question
  strings to the right surface and returns null for an unrelated question.
- Manual/DB: after the fix, re-create a tournament bet via the action and
  confirm `payoutOverridesByValue` is populated and `payoutSnapshot` = ceiling
  without a separate publish step. (Validated by re-running publish + reading
  back; full action e2e needs the app, noted.)
- Typecheck + full vitest suite green.

## 5. Security / safety

- No new surface or auth path. `publishSurfaceToBet` keeps its own admin gate;
  the auto-call runs inside an already admin-gated action.
- Cleanup deletes only cancelled, pick-free rows; a FK from
  `user_custom_bet_picks` would block any unsafe delete anyway, and we check
  counts first.
- No retro change to graded/active picks.
