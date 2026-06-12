# Remove the absolute live-bet payout ceiling

Date: 2026-06-12
Status: code + retroactive fix shipped; forward flip pending deploy

## Goal

Two problems the user found on the Mexico vs South Africa (2026-06-11) live
bets:

1. **One shared odds for both yes/no answers.** Old live bets were published
   with a single `decimal_odds`, so "yes" and "no" paid the same multiplier.
   On near-certain outcomes (e.g. "no VAR red card", ~90% likely) the safe
   side paid ×6 — a massive leak. (Already fixed structurally for *future*
   bets by the 2026-06-12 LLM overhaul, which prices each side from its own
   probability via `priceYesNo` / `decimalOddsYes|No`.)

2. **The absolute 100-point payout ceiling punished bigger stakes.** The cap
   was `min(stake * ratio, ceiling)` with ceiling = 100. On the VAR red-card
   bet (×6) a 30-stake and a 20-stake pick both hit 100, so staking *more*
   netted *less*: Haran (30) won +70 net while Matan/Or Lederman (20) won +80.

## Decisions (user-confirmed)

- **Cap scope:** remove the absolute ceiling only; keep the per-stake ratio
  guard (×8). The ratio guard never bound the MEX–RSA bets and conveniently
  keeps payouts inside `smallint` (max stake 100 × ratio 8 = 800 ≪ 32767).
- **MEX–RSA bets:** re-settle without the ceiling, **honouring the odds that
  were shown** (no re-pricing — you cannot retroactively change odds people
  bet against). Corrected odds-per-answer apply to future bets only.

## Implementation

### Forward (cap removal)
- `ceiling = 0` is the "no absolute cap" sentinel. `liveStakeCap()`
  (`src/lib/odds-normalize.ts`) returns `stake * ratio` when ceiling ≤ 0.
  All seven call sites (submit, bet card display, suggestions, autogen,
  admin preview) funnel through `liveStakeCap`, so display and settlement
  can never drift.
- Migration `0055_remove_live_payout_ceiling.sql` **widens** the DB CHECK so
  0 is legal. It does **not** flip the value (see Rollout).
- Settings validation (`scoring/actions.ts`) and the Scoring form accept 0
  with a "0 = no ceiling" hint. The card's cap label drops the ceiling term
  when disabled.

### Retroactive (MEX–RSA)
- `_scripts/resettle-mex-rsa-uncapped.ts`: recomputes each pick's uncapped
  payout, self-validates (the *capped* recompute must reproduce every stored
  payout — 0 mismatches across 75 picks confirmed edge=5 / ratio=8), and only
  rewrites winning picks the ceiling clipped.
- **Applied to prod.** 3 picks changed, all on the VAR red-card bet:
  Haran 100→171 (+71), Matan 100→114 (+14), Or Lederman 100→114 (+14).
  Pool +99. Payouts now scale monotonically with stake (30→171, 20→114,
  10→57, 5→29, 3→17, 1→6).
- Reversible: before-state backup JSON in `_scripts/`, one `bet_grading_audit`
  row (action `grade`) on the affected bet.

## Rollout order (matters)

1. Deploy the code + migration 0055 (constraint widening; value stays 100 —
   safe no-op under both old and new code).
2. **After** the new code is confirmed live, flip the ceiling to 0 — from
   `/admin/settings/scoring` or `UPDATE settings SET live_odds_max_payout_ceiling = 0 WHERE id = 1`.

Flipping to 0 *before* the new code is live would make the old
`liveStakeCap` read 0 → cap every live payout at `ratio` (8). The split
above removes that window entirely. Prefer flipping when no match is in its
live-betting window.

## Security / observability / testing

- **Security:** no new surface. Settings change is admin-only (existing
  `requireAdmin` on the scoring action) and DB-CHECK bounded. The re-settle
  is a one-shot service-role script, owner-authorised, insert-only audit,
  reversible backup — honours `feedback_user_bets_are_sacred`.
- **Observability:** the re-settle logs every change and a sanity-mismatch
  report; it aborts before writing if any stored payout fails to reproduce.
- **Testing:** `odds-normalize.test.ts` adds ceiling-0 / malformed-ceiling
  cases and an end-to-end MEX–RSA scenario (bigger stake wins more). Full
  suite green (480), `tsc --noEmit` clean, eslint clean.

## Alternatives rejected

- **Magic-number ceiling (32000) instead of a 0 sentinel:** deploy-order
  safe but leaves an ugly "min(stake × 8, 32000)" label and a non-obvious
  knob. Rejected for clarity.
- **Flip ceiling=0 inside the migration:** simplest but opens the old-code
  cap-at-8 window. Rejected for safety.
- **Re-price MEX–RSA with corrected per-side odds:** unfair — changes the
  odds players already bet against. Corrected odds are future-only.
