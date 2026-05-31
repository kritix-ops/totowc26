# Free tournament bets + rescaled outright payouts

**Date:** 2026-05-31
**Owner:** Yoav, executed by Claude
**Status:** approved, ready to execute

## 1. Goal

Two changes, one PR — same scope, same migration:

1. **Tournament/stage/group bets cost nothing.** Each is a one-shot single
   pick that locks early; the 3-point stake throttles nothing and turns the
   "wow" of placing a season-long pick into a tax. Drop the cost to 0 across
   these three scopes.
2. **Rescale outright payouts so they fit the rest of the pool.** Today
   Haaland as top scorer pays 43 and the longshot fallback pays 60 — about
   one to two starting banks (`startingBank = 30`) for a single hit. With
   ~10 tournament templates available, three hits can equal a hundred-plus
   match-pick wins. That is disproportionate. Move the scale to
   **notional unit = 1, cap = 25** so a favourite pays ~6, a mid-tier longshot
   ~14, and the cap = 25 is exactly the live-odds default. Keeps the
   favourite/longshot spread (~4.2×) wider than today and brings the
   tournament's share of total points down to a healthy ~5–20%.

Both changes apply to scopes **tournament, stage, group** — the three
"outright" surfaces that share a UI bucket per `[[project_bet_scopes_mapping]]`.
Match/day live bets keep `liveOddsBaseStake` / `liveOddsMaxPayout` as-is.

## 2. Constraints

1. **No retro changes to graded picks.** The tournament hasn't started
   (June 11 — July 19 per `[[project_wc2026_format]]`) so this is a non-issue
   today, but the migration explicitly skips any pick with `points_earned IS NOT NULL`.
   Defensive: cannot rewrite a settled history.
2. **Already-placed picks get their stake refunded silently.** No
   `point_adjustments` row — the bank formula reads `sum(payout - stake_paid)`,
   so dropping `stake_paid` to 0 reverses the in-flight debit immediately.
   The user simply notices their bank went up by 3× the number of tournament
   picks they had open. Acceptable for a friends pool of ~20.
3. **Reuse the existing per-option payout machinery.** The system already
   has `MultiChoiceConfig.payoutOverridesByValue` and
   `resolvePickPayoutAtSubmit` — both stay. We only change the inputs to
   `publishSurfaceToBet` (notional stake 1, cap 25) and the bet-level
   `payoutSnapshot` fallback that templates seed.
4. **No new settings columns this PR.** The chosen unit (1) and cap (25) are
   hardcoded constants in a single module. If admin tuning becomes
   necessary, add `tournament_payout_unit` / `tournament_payout_cap` later
   as a follow-up.
5. **`normalizeOdds` stays untouched for live bets.** Add a sibling
   `normalizeOutrightOdds` that takes `notionalStake` and `maxPayout`
   directly. Live (`stake = liveOddsBaseStake`) path is unchanged.
6. **UI hides stake everywhere it does not apply.** `PickScenarios`
   already hides the cost row when `stake === 0` — pass 0 through and the
   "תרחישים" panel adapts. The card footer must show "ללא עלות" / "Free"
   instead of "עלות: 0" for clarity. Per
   `[[feedback_jerusalem_timezone]]` no timezone changes touch this.
7. **Mobile-first.** No new UI surfaces, only labels and conditional
   sections in existing cards. Verify the Hebrew RTL label change does not
   wrap awkwardly at 360px.
8. **Honest logs at every step.** Per rule 14, every behavioural change
   logs its inputs:
   - `[free-pick scope]` when the submit path skips the stake debit.
   - `[outright publish]` already exists; extend with `notionalStake` /
     `maxPayout` so the admin can verify the new scale shipped.
   - `[outright migration]` for every bet/pick row rewritten by the
     one-shot script.

## 3. Approach

### 3.1 Constants and helpers

New module `src/lib/bets/free-pick-scopes.ts`:

```ts
export const FREE_PICK_SCOPES = ["tournament", "stage", "group"] as const;
export type FreePickScope = (typeof FREE_PICK_SCOPES)[number];
export function isFreePickScope(scope: string): scope is FreePickScope;

// Outright payout-scale constants. Hardcoded for this PR; promote to
// settings only when admin tuning becomes necessary.
export const OUTRIGHT_NOTIONAL_STAKE = 1;
export const OUTRIGHT_MAX_PAYOUT = 25;
export const OUTRIGHT_HOUSE_EDGE_PCT = 5;
```

