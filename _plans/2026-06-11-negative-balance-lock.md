# Negative-balance lock for live bets and duels

**Date:** 2026-06-11
**Status:** Awaiting approval

## Goal

Allow a single live-bet or duel placement to push a participant's bank into negative
territory (capped), and lock that participant out of further live-bet / duel
placements until they recover their bank to non-negative through other means
(match picks, tournament bets, group rankings, admin adjustments).

## Alignment captured with user

- **Lock scope** — both opening a new duel AND joining someone else's open duel
  are blocked while balance < 0. Same for live bet placement.
- **Overdraft cap** — `-30`. A bet may push the bank to at most `-30`. Stored in
  `settings.max_overdraft` so it's tunable from `/admin/settings`.
- **Free bets stay open while negative** — match picks, tournament, and group
  rankings remain placeable. They are the "other means" through which a player
  digs out of the hole.

## Chosen approach

Introduce a single placement guard, `assertBettingAllowed`, used by every
stake-bearing placement path. The guard enforces two rules:

1. **No new bets while already negative.** If current bank balance is `< 0`,
   reject with `negative_balance_locked`. The user can recover via free bets
   or an admin adjustment.
2. **Overdraft cap on the placing bet.** If `balance - stake < -maxOverdraft`,
   reject with `overdraft_exceeded`. This caps any single bet's blast radius.

Both checks run inside the existing serializable transaction with the per-user
advisory lock, so two tabs cannot race past the guard.

A new feature flag `settings.lock_bets_when_negative` (default `true`) gates the
whole behavior — if off, the system reverts to today's strict `balance >= stake`
rule. This is the safety kill-switch.

## Rejected alternatives

- **Unlimited overdraft** — user rejected. Too easy for a single 9999-stake
  duel on an autopay-style mistake to bury someone.
- **Hardcoded `-30` cap (no setting)** — user rejected. Friends pool is small,
  tuning the cap mid-season is realistic, and rule 15 says new behavior needs
  a settings audit.
- **Lock applies to free bets too** — user rejected. Then players can't recover
  at all; the feature becomes a permanent ban.

## Implementation

### Schema / migration

Migration `0048_negative_balance_lock.sql` adds two columns to `settings`:

```sql
alter table public.settings
  add column max_overdraft int not null default 30,
  add column lock_bets_when_negative boolean not null default true;
```

Both have safe defaults so existing rows do not require backfill.

### `src/lib/bank.ts`

Add an exported helper:

```ts
export type BettingGuardResult =
  | { ok: true }
  | { ok: false; reason: "negative_balance_locked"; balance: number }
  | { ok: false; reason: "overdraft_exceeded"; balance: number; cap: number };

export function assertBettingAllowed(opts: {
  balance: number;
  stake: number;
  maxOverdraft: number;
  lockWhenNegative: boolean;
}): BettingGuardResult;
```

Pure function — testable in isolation.

Also extend `getStakeConfig` (and add a sibling `getOverdraftConfig` if cleaner)
to read the two new settings columns.

### `src/lib/bets/write-core.ts:367-377`

Replace the `if (needed > 0) return { status: "skipped", reason: "unaffordable" }`
block with a call to `assertBettingAllowed`. Add new `SkipReason` variants
`negative_balance_locked` and `overdraft_exceeded`. Return the relevant one
with `needed` (cap or magnitude of negative balance, depending) so the UI can
explain.

### `src/app/[lang]/duels/actions.ts`

- `openDuel` (~222): replace `if (balance < input.stake)` with the guard.
- `joinDuel` (~334): replace `if (balance < d.stake)` with the guard.

Extend `DuelErr` union with `negative_balance_locked` and `overdraft_exceeded`
so action results can carry the specific reason to the UI.

### UI

**Bank pill (`src/components/AppShell.tsx` or wherever the pill renders)** —
when balance < 0, render the number in error color with a small "נעול ללייב/דו-קרב"
chip. Tap → modal with the explanation.

**`/duels/new`** — when the viewer is locked, render the form in a disabled
state with a banner: "אתה במינוס של X נקודות. תוכל לפתוח דו-קרבים שוב כשתחזור ל-0.
בינתיים: ניחושי משחקים, טורניר, ובתים — פתוחים." Disable the submit button.

**`/duels/[id]` (join button)** — when locked and the duel is still open,
the join button is disabled with the same banner above.

**`/bets/live/[date]` and the bet cards** — same lock state visualization on
the card's submit button, with a tooltip / inline explanation.

