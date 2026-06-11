# Variable Live-Bet Stake (Player-Chosen, 1–30) + Kill Daily Renewal

**Date:** 2026-06-11
**Status:** Draft — awaiting user approval before any code
**Owner:** Yoav

---

## 1. Goal

Two related changes that land together in the same PR because both
affect the live-bet bank arithmetic and would be wasteful to ship
separately:

1. **Player picks how much to risk on each live bet.**
   Today every live (`scope = match` / `day`) custom bet charges a
   single global `liveOddsBaseStake` (default 3) to every player. The
   admin can override per bet at publish time, but the player has no
   say. We move stake selection to the player: 1 to 30 points per
   bet, chosen on the bet card before submit. Payout scales with the
   chosen stake under a published ceiling so a heavy stake on a wild
   longshot cannot decide the entire tournament from one bet.

2. **Remove daily bank renewal entirely.**
   The `dailyRenewalEnabled` cron currently tops every player's bank
   up by `dailyRenewalAmount` at 00:00 Asia/Jerusalem. Variable stake
   raises the per-bet downside ceiling from -3 to -30 (whole starting
   bank in one bet) and the user has explicitly chosen ownership over
   safety net: a player who blows their bank on a stake-30 longshot
   stays at zero until they win something back. No automatic refills.

Tournament/stage/group ("free pick") scopes are not touched — they
already cost 0 and use the outright payout curve.

---

## 2. Constraints (from `~/.claude/CLAUDE.md` and project `CLAUDE.md`)

- **Verify, never guess** (rule 1): every file path, type name and
  function signature below was read this session (`odds-normalize.ts`,
  `write-core.ts`, `CustomBetCard.tsx`, `ScoringForm.tsx`, the live
  bets day page, the play-day action). No path is taken from memory.
- **Clean ordered code** (rule 2): new settings live in the existing
  "Live bets — ratios" group in `ScoringForm.tsx`; new schema column
  slots into `settings` next to the existing `liveOdds*` columns; new
  `normalizeOdds` helper extension stays in `odds-normalize.ts`; UI
  stake picker goes inside `CustomBetCard.tsx` alongside the existing
  bank-after preview so the player sees the cost change in one place.
- **Alignment before code** (rule 3): this document is the alignment.
  User confirmed in this session: option B (free-choice 1-30),
  payout cap `min(stake × 8, 100)`, no daily renewal, admin-tunable.
- **Project-style alternatives** (rule 4): three priced-cap formulas
  were considered (§4). Option 2 (`min(stake × 8, 100)`) chosen.
- **Designs not AI-generated** (rule 5): stake picker reuses the
  existing `Chip` and pill styling from `CustomBetCard`. No new
  gradients, no glassmorphism, no new component primitives.
- **Extreme QA after task** (rule 6): manual walkthrough in §11
  covers stake=1/3/10/30, edge odds (1.05, heavy longshot 50.0),
  insufficient bank, free-pick scopes (unchanged), and the live
  reveal of payout/net while toggling the stake.
- **Plan into `_plans/`** (rule 7): this file.
- **Costs** (rule 8): no third-party service involved. Pure DB +
  in-app point math.
- **Context7** (rule 9): no library API changes touched. React 19 /
  Next 16 idioms unchanged. Skip Context7 query.
- **Lazy user** (rule 10): default stake is the existing
  `liveOddsBaseStake` (3) so a player who never touches the picker
  gets the current behaviour. One tap on a pill changes the stake.
  Submit button stays the same single-tap path.
- **Council** (rule 11): scope is small (one column, one settings
  group, one card section, one server param). User has already
  committed the design path. Skip council.
- **Brutal honesty** (rule 12): real risks listed in §10. Biggest
  is that the bet card no longer stores decimal odds today, so we
  either add the column or accept arithmetic drift on existing
  in-flight bets. §5 picks the column.
- **Security** (rule 13): server clamps stake to `[liveOddsMinStake,
  liveOddsMaxStake]` regardless of what the client sends; under-stake
  rejected; over-stake clamped down (never up); the existing
  advisory-locked transaction in `writeCustomPickTx` runs the bank
  check on the clamped value so a tampered client cannot stake more
  than their bank holds. No new auth surface. No PII logged.
