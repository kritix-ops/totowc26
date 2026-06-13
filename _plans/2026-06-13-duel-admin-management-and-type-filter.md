# Duel management in admin + bet-type filter

Date: 2026-06-13
Owner: Yoav
Status: approved (scope locked via in-session questions)

## Goal

Bring duels (דו-קרב) into the admin bets management surface — active,
matched, settled and cancelled — and add a primary "bet type" filter
(לייב / טורניר / דו-קרב) to the existing `/admin/bets` page. The whole
surface, including duel management, must be reachable by scoped
operators who hold the `liveBets` permission, not only full admins.

The bar: the most convenient, cleanest, most UI/UX-friendly version,
mobile-first (project CLAUDE.md).

## Scope decisions (locked by the user)

1. **One unified page** — extend `/admin/bets`, do not spin up a separate
   `/admin/duels` page or a tabbed hub.
2. **liveBets managers get full duel management** — view + cancel +
   settle. This requires relaxing the server-side gate on `settleDuel`
   and `cancelDuel`.
3. **Type facet = לייב + טורניר + דו-קרב** only. Plain 1/X/2 match-result
   picks are NOT included (auto-generated, auto-graded from the score —
   not "managed" the same way).

## Current state (verified)

- `/admin/bets` manages only `custom_bets` (scopes match/day/stage/group/
  tournament). Filters: match, search, status, scope. Layout gate
  (`src/app/[lang]/admin/layout.tsx`) lets full admins and any scoped
  operator through; the `bets` path is granted by the `liveBets`
  permission (`src/lib/admin-paths.ts`).
- Duels live in a separate `duels` table with a different lifecycle:
  open → matched → settled / cancelled. No admin list surface exists;
  an admin must find a duel in the public `/duels` feed, open it, and use
  the settle/cancel cards in `DuelActions`.
- `settleDuel` is `isAdmin`-only; `cancelDuel` allows admin OR the opener
  while the duel is still open. Both are the only money-moving duel
  actions — they are the security boundary.
- `hasPermission(userId, "liveBets")` already exists in `src/lib/admin.ts`
  and returns true for full admins too — the exact gate we need.
- Duels support two answer shapes: legacy yes/no (`opener_answer` /
  `resolved_value`) and custom options with multipliers (`options`,
  `opener_option`, `joiner_option`, `resolved_option`). The settle UI
  must handle both.

## Chosen approach

### Primary facet
Add a `type` URL param to `/admin/bets`, default `live`. A prominent
"סוג הימור" chip row sits at the top of the filter bar:
`לייב · טורניר · דו-קרב`. The contextual filters below adapt:

- **live / tournament** → query `custom_bets` (today's path), with scope
  constrained to that family (live = match+day; tournament =
  stage+group+tournament). Status, scope sub-chips, match picker and
  search behave as today, narrowed to the family.
- **duel** → query the new `listDuelsForAdmin`, render duel cards with a
  duel status chip set (פתוח/שובץ/הוכרע/בוטל), duel scope sub-chips
  (משחק/יום/טורניר) and search. Active (open/matched) sorted to the top
  by soonest deadline, then past (settled/cancelled) newest-first — the
  same ordering the public "mine" tab uses.

Switching type rebuilds the query string so an out-of-family scope is
dropped instead of yielding an empty list.

### Duel cards + inline actions
A new `DuelAdminActions` client component renders inline in each duel
card (mirrors `BetsTableActions`): a "פרטים" link to the public detail
page, a cancel flow (reason → `cancelDuel`), and a settle flow shown only
when status = matched (yes/no buttons for legacy duels, option buttons
for custom-option duels → `settleDuel`). Reuses the existing server
actions and the `options.ts` helpers — no payout logic is duplicated.

### Permission relaxation (security boundary)
- `settleDuel`: `isAdmin(user.id)` → `hasPermission(user.id, "liveBets")`.
- `cancelDuel`: the admin branch becomes
  `hasPermission(user.id, "liveBets")`; the opener-on-open branch is
  unchanged.
- The public duel detail page (`/duels/[id]`) computes `canManageDuels =
  hasPermission(..., "liveBets")` and passes it to `DuelActions` (prop
  renamed `isAdmin` → `canManage`) so a manager sees the same buttons the
  server now honours — no UI/permission mismatch.

### Data layer
- New `AdminDuelRow` type + `listDuelsForAdmin({ status, scope, q, limit })`
  in `src/db/admin-queries.ts`, mirroring `listCustomBets`.
- `listCustomBets` gains an optional `scopeIn?: scope[]` to constrain a
  query to a family without losing the single-scope sub-filter.
- New pure module `src/lib/bets/admin-bet-types.ts`: `parseBetType`,
  `scopesForBetType`, and label maps (type, duel status, duel scope) —
  unit-tested.

## Alternatives rejected

- **Separate `/admin/duels` page** — clean separation but two surfaces to
  maintain and contradicts the user's "same display / filter by type"
  framing.
- **Tabbed hub** — heavier shell rework for the same outcome the type
  facet gives with less chrome.
- **UNION custom_bets + duels into one list** — different statuses,
  actions and columns make a merged list confusing; the type switch keeps
  each model rendered with its own affordances.
- **New `duels` permission flag** — extra admin overhead; the user framed
  the audience as generic "bet managers", so reuse `liveBets`. The
  existing `bets` path already grants the page.

## Security (rule 13)

- The only privileged duel mutations are `settleDuel` / `cancelDuel`;
  both are re-gated to `hasPermission(liveBets)` (admins included). No
  other caller settles/cancels duels (verified by trace). No new public
  surface — duel management lives under `/admin/bets`, already gated by
  the admin layout + the `liveBets` path whitelist.
- Settle still validates the resolved option against the row's stored
  options and stays inside the existing serializable transaction; the
  relaxation changes WHO may call, not WHAT is allowed.
- `settled_by` keeps recording the acting user, so a manager-settled
  duel is auditable.

## Observability (rule 14)

- Existing `[duel settle]` / `[duel cancel]` logs already capture
  `settledBy` / `cancelledBy`; extend them with whether the caller was a
  full admin vs a scoped manager.
- `[admin bets]` log on the page when `type=duel` is selected, with the
  resolved filter set and row count, namespaced for grep.

## Testing (rule 18)

- Unit tests for `admin-bet-types.ts`: `parseBetType` (valid, junk,
  default), `scopesForBetType` mapping, label maps round-trip.
- The server-action relaxation is covered by reasoning + the existing
  `hasPermission` semantics; the DB-bound query and React components are
  verified by the QA pass (run the app, exercise each type + a settle +
  a cancel). Documented as intentionally not unit-tested (DB/IO seam).
- Run the full vitest suite + eslint before calling it done.

## Settings audit (rule 15)

No new user-facing settings. The single configurable axis — whether duel
management is gated by `liveBets` vs a dedicated flag — is resolved to
reuse `liveBets` per the user's choice. The `liveBets` permission help
copy is updated to state it now covers duel cancel/settle.

## Mobile (project CLAUDE.md)

Cards stack; chips ≥36px tap targets; duel settle/cancel controls are
≥44px; no horizontal scroll; `pb-24` already on the page section.

## Files

- `src/app/[lang]/duels/actions.ts` — relax gates, extend logs.
- `src/app/[lang]/duels/[id]/page.tsx` + `DuelActions.tsx` — manager
  parity (`canManage` prop).
- `src/db/admin-queries.ts` — `listDuelsForAdmin`, `scopeIn`.
- `src/lib/bets/admin-bet-types.ts` (+ `.test.ts`) — pure helpers.
- `src/app/[lang]/admin/bets/page.tsx` — type facet + duel view.
- `src/app/[lang]/admin/bets/DuelAdminActions.tsx` — inline duel actions.
- `src/lib/admin-paths.ts` — `liveBets` help copy.

## Open questions

None blocking. The duel-type view intentionally omits the match dropdown
(search covers the matchup label); revisit if managers ask for it.
