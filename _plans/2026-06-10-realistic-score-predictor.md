# Realistic score auto-predictor

Date: 2026-06-10
Status: approved (design questions + council done), implementing

## Goal

Replace the team-agnostic random score generator with a statistically grounded
one so auto-filled predictions are realistic and common-sense (no more Cape
Verde 3:0 over Spain) but still varied (sampled, not always the same score).
One engine powers three surfaces: the "Surprise me" button, the monkey bot, and
the deadline auto-fill. Plus: a per-match "Surprise me" control, not only the
fill-all button.

## Root cause

`randomMatchScore()` in src/lib/random-picks.ts samples both teams from the
same fixed goal distribution `[34,30,20,10,4,2]`, ignoring who plays. Spain and
Cape Verde get identical scoring odds. The deadline auto-fill (auto-fill.ts) and
monkey (monkey.ts) already exist and call the same function.

## Decisions (user)

- Pick style: realistic & VARIED (sample a distribution, not argmax).
- Deadline auto-fill: same varied sampling as Surprise-me. Sampling is itself
  the fair mild penalty for forgetting (the council's key insight: argmax would
  unfairly hand absentees the single best pick; a sampled pick is non-optimal,
  so showing up still pays).
- Monkey: upgraded to the same engine. It stops being a pure random baseline and
  becomes a "beat the market expectation" benchmark. Accepted.
- Fallback when no odds: the existing TEAM_RANK strength table (all 48 teams).
- Engine depth: lean closed-form. No API-Football /predictions in v1.
- New: per-match Surprise-me control in addition to fill-all.

## Verified facts (do not regress)

- Knockout draws ARE valid predictions. Grading (sync.ts ~line 630) compares the
  predicted score to the recorded score; a level knockout is stored as a draw
  with a separate `wentToPenalties` flag. So DO NOT strip draws anywhere.
- Stored odds shape: `live_odds_snapshot.markets` is `MarketOdds[]` (src/lib/odds.ts).
  market 1 "Match Winner" -> labels Home/Draw/Away; market 5 "Goals Over/Under X.X"
  -> labels Over X.X / Under X.X; market 4 Asian handicap -> Home/Away ±line.
- Odds refresh daily via /api/cron/odds-sync. Treat a snapshot older than ~72h,
  or missing the 1X2 market, as unusable -> fall back.
- Writes go through write-core with a `system` principal for monkey + auto-fill;
  Surprise-me uses a self principal. Unique (user,match) index makes fills idempotent.

## The engine (lean closed-form)

New pure module `src/lib/bets/score-model.ts` (no IO, injectable RNG, unit-tested):

1. Inputs, in priority order, resolved by a separate IO layer:
   a. Stored odds (1X2 + Over/Under + handicap) for the match.
   b. TEAM_RANK strength for the two team codes.
   c. Sane default (current goal distribution) as last resort.
2. From odds:
   - de-vig 1X2 -> pH, pD, pA.
   - expected total goals mu: take the main Over/Under line, nudge by the
     over/under odds lean.
   - supremacy (lambda_home - lambda_away): from the Asian handicap line if
     present, else derived from the de-vigged 1X2 split.
   - lambda_home = (mu + supremacy)/2, lambda_away = (mu - supremacy)/2, floored.
3. From rank (fallback): supremacy from rank gap (capped), mu ~ WC average.
4. Build a Poisson-product score matrix over 0..MAX_GOALS for both sides.
5. Upset cap (the guardrail that kills the embarrassment): if the favourite's
   win probability (summed from the matrix) >= UPSET_CAP_THRESHOLD, zero out the
   cells where the UNDERDOG wins (draws and favourite wins stay), renormalise.
   Applied identically on the odds and rank paths.
6. SAMPLE a scoreline from the (capped, renormalised) matrix. Return
   `{ home, away, source }` where source is `odds | rank | default` for audit.

RNG: injectable, defaults to Math.random. Plain Math.random per call gives
per-user variety, is unpredictable (no shared-seed gaming), and stays testable.
No deterministic per-user seed needed.

## IO + wiring

- `src/lib/bets/score-inputs.ts` (server-only): batch-load, for a set of match
  ids, the stored odds markets + home/away team codes + stage, and build the
  engine input per match. One query, not N.
- Replace `randomMatchScore()` at the three call sites (monkey.ts, auto-fill.ts,
  random-actions.ts) with: resolve inputs -> `predictScore(input)`.
- Keep `randomMatchScore` as the engine's last-resort default.

## Per-match Surprise-me

- New server action `fillOneMatch(matchId)` (or a single-match target on the
  existing action) that fills just that match for the caller.
- A small dice button on each unfilled match row, matching SurpriseMeButton
  styling and the 44px touch-target / mobile rules. Shown only on matches the
  user has not filled; once filled, the score replaces it. (v1: no re-roll of an
  existing pick, to avoid clobbering deliberate picks.)

## Cost

Zero incremental: reads odds already stored daily; no new API calls. TEAM_RANK is
in-repo. API-Football /predictions deferred. The Odds API free-tier limit only
matters if we raise sync frequency later (not now).

## Security / fairness

- Per-call Math.random entropy: users cannot predict others' auto-fills.
- Auto-fill keeps the existing `system` principal; no new trust surface.
- `source` tag recorded per generated pick path for later audit of any bad pick.
- Sampling (non-optimal) is the fairness mechanism for the forgetful; diligent
  users who pick the most-likely score still beat a sampled auto-fill on average.

## Out of scope (v1)

- Blending API-Football /predictions.
- A separate sampling "temperature" per surface.
- Crowd-distribution dashboard cards (Expansionist idea; nice later).
- Real Elo ingest (TEAM_RANK is enough; can swap later).

## QA plan

- Unit tests for the pure engine: de-vig sums to 1; symmetric odds -> equal
  lambdas; heavy favourite -> underdog win rare and upset cap engaged; draws
  retained for knockouts; clamps; fallback chain picks the right source.
- Sanity: run the engine on a Spain-vs-minnow fixture and two even teams, print
  the sampled-score histogram, confirm it looks sane.
- Typecheck + lint. Mobile check of the per-match dice button at 360px.
