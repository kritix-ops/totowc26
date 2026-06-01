# Tournament outright payouts — continuous odds curve (20→100 / 20→50)

**Date:** 2026-06-01
**Owner:** Yoav, executed by Claude
**Status:** approved (all design questions answered in chat 2026-06-01)

## 1. Goal

Replace the multiplicative per-option outright price (`normalizeOutrightOdds`,
notional 1 / cap 25) with a **continuous odds curve** that maps every option's
decimal odds onto a `[floor, ceiling]` band by its position on a logarithmic
odds scale spanning the surface's own min..max priced odds.

- **Player + tournament-wide team surfaces** (`top_scorer`, `golden_ball`,
  `champion`, `runner_up`, `third`): floor **20**, ceiling **100**. Favourite
  earns 20, the longest priced shot earns 100, the long tail of unpriced
  players earns 100.
- **Group winners** (`group_A`..`group_L`): floor **20**, ceiling **50**,
  normalised **per group** — the favourite in each group earns 20, the longest
  shot in that group earns 50.

This is the owner's deliberate reversal of the 2026-05-31 rescale (notional 1 /
cap 25) for these surfaces: tournament bets become the marquee, high-weight
picks. The continuous curve was chosen over a hard "top-30 = 20-40, rest = 100"
two-tier specifically to avoid the cliff (rank 30 = 40, rank 31 = 100) that
killed the middle of the band. Group winners reverse the 2026-05-31 flat
per-group payout back to per-team odds differentiation.

Stake stays **0** (free) across all these scopes — unchanged.

## 2. Decisions locked (chat 2026-06-01)

| Question | Decision |
|---|---|
| Long-tail shape for scorer/ball | **Single continuous log-odds curve** (Option A), not a two-segment 20-40/100 split. Favourites are not artificially compressed; mid-tier contenders land ~45-60, longshots ramp to 100. |
| Group winner | **Per-team by odds, 20→50 within each group.** Reverses the flat per-group payout from the prior commit. |
| Cost / stake | **Stays free (stake 0).** Owner accepts the higher variance of a free 100-point longshot. |
| Champion / runner-up / third | **Same 20→100 curve** as the player surfaces, for consistency (avoids "World Cup winner caps at 25 while an obscure scorer pays 100"). |

## 3. The curve (verified against live snapshot data)

`payout(odds) = round( floor + (ceiling - floor) * t )`,
where `t = (ln(odds) - ln(minOdds)) / (ln(maxOdds) - ln(minOdds))`, clamped to
`[0,1]`. `minOdds`/`maxOdds` are the min/max **priced** odds in that surface
(for groups: within that group). Logarithmic because outright markets are
heavily skewed (a 7.0 favourite next to a 500.0 longshot); linear-in-odds would
bunch every realistic pick at the floor.

Worked numbers from the real `outright_odds_snapshot` (2026-06-01):

```
top_scorer (108 priced, odds 7..501; unpriced → 100)
  #1  Mbappé    7    → 20
  #5  Yamal     19   → 39
  #15 Álvarez   36   → 51
  #30 Olmo      51   → 57
  #60 Watkins   81   → 66
  #108 Foster   501  → 100

golden_ball (25 priced, odds 8..126; unpriced → 100)
  #1  Kane      8    → 20
  #10 Raphinha  21   → 48
  #25 Pulišić   126  → 100

groups (20 fav → 50 longest, per group)
  C: Brazil 20 / Morocco 38 / Haiti 49 / Scotland 50
  K: Portugal 20 / Colombia 29 / Uzbekistan 40 / DR Congo 50
```

Edge cases: empty/all-invalid odds or a single distinct odds value → every
option earns `floor`. Odds at or below 1 → `floor`.

## 4. Implementation

### 4.1 `src/lib/odds-normalize.ts`
Add `buildOutrightCurve(allDecimalOdds: number[], { floor, ceiling })` →
`(decimalOdds: number) => number`. Pure, surface-level (closes over min/max).
Existing `normalizeOdds` (live bets) and `normalizeOutrightOdds` (kept for the
test suite / any future flat use) untouched.

### 4.2 `src/lib/bets/free-pick-scopes.ts`
Add curve constants + a per-surface ceiling helper:
```ts
export const OUTRIGHT_CURVE_FLOOR = 20;
export const OUTRIGHT_PLAYER_CEILING = 100; // scorer, ball, champion, runner_up, third
export const OUTRIGHT_GROUP_CEILING = 50;   // group_A..group_L
export function outrightCurveCeiling(surface: string): number;
```
`OUTRIGHT_MAX_PAYOUT` (25) stays for any non-curve fallback / templates.

### 4.3 `src/app/[lang]/admin/tournament-odds/actions.ts → publishSurfaceToBet`
- Collect all valid decimal odds for the surface, build one curve
  (`floor=20`, `ceiling=outrightCurveCeiling(surface)`).
- Price every option through the curve instead of `normalizeOutrightOdds`.
- Static longshot fallback (option not in snapshot) = ceiling.
- **Dynamic surfaces (scorer/ball): set `customBets.payoutSnapshot = ceiling`
  (100)** so an unpriced player resolves to 100, not the old 25. This is the
  one behavioural fix beyond the price math.
- Extend the `[tournament-odds publish]` log with `floor`/`ceiling`.

### 4.4 `scripts/auto-publish-outright.mjs`
Mirror the curve (the script already mirrors the pricing math by design, with
a comment). Player + champion/runner_up/third surfaces: curve 20→100, dynamic
fallback `payout_snapshot = 100`. Groups: per-group curve 20→50 (replaces the
flat-average payout). This is the script the owner runs to publish.

### 4.5 Tests — `src/lib/odds-normalize.test.ts`
- favourite (minOdds) → floor; longest (maxOdds) → ceiling.
- monotonic non-decreasing across sorted odds.
- midpoint on a log scale lands mid-band.
- degenerate: single odds / empty → floor; odds ≤ 1 → floor.
- group band (20,50) and player band (20,100) both honoured.

## 5. Out of scope / follow-ups
- `tournament-suggestions` template default payouts still read the old
  constants. They are admin starting-points for hand-created bets, overridden
  by publish; left as a minor cosmetic follow-up, not part of this change.
- No new settings columns. Floor/ceiling are constants; promote to `settings`
  only if admin tuning is requested.

## 6. Security / safety
- No new surface, no new auth. `publishSurfaceToBet` keeps its admin gate.
- Pick-time payout (`readMultiChoiceOverride`) has **no cap** — verified it
  reads the stored override with `Math.round` only, so 100 is honoured and
  nothing silently clamps to 25.
- No retro change to graded picks: publishing only rewrites `answer_config`
  on open/locked/draft bets; settled picks already carry their own
  `payout_snapshot`.
- The production publish (running the script / clicking publish) is an explicit
  owner action, confirmed before execution. Claude does not run the DB write
  unprompted.

## 7. Note on economy
This roughly 4× raises the cap (25→100) the 2026-05-31 plan deliberately set.
Flagged to the owner: a free 100-point longshot can swing a 20-person pool on
luck. Owner accepted, on the rationale that tournament bets should be the
high-weight, exciting picks. Realistic favourites (~20-40) keep the
tournament's share of an average player's score in a sane band; the 100 tier
is a low-probability lottery on top.