- **Observability** (rule 14): `[custom-bet stake]` log adds
  `userStake`, `payoutSnapshot`, `cap` so a bug report ("I picked 10
  but it charged 30") can be diagnosed from the console without DB
  access. Existing `[custom-bet rejected]` covers insufficient-bank.
- **Settings audit** (rule 15): four new admin knobs under the
  existing "Live bets — ratios" group: `liveOddsMinStake`,
  `liveOddsMaxStake`, `liveOddsMaxPayoutRatio`, `liveOddsMaxPayoutCeiling`.
  Defaults 1 / 30 / 8 / 100. `liveOddsMaxPayout` (the old single cap)
  is replaced by the ratio + ceiling pair — column kept for one
  migration cycle in case we need to roll back.
- **Clean UI** (rule 16): stake picker is a single row of 6 pills
  (1 / 3 / 5 / 10 / 20 / 30) above the submit button. Selected pill
  uses the existing primary fill. Below the row, the existing
  "bank after" line gets two siblings: "potential win" and the new
  cap badge when the cap clamps the raw payout.
- **No model loyalty** (rule 17): no AI provider involved.
- **Tests** (rule 18): unit tests added to
  `src/lib/odds-normalize.test.ts` (variable-stake formula, cap
  behaviour at the corners, free-pick scopes untouched) and to
  `src/lib/bets/write-core.test.ts` if present, or a new
  `write-core.variable-stake.test.ts` (clamp at submit, refund on
  re-submit, free-pick scope ignores stake). Existing
  `bet-immutability.test.ts` invariants verified to still hold.

---

## 3. Requirements

| # | Requirement                                                                                     | How verified                              |
|---|-------------------------------------------------------------------------------------------------|-------------------------------------------|
| 1 | Live (match/day) bets accept a player-chosen stake in `[1, 30]`.                                | Unit test + manual on `/bets/live/[date]` |
| 2 | Submitting without picking a stake uses the current default (3).                                | Unit test + manual                        |
| 3 | Payout = `round(stake × odds × (1 − edge%))` capped at `min(stake × 8, 100)`, floored at stake+1. | Unit test corners                         |
| 4 | Server clamps stake server-side; tampered client cannot exceed `[min, max]`.                    | `write-core` test sending stake=999       |
| 5 | Bank check (in advisory-locked transaction) sees the user-chosen stake.                         | `write-core` test, refund-on-resubmit     |
| 6 | Free-pick scopes (tournament/stage/group) ignore stake entirely (still cost 0).                 | Unit test + manual                        |
| 7 | Daily renewal cron and its admin toggle are removed from runtime behaviour.                     | Cron does nothing; toggle disabled in UI  |
| 8 | Admin can change all four new knobs in `/admin/settings/scoring`.                               | Manual on settings page                   |
| 9 | Existing in-flight live bets keep working without admin intervention.                           | Migration backfills decimal_odds          |

---

## 4. Alternatives considered

Three ways to translate the player's stake choice into payout:

### Option 1 — Fixed ratio (no absolute ceiling)
`payoutCap = stake × 8`. At stake=30, odds=10.0, payout=240, net win
+210. Rejected: one bet can decide the entire tournament against a
starting bank of 30.

### Option 2 — Ratio + absolute ceiling — **CHOSEN**
`payoutCap = min(stake × 8, 100)`. Small stakes keep the current
8x multiplier; big stakes hit the 100-point ceiling. At stake=30 the
max net win is +70 (good) and max net loss is -30 (the chosen stake).
Risk/reward narrows for high stakes (2.33:1) and widens for low
stakes (7:1 at stake=3) — naturally encourages a mix.

### Option 3 — Lower fixed ratio (5x), no ceiling
`payoutCap = stake × 5`. Simpler but punishes small stakes too: at
stake=3, odds=10 the payout caps at 15 (today=25), net win drops
from +22 to +12 across the board. Rejected: changes the feel of
every existing bet, not just the new high-stake ones.

### Pricing storage — store `decimal_odds` on the bet
The bet already snapshots `stakeSnapshot` and `payoutSnapshot` at
publish, but **not** the underlying `decimalOdds` — `normalizeOdds`
collapses both into the integer pair. To recompute payout for a
different user stake exactly, we need the odds back. Two paths:

- **Store `decimal_odds NUMERIC(6,2)` on the bet.** Exact
  recomputation per user submit. One column. Backfill from existing
  rows via `(payoutSnapshot / stakeSnapshot) / (1 − edge%)` — close
  enough for in-flight bets.
- **Scale the integer payout linearly:** `userPayout =
  payoutSnapshot × userStake / baseStake`. Approximate, drifts by up
  to 3-4 points at stake=30 due to integer rounding, and ties the
  new behaviour to the legacy snapshot fields forever.

Going with the column — the precision matters and the migration is
cheap.

---

## 5. Data model

### `settings` table (column changes)

```
-- new
ALTER TABLE settings
  ADD COLUMN live_odds_min_stake          smallint NOT NULL DEFAULT 1,
  ADD COLUMN live_odds_max_stake          smallint NOT NULL DEFAULT 30,
  ADD COLUMN live_odds_max_payout_ratio   smallint NOT NULL DEFAULT 8,
  ADD COLUMN live_odds_max_payout_ceiling smallint NOT NULL DEFAULT 100;

-- defaults explicitly turn renewal off (keeping column for one
-- migration cycle in case we want to re-enable)
UPDATE settings
   SET daily_renewal_enabled = false
 WHERE id = 1;

-- the old single-value cap (`live_odds_max_payout`) becomes unused
-- by the live path. Keeping the column NOT NULL with its current
-- default (25) so we can roll back the formula without a second
-- migration if the new caps misbehave in week 1.

ALTER TABLE settings ADD CONSTRAINT live_odds_stake_range
  CHECK (live_odds_min_stake >= 1 AND live_odds_max_stake <= 100
         AND live_odds_min_stake <= live_odds_max_stake);

ALTER TABLE settings ADD CONSTRAINT live_odds_payout_caps
  CHECK (live_odds_max_payout_ratio >= 1
         AND live_odds_max_payout_ceiling >= live_odds_max_payout_ratio);
```

### `custom_bets` table (one new column)

```
ALTER TABLE custom_bets
  ADD COLUMN decimal_odds numeric(6,2) NULL;

-- Backfill for existing live bets only; free-pick scopes stay NULL.
UPDATE custom_bets
   SET decimal_odds = ROUND(
         (payout_snapshot::numeric / NULLIF(stake_snapshot, 0)) /
         ((100 - (SELECT live_odds_house_edge_pct FROM settings WHERE id = 1)) / 100.0),
         2)
 WHERE scope IN ('match', 'day')
   AND decimal_odds IS NULL
   AND stake_snapshot > 0;
```

### `user_custom_bet_picks` table

No schema change. The existing `stake_paid` and `payout_snapshot`
columns already store per-pick values; we just write player-chosen
numbers into them instead of the bet-level snapshot.

---

## 6. Server flow changes

### `src/lib/odds-normalize.ts`

`normalizeOdds` already takes `baseStake` as a config field. We
extend the existing function — no new function — by passing the
player's chosen stake as `baseStake` at submit time. The internal
`computeOddsPayout` helper stays as-is.

One small addition: a helper that computes the effective per-stake
cap so both server and client can render the same number.

```ts
export function liveStakeCap(
  stake: number,
  config: { maxPayoutRatio: number; maxPayoutCeiling: number },
): number {
  return Math.min(stake * config.maxPayoutRatio, config.maxPayoutCeiling);
}
```

### `src/lib/bets/write-core.ts` — `writeCustomPickTx`

Replace the line `const effectiveStake = isFreePick ? 0 : bet.stakeSnapshot;`
with a function that resolves the stake honoring the player choice
and the settings clamp. Live (match/day) only; free picks stay 0.

```ts
function resolveLiveStake(
  requestedStake: number | undefined,
  bet: { stakeSnapshot: number; decimalOdds: number | null },
  settings: { minStake: number; maxStake: number; baseStake: number },
): { stake: number; rejected: false } | { rejected: true; reason: "no_odds" } {
  if (bet.decimalOdds == null) return { rejected: true, reason: "no_odds" };
  const fallback = bet.stakeSnapshot || settings.baseStake;
  const requested = Number.isFinite(requestedStake) ? Math.floor(requestedStake!) : fallback;
  const clamped = Math.max(settings.minStake, Math.min(settings.maxStake, requested));
  return { stake: clamped, rejected: false };
}
```

After resolving the stake, recompute the user-specific payout
fresh from `decimal_odds`:

```ts
const { stake } = normalizeOdds(bet.decimalOdds, {
  baseStake: resolvedStake,
  maxPayout: liveStakeCap(resolvedStake, settings),
  houseEdgePct: settings.houseEdgePct,
});
```

`stake_paid` and `payout_snapshot` on the pick get the per-user
values; bet-level `stake_snapshot` / `payout_snapshot` are untouched.

### `src/app/[lang]/play/[date]/actions.ts` — `submitCustomBetPick`

Adds an optional third argument `stake?: number`. Free picks ignore
it. Live picks send it through to `writeCustomPick`. Old callers
(if any survive) pass undefined and get the default.

### `src/app/[lang]/bets/random-actions.ts`, monkey bot, deadline auto-fill

All three currently use the bet's `stakeSnapshot` as the cost. We
keep that behaviour — "Surprise me" and the bot stake the default,
not the player's choice (the player did not choose). The deadline
auto-fill also stakes default. Explicitly noted so a future caller
doesn't accidentally pass `userStake` into a bulk path.

---

## 7. UI changes — mobile-first

### `src/components/CustomBetCard.tsx`

Adds a stake picker between the answer widget and the submit row.
Only renders for live (match/day) scope; free picks render the
existing "ללא עלות" badge unchanged.

Layout (mobile):

```
┌─ Question / scope / lock countdown ────────────────┐
│ ...existing header...                              │
├─ Answer widget (yes/no / picker / etc.) ───────────┤
│ ...existing widget...                              │
├─ Stake picker (NEW, live scope only) ──────────────┤
│ כמה לסכן?                                          │
│ [ 1 ] [ 3* ] [ 5 ] [ 10 ] [ 20 ] [ 30 ]            │
│                                                    │
│ סיכון:  -10   זכייה אפשרית:  +9   (max +70)        │
├─ Bank-after line (existing, recalculated) ─────────┤
│ ...                                                │
├─ Submit button (existing) ─────────────────────────┤
└────────────────────────────────────────────────────┘
```

Six pills, each a Chip with `min-h-11 min-w-11 px-3` so the
44×44 touch-target rule holds at 360px. Selected pill uses
`bg-primary text-on-primary`; unselected uses the existing chip
look. The `*` marks the default (current `liveOddsBaseStake`) so a
player can tell which is the "house default" pick.

Selecting a stake immediately updates the inline "סיכון / זכייה
אפשרית" line via a pure client-side `liveStakeCap` + payout calc —
matches the server computation byte-for-byte, no round trip. The
existing `bank-after` line picks up the new stake too.

Below `md` breakpoint the row of 6 pills fits in 360px because
each pill is ~50px wide with `gap-2`. At very-low odds the
"potential win" can read +1 (floor) — that's correct, just shown.

### `src/app/[lang]/admin/settings/scoring/ScoringForm.tsx`

The existing "Live bets — ratios" group gets the four new fields
inserted right under `liveOddsBaseStake`. Order: min stake, base
stake (existing), max stake, ratio, ceiling, house edge (existing).
Hints in Hebrew + English explain the formula.

The `dailyRenewalEnabled` toggle stays in the "Daily renewal"
group but ships with default `false` and a permanent hint:
"ההתחדשות מבוטלת בטורניר הנוכחי. אם תפעיל את זה, נקודות יחולקו
חזרה כל יום בחצות." (Not removed because we may revive it for the
next tournament; just defaulted off and visually demoted.)