**Error toasts** — `negative_balance_locked` → "אתה במינוס, ניחושים חינמיים
יחזירו אותך לפלוס". `overdraft_exceeded` → "ההימור הזה היה לוקח אותך למינוס
עמוק מ-30 נקודות".

### Dictionaries

Add to both `he.json` and `en.json`:

- `bets.locked.title` — "נעול בגלל מינוס" / "Locked: negative balance"
- `bets.locked.body` — explanation
- `bets.locked.recoverCta` — "להימורים החינמיים" / "Go to free picks"
- `bets.overdraftExceeded` — "מקסימום מינוס: {cap}" / "Max overdraft: {cap}"

### Settings page

The existing `/admin/settings/scoring` page is actually the consolidated
"ניקוד ובנק נקודות" hub — it already owns `startingBank`, `duelMaxStake`,
`duelDailyLimit`, `liveOdds*`, etc. So the two new knobs land there as a new
sub-section "כללי בנק / Bank rules", grouped right after the duel limits.

- Lock when negative — toggle
- Max overdraft — number input (0–500)

Both with help text explaining the math. One page = one place to tune the bank.

## Security & safety (rule 13)

- All three placement paths already hold a per-user advisory lock + serializable
  transaction. The new guard fits inside that lock so it cannot be raced.
- The two new settings are admin-only writes (existing settings page is
  admin-only).
- The kill-switch (`lock_bets_when_negative=false`) reverts to today's behavior
  in case the new logic misbehaves in production.
- No PII or secrets touched.
- Admin overrides (admin placing on behalf of a user) bypass the guard but are
  already logged with `lock_bypassed=true, reason=...` per `write-core.ts:566`.
  We extend the reason to mention negative-lock bypass where relevant.

## Observability (rule 14)

- Log every guard rejection at the placement path:
  `console.info("[bets guard] negative_balance_locked", { userId, balance })`
  `console.info("[bets guard] overdraft_exceeded", { userId, balance, stake, cap })`
- Log every guard PASS that left the user in a new negative state:
  `console.info("[bets guard] overdraft_taken", { userId, balanceBefore, balanceAfter, cap })`
- Admin bypass: log with `[bets guard admin-bypass]` namespace.

## Settings audit (rule 15)

Two new knobs land in admin settings:
- `lockBetsWhenNegative` — default `true`. Toggle to revert the whole feature.
- `maxOverdraft` — default `30`. Tunable cap.

Intentionally NOT exposed:
- Per-user overrides — the cap is the same for everyone in a friends pool.
- Per-scope cap (e.g., live vs duel) — keep it one number until we see a real
  need.

## Testing (rule 18)

New unit tests in `src/lib/bank.test.ts`:

- `assertBettingAllowed` cases:
  - balance > 0, stake within cap → ok
  - balance > 0, stake > balance but `balance - stake >= -cap` → ok
  - balance > 0, stake > balance and `balance - stake < -cap` → overdraft_exceeded
  - balance = 0, any stake within cap → ok
  - balance < 0 → negative_balance_locked
  - `lockWhenNegative=false` and balance < 0 → falls back to overdraft check
  - cap = 0 → mirrors today's behavior

Update / extend existing integration tests:
- `bet-immutability.test.ts` — confirm placed bets are still immutable even
  when the placer is later locked.
- A new integration test for `openDuel` / `joinDuel` covering all three
  outcomes (ok, negative_locked, overdraft_exceeded) using a real test DB.

Run the full suite before declaring done.

## Migration / rollout

- Migration applies safely with defaults.
- No data backfill needed.
- Feature is on by default (`lock_bets_when_negative=true`); set to `false`
  via SQL or admin UI as a kill-switch.
- Push to sandbox first, smoke-test the three paths, then push to master.

## Out of scope

- Surprise Me / auto-fill — only touches match picks, which are free.
- Monkey bets (random tournament picks) — same, free.
- Leaderboard formatting of negative totals — already negative-capable; verify
  with a quick visual check, no design change planned.
- Recovery notifications — could ping a user when they cross back to 0, but
  that's a follow-up.

## Open questions

- Should joining an already-matched duel be impossible (logically it can't
  happen — matched means joiner exists)? Confirm in code that `joinDuel` rejects
  non-open duels upstream of the bank check. **Pre-flight:** verify on read.

## Memory updates (post-ship)

- Update `project_points_model.md`: total can now be negative; "available for
  live/duel" depends on lock state.
- Add a new project memory describing the lock for future sessions.
