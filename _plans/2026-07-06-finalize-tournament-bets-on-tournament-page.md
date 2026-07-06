# Finalize tournament bets on the tournament page

Date: 2026-07-06
Status: approved, in progress

## Problem

Admins cannot find any way to finalize (grade/settle) a published
tournament bet. Concrete report: the "total red cards" tournament bet is
already decided (13 reds reached, top range is "13 or more"), but there is
no visible finalize control.

Root cause is navigation, not a missing capability:

- The `הימורי טורניר` (Tournament bets) tile on `/admin` and the button in
  `/admin/bets` both point to `/admin/tournament-suggestions`, which is a
  **template library for publishing new bets only**. It has no list of
  already-published tournament bets and no grade control. (The file even
  carries a stale comment referencing a non-existent
  `/admin/bets/[id]/grade` route.)
- The real finalize surface is `/admin/bets` (titled "הימורי לייב / Live
  bets") → switch the bet-type facet to `טורניר` → open a bet → the
  `דרג ידנית` (Grade manually) card. No admin would guess that the page to
  settle a tournament bet is the one called "Live bets."

Verified: `publishTournamentTemplate` inserts `scope='tournament'`,
`status='open'`, `gradingSource='manual'`; the detail page
(`/admin/bets/[id]`) embeds `GradeForm`, which grades `open | locked |
reversed` bets and reverses `graded` ones. Everything works; it's just
unreachable from where the admin looks.

## Decision (from the user)

1. **Surface**: List published tournament bets on the tournament page with
   an inline one-tap finalize control (the recommended option).
2. **Permissions**: Full admins only for now. Grading stays gated to the
   `liveBets` permission — no auth-model change. (Scoped `tournamentBets`
   operators still can't finalize; tracked as a known gap, not fixed here.)

## Scope of the list

Show `scope IN ('stage', 'tournament')` bets — the manually-graded
free-pick tournament families that have **no other finalize home**.

Exclude `group` scope: group bets auto-grade and already have a dedicated
manager at `/admin/group-bets`. Pulling them in here would duplicate that
surface and add auto-graded noise.

Exclude `draft` (unpublished — belongs to the create flow) and `cancelled`
(dead) statuses. Show `open | locked | reversed | graded`, sorted so the
ones needing action come first.

## Approach — reuse, don't rebuild

- **`GradeForm`** (`admin/bets/[id]/GradeForm.tsx`) is the existing,
  tested grading UI (all four answer types + reason + grade/reverse). It
  imports its server actions by its own path, so it works unchanged when
  rendered from the tournament page. Reuse it inline behind a per-row
  expand toggle.
- **`listCustomBets`** (`db/admin-queries.ts`) is the same query the
  canonical bets list uses. Reuse it with `scopeIn: ['stage','tournament']`.
  It returns everything `GradeForm` needs except `resolved_value`; add that
  one column so a graded row can prefill its resolved value in the reverse
  form. Additive, backward-compatible — existing callers ignore the field.

## Changes

1. `src/db/admin-queries.ts`
   - Add `resolvedValue: unknown` to `AdminCustomBetRow`.
   - Add `cb.resolved_value as "resolvedValue"` to the `listCustomBets`
     SELECT (mirrors `getAdminCustomBetDetail`).

2. `src/app/[lang]/admin/tournament-suggestions/PublishedTournamentBets.tsx`
   (new client component)
   - Section heading + short helper + count of bets awaiting finalize.
   - One card per bet: question, status chip, scope chip, pick count,
     payout, lock time.
   - A 44px toggle ("סיים" for gradeable, "תקן תוצאה" for graded) that
     reveals `<GradeForm>` inline. `GradeForm` calls `router.refresh()` on
     success, which re-runs the server page and updates the list.

3. `src/app/[lang]/admin/tournament-suggestions/page.tsx`
   - Load `listCustomBets({ scopeIn: ['stage','tournament'], limit: 200 })`.
   - Localize question + scope label (`stageLabel` for stage rows), filter
     out draft/cancelled, stable-sort needs-action first.
   - Render `<PublishedTournamentBets>` ABOVE the templates block (finalize
     is the higher-frequency task once the tournament is live).
   - Update the header copy so it names both jobs: finalize existing +
     publish new.

## Security / safety

- No new server action; reuses `gradeCustomBet` / `reverseCustomBetGrading`,
  which already enforce `liveBets`, validate the resolved value, require a
  3+ char reason, and write an audit row. No permission surface widens.
- `resolved_value` is already exposed by `getAdminCustomBetDetail`; adding
  it to the list query exposes nothing new to a non-admin (the whole
  surface is admin-gated).

## Mobile / lazy-user checklist

- Cards stack single-column; toggle + all `GradeForm` controls already meet
  44–48px targets.
- Finalize lives exactly where the admin looks for "tournament bets"; no
  cross-page hunt, no knowledge of the "Live bets" trick required.
- Verify at 360 / 414 / 768 / 1024 / 1440.

## Rejected alternatives

- **Re-target the buttons to `/admin/bets?type=tournament`**: lowest effort
  but demotes the nice template flow and still dumps the admin on a page
  titled "Live bets."
- **Signpost-only link**: removes the dead end but still makes finalize a
  two-page journey.
- **Absorb group scope too**: duplicates `/admin/group-bets` and mixes
  auto-graded bets into a manual-finalize list.

## Out of scope (follow-ups)

- Letting `tournamentBets`-only operators finalize (needs an auth-gate
  change so they can grade tournament-scope bets without touching live).
- Fixing the stale `/admin/bets/[id]/grade` comment in
  `tournament-suggestions/page.tsx` (will correct it while editing).
