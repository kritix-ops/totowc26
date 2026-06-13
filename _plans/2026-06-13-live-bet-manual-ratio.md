# Live bets: manual ratio (odds) entry, no house edge, no cap

Date: 2026-06-13
Status: approved, implementing

## Goal

On the admin live-bet form (match/day scope), the only way to price a
multi-choice or yes/no market today is to type a probability % per option.
The system renormalises to 100%, inverts to fair odds (`1/p`), then runs
them through `normalizeOdds` (house edge ~5% + payout cap). The admin
cannot directly say "this option pays ×6" — they have to reverse-engineer
a probability that produces the ratio they want.

Add a second pricing mode: **ratio**. The admin types the decimal
odds/multiplier directly per option (per side for yes/no). The player wins
exactly `stake × ratio`, with **no house edge and no payout cap**.

## Decisions (from the user, 2026-06-13)

1. Ratio is **exact, no adjustment** — no house edge, no payout cap. The
   player gets exactly the ratio typed.
2. **Keep both modes** with a per-bet toggle. Default stays probability.

## The one guardrail kept (rule 13 safety)

"No adjustment" means we never *massage* a valid number. It does not mean
we accept a fat-finger ×600 that could write a bank-destroying payout. We
keep a single **input-validation ceiling** on the typed ratio,
`MAX_MANUAL_RATIO = 100` — a generous anti-typo bound (a realistic exotic
longshot tops out far below it). It *rejects* an out-of-range value with a
clear inline message; it never silently changes a value in range. This is
trivially raised/removed if the user wants. Flagged to the user.

This is a friends pool, not a business (memory: stop catastrophising). The
risk is named calmly: with no cap, `stake × ratio` at the max stake
(`liveOddsMaxStake`, default 30) can be large. The sanity bound caps the
worst single-bet exposure at `30 × 100`.

## Where the pricing math lives (all must agree)

1. `src/lib/bets/price-options.ts` — shared pure module.
2. `src/lib/odds-normalize.ts` — `normalizeOdds` (probability path only).
3. `src/app/[lang]/admin/bets/actions.ts` — server persistence
   (`repriceLiveBet` → `repriceAnswerConfigFromOdds`) + validation.
4. `src/lib/bets/write-core.ts` — pick-time payout (`writeCustomPickTx`).
5. `src/components/CustomBetCard.tsx` — player-facing preview
   (`computeDisplayPayout`) + `PayoutExplainer`.
6. `src/app/[lang]/admin/bets/BetForm.tsx` — admin form preview + build.

The probability % is only a front-end affordance; everything downstream
already runs on decimal odds stored in `decimalOddsByValue` /
`decimalOddsYes`/`decimalOddsNo`. So ratio mode reuses the same storage —
it just skips the `1/p` inversion, the renormalisation, the house edge and
the cap.

## Chosen approach

Add `pricingMode?: "probability" | "ratio"` to `MultiChoiceConfig` and
`YesNoConfig` (absent = probability = current behaviour). One shared pure
function decides the payout for a single option, read by all five sites:

```ts
liveOptionPayout(odds, stake, mode, oddsNormConfig): number
  // "probability" → normalizeOdds(odds, config).payout  (house edge + cap)
  // "ratio"       → max(round(stake × odds), stake + 1)  (exact, no edge/cap)
```

- `resolvePricingMode(config)` returns the mode (defaults to probability).
- `repriceAnswerConfigFromOdds` branches on mode (server owns the payout
  numbers; defence in depth so a tampered client payout can't be stored).
- `validateLiveOddsConfig` bounds ratio-mode odds at `MAX_MANUAL_RATIO`.
- `write-core` and `CustomBetCard` call `liveOptionPayout` instead of
  inlining `normalizeOdds`, so they pick up ratio mode automatically.

Ratios are stored raw in `decimalOddsByValue` / `decimalOddsYes`/`No`.
Grading is unchanged — it pays the per-pick `payout_snapshot` computed at
submit time, which is now ratio-aware.

### Form (BetForm.tsx)

- Per-bet toggle "הסתברות % | יחס" shown for live multi-choice / yes-no.
- Multi-choice ratio mode: each option gets a "יחס ×" input (new `ratio`
  field on the option state), independent — no renormalisation. Chip shows
  `×ratio` and `pays round(baseStake × ratio)`.
- Yes/no ratio mode: two inputs, ratio for "כן" and ratio for "לא" (both
  required), since the `1/p` complement doesn't apply.
- Edit mode seeds the ratio inputs from the stored odds directly.

### Alternatives rejected

- **Direct fixed payout per option** (type "pays 20"): conflicts with the
  variable-stake live model (player picks stake 1–30); the natural unit is
  a multiplier, not a fixed amount. The user's word was "יחס" (ratio).
- **Ratio still through house edge + cap**: the user explicitly chose no
  adjustment. Rejected per their answer.
- **Replace probability mode**: user chose keep-both.

## Security / safety

- Server re-derives every payout from the stored odds
  (`repriceAnswerConfigFromOdds`), so a tampered client payout is never
  trusted (unchanged rule-13 property, now mode-aware).
- `validateLiveOddsConfig` rejects ratio > `MAX_MANUAL_RATIO` and ≤ 1.
- Bank guards (`assertBettingAllowed`, overdraft) are stake-based and
  unchanged.
- User-bet immutability: ratio mode only affects *new* pricing on
  draft/new bets; placed picks keep their snapshot. No mutation of placed
  bets (memory: user bets are sacred).

## Observability

- `write-core` already logs `[custom-bet stake] clamped` / `no_odds_fallback`.
  No new silent branch — ratio mode flows through the same logged path.

## Settings audit

`MAX_MANUAL_RATIO` is a code constant, not a setting, by design (it's a
typo guard, not a tunable knob). If the user wants it adjustable later it
can move to `settings.liveOdds*`. Noted, intentionally not exposed now.

## Testing (rule 18)

`price-options.test.ts`:
- `liveOptionPayout` ratio: exact `round(stake × ratio)`, floor at
  `stake + 1`, no cap (large ratio not clamped), probability path
  unchanged.
- `resolvePricingMode` defaults + reads the flag.
- `repriceAnswerConfigFromOdds` ratio branch: payouts = `round(baseStake ×
  ratio)`, no cap, `pricingMode` preserved.
- `validateLiveOddsConfig` rejects ratio > MAX_MANUAL_RATIO in ratio mode,
  still accepts probability-range odds.

Manual QA: create a live multi-choice bet in ratio mode, verify the form
chip, the player card "potential win", and that a placed pick's graded
payout = `round(stake × ratio)`. Mobile widths 360/414/768.
