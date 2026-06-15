# Duels: cap multiplier at 3.0x and restrict match-scope duels to ≤ semi-finals

Date: 2026-06-15
Status: approved (clarified with product owner)

## Goal

Two product changes to the 1v1 duels feature:

1. **Cap the per-option payout multiplier at 3.0x** (was 5.0x). Applies to
   every new duel created from now on.
2. **Match-scope duels can only anchor to matches up to and including the
   semi-finals.** The final and the third-place playoff cannot host a
   match duel. Day-scope and tournament-scope duels are unchanged.

## Decisions (confirmed with owner)

- Cutoff applies to **match scope only**. Day-scope and tournament-scope
  duels stay openable through the final.
- "After the semis" = both the **final** and the **third-place playoff**
  (`stage in ('final','third_place')`). The semi-finals (`sf`) are the
  last duel-able round.
- Duels already **open or matched keep settling normally** — no refunds,
  no forced cancels. This change is forward-looking only.

## Data model facts

- `matches.stage` enum order: `group → r32 → r16 → qf → sf → third_place → final`.
  Eligible for match duels = everything except `final` and `third_place`.
- The only duel-creation path is `openDuel` in
  `src/app/[lang]/duels/actions.ts` (single `insert(duels)`). No admin
  create path. Quick-templates only prefill the form; they still go
  through `openDuel`.
- Multiplier bounds live in `src/lib/duels/options.ts`
  (`MULTIPLIER_MIN_PCT=150`, `MULTIPLIER_MAX_PCT=500`). Multipliers are
  integer hundredths end-to-end (300 = 3.0x).

## Changes

### 1. Multiplier cap 5.0x → 3.0x

- `src/lib/duels/options.ts`: `MULTIPLIER_MAX_PCT 500 → 300` (+ comment).
- `src/app/[lang]/duels/new/NewDuelForm.tsx`:
  - `MULTIPLIER_CHOICES` → drop everything above 300:
    `[150, 175, 200, 225, 250, 275, 300]`.
  - Options-editor hint copy: `1.5×–5.0×` → `1.5×–3.0×` (HE + EN).
- `src/app/[lang]/dictionaries/{en,he}.json`: `duelNew.invalid_options`
  and `duels.invalid_options` (errors block) copy `5.0x`/`ל-5` → `3.0x`/`ל-3`.
- `src/db/schema.ts`: comment `150..500` → `150..300`.
- `src/lib/duels/options.test.ts`: already relative
  (`MULTIPLIER_MAX_PCT + 1`) — no change needed; add a guard test that
  the constant is 300 so a future bump is deliberate.

DB CHECK (`duels_*_multiplier_range`, currently `BETWEEN 150 AND 500`) is
**left at 500** as a non-destructive backstop. Rationale: app-level
`validateOptions` already blocks anything >300 for every new duel, and
the join path re-derives the multiplier from the already-validated stored
options, so nothing >300 can reach the DB through normal flow. Tightening
the CHECK risks failing the migration on (or rewriting the economics of)
existing >3.0x duels created while 5.0x was allowed. Documented in
`options.ts`.

### 2. Match-scope cutoff at the semi-finals

- `src/app/[lang]/duels/new/page.tsx` → `loadUpcomingFixtures`: add
  `and m.stage not in ('final','third_place')` so the picker never lists
  a final / 3rd-place match. `loadUpcomingMatchdays` unchanged.
- `src/app/[lang]/duels/actions.ts` → `openDuel`, `scope === 'match'`
  branch: select `stage`, reject `final`/`third_place` with a new
  `match_stage_locked` error (server-side guard against a tampered
  request that ships a final-match id directly).
- `DuelErr` union gains `match_stage_locked`.
- `src/app/[lang]/dictionaries/{en,he}.json`: add
  `duelNew.match_stage_locked` copy.
- `NewDuelForm.tsx`: small hint under the match picker
  ("Duels run through the semi-finals — the final and third-place playoff
  aren't available") so the absence of those matches is self-explanatory.

## Out of scope

- Day-scope / tournament-scope gating (owner chose match-scope only).
- Refunding or cancelling in-flight duels.
- Tightening the DB multiplier CHECK constraint.

## QA checklist

- New-duel form: multiplier dropdown tops out at 3.0x; editor hint reads
  1.5×–3.0×; preview math correct at 3.0x.
- Server rejects a tampered options payload with a 3.25x+ multiplier
  (`invalid_options`).
- Match picker omits final / 3rd-place matches; day picker unaffected.
- `openDuel` with a final-match id returns `match_stage_locked`.
- Existing >3.0x duels still display and settle correctly (non-destructive).
- `vitest` green; `tsc`/lint clean.
- Mobile: picker + hint legible at 360px, touch targets ≥44px.
