# Edit odds on a published live bet (re-price all picks)

Date: 2026-06-24
Surface: `/[lang]/admin/bets` (live bets), the bet detail page, a new edit-odds form

## Goal

Let an admin fix the odds (יחסים) of a live bet that is already **published**
("open") and may already have picks, instead of the current only option
(cancel + recreate). The trigger: a real mistake in a live market's odds caught
after publish.

## Confirmed decisions (with the user)

- Build the feature (don't just cancel+recreate this one bet).
- **Re-price ALL existing picks** to the corrected odds — one fair line for
  everyone, with a notification. (User chose this over snapshot-respecting.)

## Why this is delicate (the invariant)

Pick payouts are **snapshotted** at pick time (`user_custom_bet_picks.payout_snapshot`)
and grading reads the snapshot, never recomputing. The `bet-immutability` test
enforces that no *automated* path silently mutates a placed pick. So:
- A naive "edit odds" would only affect *future* picks → two-tier payouts.
- Re-pricing existing picks is a deliberate, **explicit, audited, admin-initiated**
  correction — the same shape as the sanctioned self-backdate exception, not a
  silent automated mutation. That keeps the invariant's intent intact.

## Guards (hard)

1. Permission `liveBets` (same as every other bet action).
2. Status must be **`open`**. Not draft (use the existing edit page), not
   `locked`/`graded`/`reversed`/`cancelled`.
3. Scope must be **`match` or `day`** (live family — the only scopes with odds).
4. **Before lock**: `now < lockAt`. Never re-price after players can no longer
   react. Enforced in the action AND in the `UPDATE ... WHERE status='open' AND
   lock_at > now()` so a race that locked meanwhile aborts (0 rows → abort txn).
5. **Reason required** (non-empty), like void/grade.
6. **Odds-only**: this flow edits per-option decimal odds (the ×N the card
   shows) — `decimalOddsByValue` (multi_choice) / `decimalOddsYes/No` (yes_no) /
   bet-level `decimal_odds`. It does NOT change the question, options, scope, or
   answer type (that's a different contract → cancel+recreate). `pricingMode`
   (ratio vs probability) is preserved.

## Mechanics

### Shared payout helper (parity guarantee)
Extract the live-pick payout computation from `writeCustomPickTx` (write-core.ts
lines ~455-496) into an exported pure `computeLivePickPayout({answerType,
answerConfig, betLevelDecimalOdds, betStakeSnapshot, betPayoutSnapshot, answer,
stake, liveCfg})`. Refactor the submit path to call it, and the re-price path to
call it with the NEW config + each pick's stored `stakePaid`. One definition →
existing and future picks priced byte-for-byte the same.

### New action `repriceLiveBetOdds(id, newOdds, reason)`
1. Auth + `liveBets`; validate reason; load bet (status, scope, lockAt,
   answerType, answerConfig, decimalOdds, stake/payout snapshots).
2. Guard checks (above). Overlay new odds onto existing answerConfig (keep
   options/labels/pricingMode). `validateLiveOddsConfig` (reuses >1 + ratio
   MAX_MANUAL_RATIO=100 anti-typo guard).
3. `repriceAnswerConfigFromOdds(newConfig, loadLivePricingConfig())` → new
   payout maps + bet-level maxPayout.
4. One transaction:
   a. `UPDATE custom_bets SET answer_config, stake_snapshot, payout_snapshot,
      decimal_odds, updated_at WHERE id AND status='open' AND lock_at > now()`.
      0 rows → throw → rollback (lost a race).
   b. Load all picks (id, userId, answer, stakePaid); load `liveCfg`.
   c. For each pick: `payout_snapshot = computeLivePickPayout(... new config ...,
      stake: pick.stakePaid)`. Bulk update.
   d. Insert ONE `bet_odds_audit` row (before/after odds, affected count, reason,
      performedBy).
5. Notify the affected pickers via `notifyUsers` (feed row; push optional) that
   the odds were corrected, with the bet link.
6. `revalidatePath` list + detail; return `{ ok, affected }`.

### New audit table `bet_odds_audit` (migration)
Mirror `match_status_audit` (0064): `id, custom_bet_id FK, before jsonb, after
jsonb, affected_picks int, reason text NOT NULL (CHECK non-empty), performed_by
FK, performed_at`. Indexes on (bet, time) and (time). RLS: admin read + admin
insert (performed_by = auth.uid()); `REVOKE UPDATE, DELETE` from authenticated/
anon (append-only). Added to schema.ts; `drizzle-kit generate` writes the base
migration + journal/snapshot, then hand-append the CHECK/indexes/RLS/REVOKE.
**Low-risk migration: new table only, no ALTER on hot tables.**

### UI
- On the published live bet (list card + detail page), an **"ערוך יחסים"**
  action (only shown when status=open && scope live && now<lockAt).
- A focused edit-odds form (not the full BetForm): one row per option showing its
  current ×N with an input for the new ×N, a **required reason** field, and a
  confirm step that previews **before → after** per option, the **new max
  payout**, and **"N players already picked — their payout will be recomputed."**
- 48px inputs, font-size 16px (no iOS zoom), single column on mobile, RTL.

## Security (rule 13)
- Server-side permission + status + lock + scope + reason guards; the DB
  `WHERE status='open' AND lock_at>now()` is the race backstop.
- Odds validated (`validateLiveOddsConfig`) before persist; payouts recomputed
  server-side from trusted odds, never from a client-sent payout.
- Append-only audit (REVOKE UPDATE/DELETE) — a correction is a new row.

## Observability (rule 14)
- `[bet reprice]` log: betId, before/after odds, affectedPicks, by.
- Per-guard rejection logs (forbidden / wrong_status / locked / bad_odds).
- `notifyUsers` already logs `[notify insert]`.

## Testing (rule 18)
- `computeLivePickPayout` parity: same inputs as the submit path produce the
  same number (golden values for ratio + probability modes, the fallback branch).
- Re-price math: a pick at old odds X re-prices to the expected payout at new
  odds Y for its chosen option, across multi_choice + yes_no.
- Guard unit tests: rejects draft/locked/graded, rejects scope!=live, rejects
  past-lock, rejects empty reason, rejects odds<=1 / ratio>100.
- Run the full suite (incl. `bet-immutability.test.ts`) green before done.

## Settings audit (rule 15)
No new setting. The reason field + confirm preview are per-action, not a global
toggle. Notification rides the existing live-bet notification kind.

## Out of scope
- Editing question/options/scope/answer-type on a published bet (cancel+recreate).
- Editing after lock or on locked/graded bets.
- Duels and free-pick (tournament/stage/group) scopes — no live odds.
```
