# 2026-06-12 - House-edge refund + custom-option duels + auto-translate

## Goals
Three fixes bundled in a single PR per user direction (council not required;
user explicitly approved the bundle and recommended option for each axis):

1. **Remove the 5% house edge retroactively.** The setting was already
   flipped to 0% at 12/06 21:46, but pending picks (122 rows) and
   already-paid winners (46 rows) still carry the 5%-trimmed payouts.
2. **Duels with free-form options + per-option payout multipliers** in
   place of the hard-coded yes/no + 1:1 model. Each option carries its
   own multiplier; the winner's pick determines the net delta.
3. **Hebrew -> English auto-translation** for the manual bet/duel
   creation flows (currently the admin/opener has to type both copies).

## Constraints
- No direct commits to master (per memory
  `project_master_auto_deploy_regression`). All work lands on `sandbox`,
  pushed to prod via the `/he/admin/sandbox` UI when the user is ready.
- Existing user bets are sacred (per memory
  `feedback_user_bets_are_sacred`). The 5% refund updates pending pick
  snapshots (their pre-grading payout, still owned by the bet author
  semantically since they haven't earned anything yet) AND issues new
  `point_adjustments` rows for graded winners. We never touch
  `points_earned` directly on a graded pick - the adjustment row is
  additive and audit-traceable.
- Asia/Jerusalem timezone for every user-facing timestamp (memory
  `feedback_jerusalem_timezone`).
- Mobile-first, 360px floor, 44x44 touch targets (project CLAUDE.md).
- Auto-grade source for duels stays inside the existing
  `auto_api_football` envelope so we don't fork the grader.

## Goals/Constraints/Requirements alignment

- **Goal**: 5% off everywhere AND retroactive refund. Customisable duels.
  Less translation friction.
- **Constraints**: small friends pool, points are in-game currency, not
  money. Risk of breaking existing duels is high - must keep legacy
  yes/no duels working unchanged.
- **Requirements**: every change observable (logs), tested (units), and
  reversible (no destructive schema work).

## Architecture overview

### Part 1 - House-edge refund

#### What was found (verified against live DB)

- `settings.liveOddsHouseEdgePct = 0` (updated 12/06/2026 21:46).
- `custom_bets` rows scoped to `match` or `day`:
  4 open, 9 locked (-> 13 pending), 10 graded, 7 cancelled, 3 draft.
- All 13 pending live bets carry per-option / per-side odds we can
  recompute against (`decimalOddsByValue` on 8 multi-choice, side
  odds on 5 yes/no).
- 46 winners on graded live bets were paid with 5% off
  (range 11/06 14:22 -> 12/06 03:28). Total paid: 368, total stake: 182.

#### Real impact

Most small-stake picks (stake=1/3 with odds<=3) hit the same
`floor(notional * odds * 0.95 + 0.5)` integer as the 0% formula, so
no actual loss. The deltas show up on high-stake bets:

  - stake=30, odds=2 -> paid 57, should be 60 (+3)
  - stake=20, odds=2 -> paid 38, should be 40 (+2)
  - stake=10, odds=2 -> paid 19, should be 20 (+1)

Aggregate refund: ~10-15 points across 4-5 users. Small but real.

#### Fix

New script `scripts/one-off/refund-house-edge-2026-06-12.mjs`:

1. Reads every live bet (`scope in ('match', 'day')`) in statuses
   `open | locked | graded`.
2. For each, walks its `answer_config` to find the captured decimal odds
   per option/side.
3. Recomputes each pick's payout using `normalizeOdds(odds, { houseEdgePct: 0 })`
   matching the `write-core.ts` formula exactly (live cap still applies
   - `liveStakeCap(stake, { maxPayoutRatio, maxPayoutCeiling })`).
4. Computes a delta = `newPayout - oldPayoutSnapshot` (or
   `newPayout - paid_payout` for graded winners).
5. **DRY-RUN** by default. Prints a per-row diff table.
6. With `--apply`: 
   - Pending picks: update `user_custom_bet_picks.payout_snapshot` to
     the new value. Single SQL UPDATE per pick.
   - Pending bets: rewrite `answer_config.payoutOverrideYes/No`,
     `answer_config.payoutOverridesByValue`, and
     `custom_bets.payout_snapshot` so the bet card displays the right
     potential win to new pickers.
   - Graded winners: insert `point_adjustments` rows with
     `reason="house edge refund - retroactive 0% rollout"` and the
     positive delta.
7. Idempotent: re-running on the same data writes no rows because the
   diffs all converge to 0 once applied.

Logs (per project rule 14):
- `[refund-house-edge dry-run]` per pick: oldPayout, newPayout, delta
- `[refund-house-edge apply pending]` per updated pick
- `[refund-house-edge apply adjustment]` per inserted point_adjustments row

### Part 2 - Duels with custom options + per-option multipliers

#### Data model

Migration `0058_duel_options.sql`:

```
ALTER TABLE duels
  ADD COLUMN options jsonb,           -- null for legacy yes/no
  ADD COLUMN opener_option text,      -- null for legacy
  ADD COLUMN resolved_option text;    -- null for legacy

ALTER TABLE duels
  ADD CONSTRAINT duels_option_consistency CHECK (
    (options IS NULL AND opener_option IS NULL AND resolved_option IS NULL)
    OR (options IS NOT NULL AND opener_option IS NOT NULL)
  );
```

`options` shape: `[{key: string, labelHe: string, labelEn: string, multiplier: number}, ...]`

- 2..5 options per duel (DB CHECK in jsonb_array_length).
- Multiplier in [1.5, 5.0] (DB CHECK via `jsonb` accessor).
- `opener_option` and `resolved_option` reference `options[i].key`.

Legacy yes/no duels keep working unchanged (`options IS NULL` branch
in every reader).

#### Payout math (`src/lib/duels/payout.ts`)

Pure module. Two callers: `bank.ts` (running balance) and
`settleDuel` (audit log + cache busts).

```ts
type DuelPayoutInput = {
  stake: number;
  openerOption: string | null;       // null = legacy yes/no
  openerAnswer: boolean | null;       // legacy
  resolvedOption: string | null;
  resolvedValue: boolean | null;     // legacy
  options: Array<{ key: string; multiplier: number }> | null;
  side: "opener" | "joiner";
};

function resolveDuelDelta(input: DuelPayoutInput): number;
```

- Legacy path (options null): unchanged from today - winner +stake,
  loser -stake.
- New path: winner gets `stake * (winner_option_multiplier - 1)`
  net profit on top of their stake. Loser gets -stake.
- `bank.ts` SQL needs an equivalent CASE branch. Pulled into a SQL
  fragment helper so the TS pure function and the SQL stay in sync;
  unit tests assert they agree on a sample matrix.

#### Joiner UX

Currently the joiner sees a duel and clicks Join (taking the opposite
yes/no answer). With options, the joiner must:

1. See the open options (opener's pick is marked taken).
2. Pick one of the remaining options.
3. Pay the stake.

Schema-wise, we record `joiner_option text` (NULL for legacy).
Migration adds the column.

#### API-Football quick templates

Inside `NewDuelForm.tsx`, when scope = `match`, render a row of pill
chips above the question field:

- "יותר מ-X קרנות?"
- "כרטיס אדום במחצית X?"
- "מעל X כרטיסים צהובים?"
- "X בעיטות למסגרת?"
- "מעל X נבדלים?"

Tapping a pill:

1. Opens a tiny inline picker for the threshold (stepper +/-).
2. Fills `questionHe`, `questionEn`, `ruleHe`, `ruleEn` with the
   templated text (with X substituted).
3. Pre-selects `autoGradeOn = true` and pre-fills `autoGradeStat`,
   `autoGradeComparator`, `autoGradeThreshold`.
4. Sets a default 2-option configuration: `[{key:"yes", multiplier:2.0}, {key:"no", multiplier:2.0}]`
   - opener can edit ratios if they want, but the auto-grade flow
   stays 2-option for clean comparator->boolean mapping.

Templates live in `src/lib/duels/quick-templates.ts` as a typed list.
Adding new templates is one entry there.

#### Custom-options editor

For non-template path (opener wants free-form), a small grid:

- Add Option button (caps at 5).
- Per row: Hebrew label, English label, multiplier (1.5x .. 5.0x).
- Live ratio summary: shows what each option pays if it wins.
- Opener picks ONE option as their side.
- The joiner gets the rest minus the opener's option.

For auto-grade compatibility: the editor is disabled (or limited to
2 options) when auto-grade is on, because the API-Football grader
returns a boolean comparator outcome, which only fits a 2-option
duel.

### Part 3 - Auto-translate Hebrew -> English

#### Server route

New endpoint `src/app/api/translate-bet-text/route.ts`:

- POST `{ text: string, context?: "question" | "rule" | "option" }`
  Returns `{ translation: string }` or `{ error }`.
- Reads `ANTHROPIC_API_KEY` (already in env per
  `src/lib/bets/suggest/generate.ts`).
- Calls Claude with a short system prompt: "Translate this Hebrew
  bet/duel text into natural sporting English. No em dashes. No
  flourishes. Match the exact register of the input."
- Aborts at 8s so a hung Anthropic side doesn't freeze the form.
- Rate limit: per-user, 30 requests / 5 minutes (uses the existing
  `lib/rate-limit.ts` if any; otherwise a simple in-memory map keyed
  on userId. Friends pool, low traffic, in-memory is fine).
- Returns `{ error: "rate_limited" }` on cap hit so the UI shows a
  friendly message.

Logs: `[translate-bet-text]` with userId, textLen, translationLen.

#### Client hook

`src/lib/use-auto-translate.ts`:

- Hook `useAutoTranslate(hebrewText, isEnglishEmpty)` returns
  `{ pending, error, translation, run }`.
- Caller wires `onBlur` of the Hebrew input to call `run()` when the
  English input is still empty.
- Debounced 400ms so a quick tab through doesn't burn a Claude call.

Wired into:

- `NewDuelForm.tsx` for `questionHe`, `ruleHe`, and (Part 2) the
  options Hebrew labels.
- `src/app/[lang]/admin/bets/BetForm.tsx` for the custom-bet question
  and rule fields.

### UI sketches

(See implementation; mobile-first, MD3 tokens already in the app.)

## Alternatives considered and rejected

- **Refund via SQL only, no script**: rejected. The math needs the
  same `normalizeOdds`+`liveStakeCap` formula the live code uses,
  which is JS. Reimplementing in plpgsql doubles the maintenance
  surface and the chance of drift.

- **Duels with sigmoid-derived odds (model fills in)**: rejected per
  user pick. The friend pool wants the opener to FEEL like they set
  the odds. The model can offer suggestions later as a "Smart fill"
  button if desired.

- **Translation via Google Cloud Translate**: cheaper per call but
  needs a new API key, billing, and quota tracking. Reusing Claude
  (already on the project's invoice) keeps cost surface flat.

## Security (per CLAUDE.md rule 13)

- House-edge script: runs with service role key from `.env.local` only,
  never on a public surface. Idempotent. DRY-RUN by default. Audit
  trail via `point_adjustments` rows (already RLS-protected).
- Duel custom options:
  - Input validation: 2..5 options, 1..40 char labels, multiplier
    bounded [1.5, 5.0], unique keys per duel.
  - Server-side guard against tampered multipliers (DB CHECK + action
    re-validation).
  - Joiner can't pick the opener's option (DB CHECK).
- Translate route:
  - Auth: requires logged-in user (uses `getUser()`).
  - Rate limit: in-process map; not bulletproof against a
    multi-instance deploy but Vercel's single-region edge keeps us
    pinned to one box for the friends-pool scale.
  - Input length capped to 400 chars (matches the form's `maxLength`).
  - Anthropic prompt fenced so user text can't pivot the system prompt.

## Observability (per CLAUDE.md rule 14)

- `[refund-house-edge dry-run]`, `[refund-house-edge apply pending]`,
  `[refund-house-edge apply adjustment]` namespaces with values.
- `[duel open]` already exists - add `options`, `openerOption` to
  the log payload.
- `[duel join]` add `joinerOption`.
- `[duel settle]` add `resolvedOption`, `openerDelta`, `joinerDelta`.
- `[translate-bet-text]` userId, textLen, translationLen, ms.

## Testing (per CLAUDE.md rule 18)

- `src/lib/duels/payout.test.ts`: legacy yes/no preserved + new-style
  matrix (2..5 options, multipliers 1.5..5.0). SQL/TS parity asserted
  via fixture array.
- `src/lib/duels/quick-templates.test.ts`: template substitution and
  auto-grade config emission.
- `src/lib/use-auto-translate.test.ts`: debounce + skip-when-english-
  already-populated.
- Existing duel tests (joinDuel, settleDuel) - extended with the
  options path.
- Refund script: a unit test of the recompute function against the
  observed 46-winner table (frozen golden file).

## Settings audit (per CLAUDE.md rule 15)

New knobs surfaced in `/admin/settings/scoring`:

- `duelOptionsMaxCount` (default 5)
- `duelOptionMultiplierMin` (default 1.5)
- `duelOptionMultiplierMax` (default 5.0)

These flow through to the form's clamps + DB CHECKs (sync via
seed/migration constants in `src/db/schema.ts`).

## Open questions

None - all four decisions captured upstream:

1. Bundle order: all three in one PR. (Recommended.)
2. Duel model: free options + per-option multiplier. (Recommended.)
3. API-Football: quick templates that auto-fill the form. (Recommended.)
4. Translation: on-blur auto-fill with manual override. (Recommended.)

## Rollout

Sandbox-first. Once the user verifies in `toto-mundial-sandbox.vercel.app`
they push to prod via the `/he/admin/sandbox` panel. The refund script
runs against prod-DB (read-only DRY-RUN first, then apply) only after
the user signs off on the diff table.