---

## 8. Settings audit (rule 15)

| Setting                            | Default | Admin-editable | Notes |
|------------------------------------|--------:|:--------------:|-------|
| `liveOddsMinStake`                 |       1 | ✔              | New |
| `liveOddsBaseStake` (existing)     |       3 | ✔              | Now the suggested-default pill |
| `liveOddsMaxStake`                 |      30 | ✔              | New |
| `liveOddsMaxPayoutRatio`           |       8 | ✔              | New, replaces single `maxPayout` cap |
| `liveOddsMaxPayoutCeiling`         |     100 | ✔              | New |
| `liveOddsMaxPayout` (legacy)       |      25 | ✔ (hidden)     | Kept one cycle for rollback |
| `liveOddsHouseEdgePct` (existing)  |       5 | ✔              | Unchanged |
| `dailyRenewalEnabled` (existing)   |   false | ✔              | Forced off; toggle remains for future tournaments |
| `dailyRenewalAmount` (existing)    |       5 | ✔              | Inactive while toggle off |

---

## 9. Observability (rule 14)

New log lines (PowerShell-friendly, namespaced, value-bearing):

- `[custom-bet stake] resolved` at the start of every live submit:
  ```ts
  console.info("[custom-bet stake] resolved", {
    userId, betId, requestedStake, clampedStake, decimalOdds,
    payoutSnapshot, cap,
  });
  ```