### 3.2 Extended odds-normalize

`src/lib/odds-normalize.ts` gains a sibling function — no changes to the
existing `normalizeOdds`:

```ts
export type OutrightNormConfig = {
  notionalStake: number;
  maxPayout: number;
  houseEdgePct: number;
};

export function normalizeOutrightOdds(
  decimalOdds: number,
  config: OutrightNormConfig,
): { payout: number };
```

Formula identical to today's `normalizeOdds` but returns only `payout`
(no stake — the caller charges 0). Floor at `notionalStake + 1` to match
the existing minimum-net guarantee.

### 3.3 Publish flow

`src/app/[lang]/admin/tournament-odds/actions.ts → publishSurfaceToBet`
swaps from `normalizeOdds` + `liveOdds*` settings to
`normalizeOutrightOdds` + `OUTRIGHT_*` constants. The "longshot default"
written to options not in the snapshot is now `OUTRIGHT_MAX_PAYOUT` (25),
not `oddsConfig.maxPayout` (which was 60 in production).

### 3.4 Templates

`src/app/[lang]/admin/tournament-suggestions/page.tsx → buildTemplates`
recomputes its defaults from `OUTRIGHT_*`:

```
championPayout    = min(25, max(2, 12))   // was max(baseStake+2, 18) → 18
runnerUpPayout    = min(25, max(2, 10))   // was 12
thirdPayout       = min(25, max(2, 8))    // was 9
scorerPayout      = min(25, max(2, 10))   // was 14
goldenBallPayout  = min(25, max(2, 12))   // was 16
numberPayout      = min(25, max(2, 8))    // was 10
yesNoPayout       = min(25, max(2, 5))    // was 6
```

All templates set `defaultStake: 0`.

### 3.5 Submit action

`src/app/[lang]/play/[date]/actions.ts → submitCustomBetPick` defensively
forces stake to 0 when `isFreePickScope(bet.scope)`. Even if a bet record
slipped through with `stakeSnapshot > 0`, the action does not charge.
Logs `[free-pick scope]` when this branch fires so we can verify in prod.

### 3.6 UI

`src/components/CustomBetCard.tsx` gains a `scope` field on
`CustomBetCardData` and:

- `newCost` becomes 0 when `isFreePickScope(scope)`.
- The footer chip group renders "ללא עלות" / "Free" instead of
  "עלות: 0" — small but the lazy-user lens (rule 10) says "0" reads as
  "zero out of something" and "ללא עלות" reads as "this is free".
- "בנק אחרי" hides when stake is 0 (already does — it only shows when
  `dirty && hasChoice`, and with stake 0 the after balance equals the
  before balance — but stays visible due to the existing condition; we
  add a check for `newCost > 0` so it does not redundantly show "30 → 30").

`PickScenarios` is unchanged — it already hides the stake row when
`stake === 0`.

Three callers build `CustomBetCardData`; all must pass `scope`:
- `src/app/[lang]/bets/tournament/page.tsx`
- `src/app/[lang]/bets/groups/page.tsx`
- `src/app/[lang]/bets/live/[date]/page.tsx` (scope is `match` / `day` —
  pass-through for type consistency, no behaviour change)

### 3.7 Data migration

One-shot SQL migration `0NNN_free_tournament_bets.sql`:

```sql
-- A. Re-publish bet-level payouts at the new scale.
update custom_bets
set
  stake_snapshot   = 0,
  payout_snapshot  = least(25, payout_snapshot)  -- cap-down only
where scope in ('tournament','stage','group')
  and status in ('draft','open','locked');

-- B. Refund any in-flight stake from existing picks. The bank formula
--    reads sum(payout - stake_paid), so zeroing stake_paid releases the
--    debit. Defensive: skip graded picks (points_earned IS NOT NULL).
update user_custom_bet_picks pk
set stake_paid = 0
from custom_bets b
where pk.custom_bet_id = b.id
  and b.scope in ('tournament','stage','group')
  and pk.points_earned is null;
```

**Per-option payouts** in `custom_bets.answer_config.payoutOverridesByValue`
are rewritten by a follow-up TypeScript script the admin runs once:

