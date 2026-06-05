# Flat tournament bets → per-option odds-based payouts

Date: 2026-06-05

## Problem

Three of the eight live tournament-scope bets show a single flat
`payout: 10` (or `6`) across every option. That tells the user "the bet
is worth ten points no matter what you pick" — which is both
uninteresting (every option pays the same) and stingy (10 points is
small alongside the 20→100 range every other tournament bet pays).

Affected bets:

| Bet                                                | Current flat | Options                          |
| -------------------------------------------------- | ------------ | -------------------------------- |
| כמה שערים יובקעו בסך הכל במונדיאל 2026?            | 10           | `lt_265`, `265_295`, `gt_295`    |
| כמה כרטיסים אדומים יוצאו במונדיאל 2026?            | 10           | `lt_8`, `8_13`, `gt_13`          |
| האם הגמר יוכרע בפנדלים?                            | 6            | yes / no                         |

The other five tournament bets (Champion, Runner-up, Third, Top scorer,
Golden ball) already publish per-option payouts on the 20→100 log-odds
curve via `scripts/auto-publish-outright.mjs` against the bookmaker
snapshot stored in `outright_odds_snapshot`. The three above sit outside
that snapshot — they're statistical ranges and a yes/no, not outright
markets — so they never picked up per-option pricing.

## Goal

Bring the three flat bets onto the same 20→100 per-option scale as the
rest of the tournament page, using probabilities derived from real
bookmaker totals and historical baselines.

## Probability research

### Total tournament goals — `lt_265` / `265_295` / `gt_295`

DraftKings Sportsbook (June 2026) on the WC2026 total tournament goals:

| Line       | Odds (American) | Implied | De-juiced |
| ---------- | --------------- | ------- | --------- |
| Over 290.5 | -425            | 80.95%  | 75.22%    |
| Under 290.5| +275            | 26.67%  | 24.78%    |
| Over 300.5 | -155            | 60.78%  | 56.07%    |
| Under 300.5| +110            | 47.62%  | 43.93%    |
| Over 310.5 | +175            | 36.36%  | 33.73%    |
| Under 310.5| -250            | 71.43%  | 66.27%    |

Source: <https://www.foxsports.com/stories/soccer/2026-world-cups-odds-total-goals-scored-expected-skyrocket>.
Cumulative overround ≈ 8% across lines; the de-juiced column normalises
each pair to sum to 100%.

The bookmakers' distribution centres around ~300 goals (driven by the
2022 World Cup's 3.58 goals/match rate × 104 matches projecting to 373).
The Toto buckets sit below the bookmaker centre, so:

- **P(< 265)**: extrapolating below the 290.5 line where 25% of mass
  lies, with the distribution thinning quickly toward the left tail,
  ≈ **7%**.
- **P(265–295)**: 290.5 has 25% below it and 295 sits 4.5 above; using
  the gradient from the next-out line (300.5 at 44% below), 295 is
  ≈ 33% below. So P(265 ≤ x ≤ 295) ≈ 33% − 7% = **26%**.
- **P(> 295)**: 100% − 7% − 26% = **67%**.

Fair decimal odds: 14.3 / 3.85 / 1.49.

Log-odds curve (20→100) over `{1.49, 3.85, 14.3}`:
- `gt_295` → floor 20 (favourite)
- `265_295` → 54 (interpolated)
- `lt_265` → ceiling 100 (longshot)

### Total red cards — `lt_8` / `8_13` / `gt_13`

No direct bookmaker market exists for the WC2026 tournament-total red
cards line. We derive probabilities from historical baselines.

