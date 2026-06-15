# Show live-bet ratios up front (site + admin)

Date: 2026-06-14
Status: implemented

## Goal

In live (match/day) bets, the per-option multiplier (×N) is only visible
after a user selects an option. Both the managing team and end users
reported they cannot find "the ratio". Surface the ×N next to every option
up front, so a red-card market reads "כן ×4 / לא ×2" without any tap —
exactly as the team's own WhatsApp suggestion ("כן (x4) / לא (x2)").

Scope: live bets only (scope `match`/`day`, the configs that carry
`decimalOddsByValue` / `decimalOddsYes`/`decimalOddsNo`). Free-pick
tournament/stage/group bets are unchanged.

## What number we show

The stored decimal odds (`decimalOddsByValue` / `decimalOddsYes`/`No`).
- Ratio mode (the dominant live mode): the stored value IS the exact
  multiplier — `payout = stake × ratio`. ×N is precisely what the player
  wins. No discrepancy.
- Probability mode (grouped exotic markets): the stored value is the fair
  odds the market was priced at — the same ×N the admin form already shows.
  Actual net payout is slightly lower (house edge), but the precise amount
  is still shown in the existing payout scenarios after the user stakes.
  Showing decimal odds keeps site ↔ admin identical and matches standard
  bookmaker "odds vs returns" convention.

This is intentionally the SAME value the admin BetForm `×N` chip already
renders, so every surface agrees.

## Changes

1. `src/lib/bets/price-options.ts`
   - `liveDisplayRatios(config)` — pure helper returning per-side / per-value
     ratios for a live config, or null when none exist.
   - `formatLiveRatio(odds)` — formats a decimal as `×4` / `×2.5`, rounded
     to 2 dp, "" for non-finite.

2. `src/components/CustomBetCard.tsx` (user-facing card)
   - New `PillContent` (label + ×N badge, inherits pill text colour at 70%
     opacity, `dir="ltr"` so ×N reads correctly inside Hebrew RTL).
   - Yes/No and static multi-choice pills now render the ×N badge.
   - Live multi-choice over the searchable threshold splices ×N into each
     option's subtitle inside the picker.

3. `src/db/admin-queries.ts`
   - `listCustomBets` now selects `answer_config` and `AdminCustomBetRow`
     carries `answerConfig: unknown`.

4. `src/app/[lang]/admin/bets/page.tsx` (admin list)
   - `liveRatioRows()` flattens a live config to `{label, ratio}` rows.
   - `BetCard` renders a "יחסים / Ratios" chip row for live bets.

## Testing

- `src/lib/bets/price-options.test.ts`: added `liveDisplayRatios` (yes/no,
  multi-choice, partial odds, invalid-entry filtering, null cases) and
  `formatLiveRatio` (integer, fractional, float rounding, non-finite).
- `vitest run` green (45), `tsc --noEmit` clean, `eslint` clean.

## Out of scope / notes

- Logic is pure presentation of an already-stored value; no payout math
  changed, no bet records touched.
- `AdminDuplicateBetRow` extends `AdminCustomBetRow` but its CTE does not
  select `answer_config`; the duplicates page uses `DuplicateRow` (not
  `BetCard`) and does not show ratios, so it is unaffected.
- Probability-mode badge shows fair odds, not edge-adjusted net — flagged
  to the user as a deliberate choice; can switch to effective multiplier if
  preferred.