- `[custom-bet stake] clamped` only when `requested !== clamped`,
  so a quick grep catches client-side tampering.
- `[custom-bet stake] no_odds` warn-level if a live bet has
  `decimal_odds = NULL` at submit time (a backfill miss or a buggy
  publish path). Falls back to `stakeSnapshot` + `payoutSnapshot`
  for that one submit to keep the player unblocked.

Existing `[custom-bet stake]` info log at `actions.ts:43` extends
its body with `userStake` and `payoutSnapshot` — same key, no new
namespace, so the existing dashboard filter still picks it up.

---

## 10. Risks + how we handle them

1. **In-flight bets without `decimal_odds`.** Backfill runs in the
   migration; if any row still has NULL at runtime, the fallback in
   §9 keeps the user unblocked at the legacy fixed-stake price. We
   log it loudly.
2. **A player stakes 30, loses, can't bet live for the rest of the
   day.** Intended — confirmed by the user. The empty-bank empty
   state on `/bets/live` already exists and tells the player their
   bank is empty.
3. **`Surprise me` and the monkey bot still stake the default (3).**
   Documented in §6 so a future change touches both deliberately.
4. **Variance jump.** Worst case: a player wins 100 in one bet
   (≈3.3× starting bank). Acceptable for a friends pool; bigger
   than today's 25-point cap (≈0.83× starting bank). Admin can
   lower `liveOddsMaxPayoutCeiling` mid-tournament if it feels
   skewed — change applies to new submits only (snapshot
   invariant — [[feedback_user_bets_are_sacred]]).