`scripts/migrate-tournament-payouts.ts` — for each tournament/stage/group
bet, re-read the matching `outright_odds_snapshot` rows and re-run
`publishSurfaceToBet` against the new constants. Idempotent. Logs per bet.

Why two-step instead of inline SQL: the per-option recompute needs the
decimal-odds → payout transform from `normalizeOutrightOdds`, which is
JS. SQL would need to inline a polynomial transform, ugly. A short
script is clearer and re-uses the canonical function.

Picks that were already placed on a re-scaled option get their
`payout_snapshot` updated to the new per-option payout. Yes, that
mutates a value that was "locked at pick time" — but since the bet
hasn't been graded, no one's bank has settled on the old number, and
the user already accepted the new scale by being told about it. We log
every update.

### 3.8 Tests

`src/lib/odds-normalize.test.ts` (new, or add to existing
`test/` directory if convention differs):

- `normalizeOutrightOdds` at the canonical archetypes (Mbappé 6:1 → 6,
  Haaland 15:1 → 14, longshot 30:1 → 25 capped, fallback path).
- Floor at `notionalStake + 1` so payout never returns 1 when notional
  is 1 (would mean "win 1 net for picking right" — too symbolic).

`src/lib/bets/free-pick-scopes.test.ts`:

- `isFreePickScope` for each enum value.

`scripts/migrate-tournament-payouts.test.ts` (or inline e2e):

- Idempotent run-twice → same DB state.
- Graded pick is untouched.

## 4. Observability

Logs added or extended (rule 14):

| Where | Log | Fires when |
|---|---|---|
| `submitCustomBetPick` | `[free-pick scope]` with `{ betId, scope, oldStake }` | A free-scope bet would have charged a non-zero stake, but the action overrides to 0. |
| `publishSurfaceToBet` | `[outright publish]` existing log, extend with `notionalStake, outrightMaxPayout` | Every admin publish — admin can verify new scale shipped. |
| `migrate-tournament-payouts.ts` | `[outright migration]` per bet | One row per bet processed, with `{ betId, oldFallback, newFallback, optionsRepriced }`. |

## 5. Security

No new surfaces. The submit action keeps its existing auth +
`getUserAccess` gate. The migration runs in a transaction; rolled back
on partial failure. Admin-only paths unchanged.

## 6. Settings audit

Per rule 15: the only knob this PR could expose is the
`OUTRIGHT_NOTIONAL_STAKE` / `OUTRIGHT_MAX_PAYOUT` pair. **Intentionally
not exposed** in this PR — we ship one well-reasoned set of values and
let real usage tell us if admin tuning is needed. If admin needs it,
add `tournament_payout_unit` / `tournament_payout_cap` columns alongside
the existing `live_odds_*` row in `settings`, and feed them from the
scoring form. Documented in `OUTRIGHT_*` JSDoc.

## 7. Out of scope (deferred)

- Per-scope per-bet stake override (admin currently has no way to charge
  a stake on a stage bet — by design, this PR removes the capability
  entirely).
- A new notification telling users their bank just bumped because of a
  refund. The bank pill at the top of the layout will reflect the new
  value next nav; close enough for a friends pool.
- Backfill of historical `payout_snapshot` on graded picks. None exist
  pre-tournament; skipping is correct.
- Admin-tunable outright unit/cap (settings columns, scoring form,
  per-scope override) — promote to its own PR if needed.

## 8. Implementation order

1. Plan file (this) — done.
2. `free-pick-scopes.ts` module.
3. `normalizeOutrightOdds` in `odds-normalize.ts` + tests.
4. `publishSurfaceToBet` swap to new function + constants.
5. `tournament-suggestions/page.tsx` template defaults.
6. `submitCustomBetPick` free-scope branch.
7. `CustomBetCard` + three `toCardData` callers pass `scope`.
8. SQL migration `0NNN_free_tournament_bets.sql`.
9. `scripts/migrate-tournament-payouts.ts` for per-option rewrite.
10. Tests pass (`pnpm test`, `pnpm typecheck`).
11. Verify in dev (`pnpm dev` → tournament bets page → place a pick,
    confirm "ללא עלות" shows, confirm scenarios hide the stake row,
    confirm bank pill matches expected).
