# Raise tournament-bet payout floor 20 → 35

Date: 2026-07-16
Status: Approved. Code changes proceeding; the production data mutation
(retroactive re-pricing) is gated on a final explicit go-ahead after the
read-only dry-run.

## Goal

A friend correctly picked "over 295 total goals" and earned only 20 points.
The floor of the tournament payout curve (20) is the payout for the favourite
of every surface, and it feels stingy for a whole-tournament bet — especially
next to the "over 13 red cards" longshot that paid 100. Raise the floor to
**35** so favourites on tournament bets pay more, while keeping the ceiling at
100 and the risk gradient intact.

## Decisions (from the user, 2026-07-16)

1. New floor value: **35**.
2. Scope of the going-forward change: **tournament-scope surfaces only**
   (`scope = tournament`). Group-winner bets (`scope = group`) keep their
   floor at 20 — they use the tighter 20→50 ceiling and would go nearly flat
   at 35→50.
3. Retroactive re-pricing: **only the "total goals" bet**
   (`id = 3ba57e2b-dec8-47a9-b410-27b2a7403208`). No other already-graded
   bet is re-scored.

## Background (verified against prod DB, 31 human profiles)

Two payout mechanisms feed tournament bets:

- **Odds-driven surfaces** (champion, runner-up, third, top scorer, golden
  ball): per-option payout computed at publish by `buildOutrightCurve` on a
  log-odds curve from `OUTRIGHT_CURVE_FLOOR` (20) to the surface ceiling.
- **Static range / yes-no bets** (total goals, total red cards, final on
  penalties): per-option `payoutOverride` hand-baked into the template file,
  with the floor option set literally to 20.

The floor 20 is encoded in three places:
- `src/lib/bets/free-pick-scopes.ts` — `OUTRIGHT_CURVE_FLOOR` constant.
- `src/app/[lang]/admin/tournament-odds/actions.ts` — `publishSurfaceToBet`.
- `scripts/auto-publish-outright.mjs` — mirrored `CURVE_FLOOR` constant.
Plus the literal `20`s in the three static templates in
`src/app/[lang]/admin/tournament-suggestions/page.tsx`.

Group surfaces share the same floor constant today, so the floor must be
**split by surface** (mirroring how the ceiling is already split via
`outrightCurveCeiling`) to keep group at 20.

## Architecture / single source of truth (rule 20)

- One surface-aware floor function, `outrightCurveFloor(surface)`, lives in
  `free-pick-scopes.ts` next to `outrightCurveCeiling`. The TS publish path
  imports it. The `.mjs` publish script mirrors the two constants with a
  comment pointing back to the source of truth (it cannot import TS), exactly
  as it already mirrors the ceiling.
- `OUTRIGHT_PLAYER_FLOOR = 35`, `OUTRIGHT_GROUP_FLOOR = 20`.

## Going-forward code changes

1. `free-pick-scopes.ts`: replace `OUTRIGHT_CURVE_FLOOR` with
   `OUTRIGHT_PLAYER_FLOOR = 35` + `OUTRIGHT_GROUP_FLOOR = 20` +
   `outrightCurveFloor(surface)`.
2. `tournament-odds/actions.ts`: import + use `outrightCurveFloor(surface)`.
3. `tournament-suggestions/page.tsx`: static floors 20 → 35 for total_goals
   (`gt_295`), total_red_cards (`lt_8`), final_to_penalties (`no`).
4. `auto-publish-outright.mjs`: split mirrored floor (35 player/team, 20 group).

Note: these only affect **future** publishes. Already-published bets keep
their baked-in 20s — only "total goals" gets the retroactive lift below.

## Retroactive re-pricing (total goals only)

Script `scripts/one-off/reprice-total-goals-floor-2026-07-16.mjs`, modelled on
the existing `fix-autograde-payouts.mjs` precedent:

- DRY-RUN by default; mutates only with `APPLY=1`.
- Reads the bet + its `gt_295` winning picks; writes a JSON backup.
- In one transaction:
  - `answer_config`: set the `gt_295` option `payoutOverride` 20 → 35.
  - Winning picks (`answer->>'value' = 'gt_295'`): `payout_snapshot = 35`,
    and `points_earned = 35` where `was_correct`.
  - Insert a `bet_grading_audit` row (audited, rule 13/14).
- Re-verifies: no `gt_295` pick left at 20.

Effect: the 15 winners go 20 → 35 (+15 each). This **shifts the live
leaderboard** — accepted by the user for this one bet.

## Security / safety

- Read-only dry-run first; mutation gated behind `APPLY=1` and a final go.
- Single transaction, JSON backup before write, audit row after.
- No secrets touched. Runs via `DIRECT_URL` from `.env.local` (prod session
  pooler), same as existing one-off scripts.

## Testing (rule 18)

- Unit: `free-pick-scopes.test.ts` — `outrightCurveFloor` returns 20 for
  `group_*` and 35 otherwise; pin `OUTRIGHT_PLAYER_FLOOR = 35`,
  `OUTRIGHT_GROUP_FLOOR = 20`; assert floor < ceiling per surface.
- The retro script is external I/O with no unit seam; covered by dry-run
  preview + post-run re-verify query instead.

## Open consequence to flag (not fixing now, per scope)

After this, the code floor is 35 but the other already-published tournament
bets (champion, runner-up, third, scorer, golden ball, final-on-penalties)
still carry a baked-in floor of 20. Those are **ungraded**, so re-pricing them
to 35 would cost zero leaderboard disruption (no points awarded yet) — offered
to the user as an optional follow-up, deliberately out of scope here.