5. **Sandbox parity.** Setting columns ship in the same migration
   number on both envs. The sandbox push-to-prod settings button
   (see [[project_sandbox_push_to_prod_flow]]) does column-diff so
   the four new keys flow through cleanly.

---

## 11. Manual QA checklist

Run after the code lands, before declaring done (rule 6 + rule 18):

- [ ] `/bets/live/[date]` at 360px / 414px / 768px / 1024px / 1440px.
      Stake row shows 6 pills, no horizontal scroll, default pill
      visually marked.
- [ ] Tap each stake pill — "potential win" + bank-after numbers
      update instantly without a server call.
- [ ] Submit at stake=10 — DB row has `stake_paid=10`, payout
      matches `normalizeOdds(decimalOdds, {baseStake: 10, ...})`.
- [ ] Submit at stake=30 on a longshot (odds≥10) — payout caps at
      100, net win = +70, bank drops by exactly 30.
- [ ] Submit at stake=1 — payout floors at 2 (stake+1).
- [ ] Resubmit the same bet at a different stake — old stake
      refunded, new stake charged, only one row in the picks table.
- [ ] Tournament/stage/group bet card — stake picker not rendered,
      free-pick badge unchanged.
- [ ] Tamper test: hand-edit the client request to stake=999 — server
      clamps to 30, logs `[custom-bet stake] clamped`.
- [ ] Bank check: try stake=30 with bank=10 — rejected
      `insufficient_bank` with `needed=20`.
- [ ] Admin `/admin/settings/scoring` — adjust max stake to 20, save,
      reload bet card, top pill disappears.
- [ ] Wait through 00:00 Asia/Jerusalem — no daily-renewal audit row
      in `point_adjustments`.

---

## 12. Open questions

- **Mid-tournament rollout.** Do we want to gate this behind a
  feature flag, or just ship it Wednesday once approved? Default
  answer: ship it (user prefers fewer moving parts).
- **Backfill of `decimal_odds` precision.** The reverse formula
  `(payout / stake) / (1 - edge%)` rounds back to ~0.05 of the
  original odds. Good enough for in-flight bets; new bets store
  the real value at publish.

---

## 13. Out of scope

- Repricing the four "Custom-bet defaults" stakes for non-live
  authored bets — unchanged.
- Sandbox migration push button updates — no change needed; the
  existing column-diff handles new keys.
- Reworking the tournament/group ("free pick") flow — unchanged.
- Removing the `dailyRenewalEnabled` column / cron entirely.
  Defaulted off, kept in code for the next tournament.
