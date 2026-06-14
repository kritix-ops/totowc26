# Live bet result editing + range-option auto-grading

Date: 2026-06-14
Status: implemented

## Trigger

A live bet "כמה שערים ייכבשו במשחק?" (Germany vs Curaçao, options `0-1 / 2-3 / 4+`)
on a match with well over 4 goals was not resolving to its `4+` option. The
user clarified the ask twice: this is about the RESULT (the winning answer
must be `4+`), not the label text. The user then set scope:

1. First, give the admin a way to edit results of live bets that already
   passed — always.
2. Then, root fix + automatic activation so range bets self-grade.

## Findings (verified against code + prod read-only query)

- The bet was `grading_source: manual`, `resolved_value: null` — never graded.
- The stored option value is already `4+` (the `+4` in the screenshot is an
  RTL display flip, explicitly out of scope per the user).
- Root bug: the auto-grade resolver (`src/lib/sync.ts`) turns `total_goals`
  into a NUMBER and only auto-picks a multi_choice winner for match result
  (W/D/L) and exact halftime score. A multi_choice whose options are numeric
  RANGES had no path and silently `skip`-ped forever. Every goals/corners/
  cards range live bet shared this gap.
- The manual grade/reverse server actions (`gradeCustomBet`,
  `reverseCustomBetGrading`) are already scope-agnostic, atomic, audited, and
  use the shared `gradedPickPoints`; re-grading is `graded -> reverse -> grade`
  and correctly revokes old payouts before applying new (bank-safe).
- The ONLY thing blocking "edit results of bets that already passed" was UI
  reachability: `BetsTableActions` returned `null` for `graded`/`cancelled`,
  hiding even the Details link to the grade/reverse form.

## Changes

1. Reachability (deliverable 1):
   - `BetsTableActions.tsx`: always render the Details link (labelled "Fix
     result" / "תקן תוצאה" when graded); gate Cancel to non-terminal states.
   - The existing `GradeForm` already offers reverse + re-grade once graded —
     now reachable for any bet, including already-passed live bets.

2. Range auto-grading (deliverable 2 — root fix):
   - New pure module `src/lib/bets/range-grade.ts`: `parseRangeToken` +
     `matchRangeOption`. Maps a number onto the one option whose range
     contains it. Zero/ambiguous match -> null -> caller `skip`s to manual
     (bet sanctity: never grade a wrong outcome).
   - `src/lib/sync.ts`: candidate query now selects `answer_config`; added
     `finalizeNumericValue`/`finalizeNumeric`; every numeric resolver
     (match-scope `coerceMatchField`, day-scope `auto_football_data`,
     match + day-scope `auto_api_football`) now also accepts `multi_choice`
     and maps the number onto a range option.
   - `coerceMatchField` gained an optional `options` param (default `[]`) so
     existing number/yes_no callers and tests are unaffected.

3. Automatic activation:
   - `src/lib/bets/suggest/generate.ts`: prompt now instructs the generator
     to set the matching auto source on numeric-range multi_choice markets
     and keep option `value`s plain range tokens (`0-1`, `2-3`, `4+`).

## Testing

- `src/lib/bets/range-grade.test.ts` — token parsing (over/under/range/exact,
  Hebrew + English labels, keyed values), match selection, no/ambiguous match.
- `src/lib/sync-coerce.test.ts` — `coerceMatchField` maps `total_goals` and
  `winning_margin` onto range options; number bets unchanged; skips with no
  options or with a number outside every range.
- Full suite: 640 passing. `tsc --noEmit` clean. eslint clean.

## Out of scope / follow-ups

- The specific manual bet `453bd2f9` stays `manual`; it can be graded to `4+`
  from the admin UI now (Details -> Grade). Converting existing manual range
  bets to an auto source is a separate prod-data decision, not done here.
- The RTL `+4` vs `4+` display flip in option pills (user said ignore it).