Red cards per tournament (source: Planet World Cup,
<http://www.planetworldcup.com/STATS/stat_disc.html>):

| Year | Cards | Matches | /match |
| ---- | ----- | ------- | ------ |
| 1990 | 16    | 52      | 0.31   |
| 1994 | 15    | 52      | 0.29   |
| 1998 | 22    | 64      | 0.34   |
| 2002 | 17    | 64      | 0.27   |
| 2006 | 28    | 64      | 0.44   |
| 2010 | 17    | 64      | 0.27   |
| 2014 | 10    | 64      | 0.16   |
| 2018 | 4     | 64      | 0.06   |
| 2022 | 5     | 64      | 0.08   |

VAR-era average (2018, 2022): 0.07/match. Scaled to 104 matches:
~7 red cards expected, with a fat right tail (48-team format brings in
weaker / less experienced sides that historically draw more cards;
2006 was 0.44/match).

Modelling as a discrete distribution centred at 7 with the historical
right tail:

- **P(< 8)** ≈ **60%** — the VAR-era trend keeps the modal range here.
- **P(8 ≤ x ≤ 13)** ≈ **28%** — plausible if the 48-team expansion
  partially reverses the VAR suppression.
- **P(> 13)** ≈ **12%** — would be the highest VAR-era count, but not
  unprecedented (2010 hit 17 at 64 matches).

Fair decimal odds: 1.67 / 3.57 / 8.33.

Log-odds curve (20→100):
- `lt_8` → 20 (favourite)
- `8_13` → 58 (mid)
- `gt_13` → 100 (longshot)

### Final decided on penalties — yes / no

Historical record (1990–2022, eight finals): 1994 Brazil-Italy, 2006
Italy-France, 2022 Argentina-France went to penalties → 3/8 = 37.5%.

Across all 20 finals from 1966-2022, 6 went to penalties (30%).
Polymarket carries the 2026 question but with no liquidity pre-tournament,
so it's the historical rate that anchors the price. Recent finals lean
slightly higher, partly because tactical defence has improved; for the
model we use a base rate of **30%**.

Fair decimal odds: yes 3.33 / no 1.43.

Log-odds curve (20→100) on a 2-option surface collapses to (floor,
ceiling):
- `yes` → 100 (longshot)
- `no`  → 20 (favourite)

## Implementation

### Types

`YesNoConfig` gains two optional fields:

```ts
export type YesNoConfig = {
  kind: "yes_no";
  payoutOverrideYes?: number;
  payoutOverrideNo?: number;
};
```

Backwards-compatible: bets without overrides keep using the bet-level
`payoutSnapshot`.

### Payout resolver

`resolvePickPayoutAtSubmit` reads the new fields after the existing
multi-choice branch. Same rules (positive finite integer, rounded).

### Template

`buildTemplates` in `src/app/[lang]/admin/tournament-suggestions/page.tsx`
gets explicit `payoutOverride` per option on the goals + red cards
templates and `payoutOverrideYes`/`payoutOverrideNo` on the penalty
template. The bet-level `defaultPayout` for all three becomes the curve
ceiling (100) so the card headline matches the existing tournament-bet
convention ("זכייה: 100, with per-option breakdown in scenarios").

### Migration 0042

Single transaction that:

1. Rewrites `answer_config` on the three named bets to add per-option
   payouts.
2. Sets `payout_snapshot = 100` on those bets (curve ceiling, headline).
3. For each pick already placed on those bets, rewrites
   `payout_snapshot` to match the new per-option payout for the user's
   actual answer.

User-bets-sacred (per `memory/feedback_user_bets_are_sacred.md`):
- The user's `answer` field is never touched.
- Only `payout_snapshot` changes, and only to the value the user *would*
  have been quoted had the per-option pricing existed at pick time.
- This is the same intent-preserving precedent migration 0037 set when
  it dropped stakes and capped payouts.
- Guarded by `points_earned IS NULL` so any already-settled history is
  immutable.

## Verification

- Unit tests in `payout.test.ts` cover the new yes_no path.
- Manual: on sandbox, open the tournament page, confirm each of the
  three bets shows the new ceiling headline, pick each option in turn,
  and check the scenario block reflects the per-option payout.

## Settings audit (rule 15)

Not exposed in settings. The payout curve floor/ceiling are already
hardcoded in `src/lib/bets/free-pick-scopes.ts` (`OUTRIGHT_CURVE_FLOOR`
= 20, `OUTRIGHT_PLAYER_CEILING` = 100). Per-option payouts for the
three bets are policy choices baked into the templates, the same way
the other tournament-bet defaults already are. If the admin ever wants
to tune them, the template editor at `/admin/tournament-suggestions`
already exposes the per-option payout column.

## Observability (rule 14)

Migration logs the count of bets updated and picks repriced via
`RAISE NOTICE` (standard pattern for non-trivial pick-touching
migrations on this project). No new runtime logging needed — the
existing `[custom-bet pick]` namespace covers the user-facing flow.

## Security (rule 13)

No new attack surface. Migration runs as a privileged DB role and
touches only `custom_bets.answer_config` / `payout_snapshot` and
`user_custom_bet_picks.payout_snapshot` on rows already gated by
scope, status, and `points_earned IS NULL`.
