# Group bets admin — a dedicated place to create & edit "who wins each group"

Date: 2026-06-25
Status: approved (user: "yes create everything so I can edit everything")

## Problem

There is no clear place in admin to manage group bets (scope=`group`, e.g.
"מי תסיים ראשונה בבית A?"). Today they live inside the general bet manager
behind the tile mislabeled "הימורי לייב": admin must switch bet-type to
"טורניר", click the scope chip "בית", then create via the generic form and
type all of a group's teams by hand. Nobody would guess that path. The user
asked for one obvious surface to create and edit every group bet.

## Goal

A dedicated admin page that lists every group (A–L) with its teams and, per
group, either an "edit existing bet" link or a one-click "create" that lands
on the existing bet form already filled with that group's teams as the
choice options + a default question/grading rule. Admin reviews and saves a
draft, then publishes from the normal list. Nothing is written to the DB
directly by us — creation goes through the existing audited create path.

## Chosen approach

Reuse, don't duplicate. The create form (`bets/new` → `BetForm`) already owns
all pricing/grading/validation. We:

1. **Pure template helper** `src/lib/bets/group-bet-template.ts` —
   `buildGroupBetTemplate(groupId, teams)` returns the question (HE/EN),
   grading rule (HE/EN), and multi_choice options (team code → name). Pure,
   unit-tested.
2. **Prefill `bets/new`** — accept `?scope=group&groupId=X`. When present
   (and groupId is a real group), load that group's teams, build the
   template, and seed `InitialBet` (scope=group, multi_choice options,
   manual grading, stake/payout 0 like the template path — the form fills
   free-pick defaults on save). lockAt left blank so the form computes it.
3. **New page** `admin/group-bets` — one card per group: letter, team
   flags+names, and either existing group bets (status chip + edit/view
   links) or a "create" CTA deep-linking to `bets/new?scope=group&groupId=X`.
4. **Admin landing tile** "הימורי בתים" in the Bets section (full admin) and
   in the live-bets section (scoped operator), icon Flag.
5. **Access** — add `group-bets` to `PERMISSION_PATHS.liveBets`. The create
   path (`bets/new`) and `createCustomBet` both require the `liveBets`
   permission, so gating the page under the same key keeps the buttons
   functional (full admins always pass).

### Alternatives rejected

- **Auto-create draft via a bespoke server action** — would duplicate
  BetForm's pricing/grading defaults and drift from it. Rejected: fragile,
  and it writes to the DB on a single click (less review). The deep-link
  keeps the human review step.
- **Just a filtered-list tile** (`bets?type=tournament&scope=group`) — least
  work but still no per-group overview and no team prefill. Rejected: does
  not solve the "type every team by hand" friction.
- **Seed all 12 bets now via script** — writes data directly, needs the
  groups/teams seeded, and bypasses review. Rejected for safety.

## Security

- Page sits under the admin layout gate; reachable only with the `liveBets`
  permission (or full admin). Added to the path whitelist explicitly.
- No new mutation surface: creation flows through the existing
  `createCustomBet` action, which re-validates scope/anchor, question,
  grading, pricing server-side and writes status=`draft`.
- groupId from the URL is validated against the real groups list before any
  prefill; an unknown value falls back to the normal empty form.

## Observability

- Reuse existing `[bet create]` logs. The new page is read-only (a server
  component listing groups + bets); add a `[group-bets] list` info log with
  group count + existing-bet count for parity with other admin lists.

## Testing

- Unit-test `buildGroupBetTemplate`: question/grading text per group letter,
  options map team code → labels, empty-teams case.
- `isPermittedPath` already covered; the existing `grantedPathsFor` test
  spreads `PERMISSION_PATHS.liveBets`, so adding a path stays green.
- Typecheck + lint + full vitest run.

## Deploy

Sandbox branch only (`sandbox`), normal flow. No migration, no env change.
Production (`master`) untouched; promotion stays manual per the user's flow.

## Out of scope (flagged, not built)

- Renaming the "הימורי לייב" tile (it is really the general bet manager).
- Per-group odds: still set in `admin/tournament-odds` (group surfaces) and
  published into the bet payouts there. This page links the two mentally but
  does not move odds management.
