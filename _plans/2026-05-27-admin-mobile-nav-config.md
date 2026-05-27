# Admin-controlled mobile navigation

Date: 2026-05-27
Status: Approved, ready to implement

## Goal

Give the admin a control surface to decide which items appear in the
mobile bottom nav bar versus the "עוד" (More) sheet, in what order, and
which items to remove entirely. Setting is global — one config applies
to every signed-in mobile user.

Today these lists are hardcoded in `AppShell.tsx` and
`MobileMoreSheet.tsx`. Changing them requires a code deploy. The admin
should be able to reorder, delete, and resize the bottom bar live.

## Constraints

- Global config (not per-user).
- Role-based filtering still applies: `pay` hidden for admins, `admin`
  hidden for non-admins.
- Logout always stays anchored at the bottom of the More sheet — it is
  a session action, not a nav item.
- Bottom bar count is admin-adjustable; if total visible items exceed
  the count, the last bottom slot becomes "עוד" and overflow goes into
  the sheet. If total ≤ count, no "עוד" cell, no sheet.
- Hebrew + RTL throughout.

## Data model

Single JSONB column on the existing `settings` singleton:

```
mobile_nav_config  jsonb  NOT NULL DEFAULT '{...defaults...}'
```

Shape:
```jsonc
{
  "items": [
    "home", "bets", "duels", "leaderboard",
    "tournament", "live", "transparency", "pay",
    "admin", "profile", "rules"
  ],
  "bottomBarCount": 5
}
```

- `items` is the ordered list of visible item keys. Items not in the
  array are hidden (deleted). Order applies to both bar and sheet:
  first `bottomBarCount` go to the bar (last slot becomes "עוד" if
  spill exists), the rest go to the sheet.
- `bottomBarCount` integer, clamped 2–5.
- Defaults match the current hardcoded layout so behavior is unchanged
  immediately after the migration.

Defining the available keys (single source of truth, lives in
`src/lib/mobile-nav.ts`):

```ts
export const MOBILE_NAV_ITEM_KEYS = [
  "home", "bets", "duels", "leaderboard",
  "tournament", "live", "transparency",
  "pay", "admin", "profile", "rules",
] as const;
```

Each key maps to: path, label dictionary key, icon, and an optional
role gate (`pay` → non-admin only, `admin` → admin only). Role gates
are evaluated at render time, not stored in config — keeps the admin
UI simple (admin sees all keys, the runtime filters).

## Admin UI

Lives under `/[lang]/admin/settings/mobile-nav`. Surfaced as a new
section card on the admin home page (`SectionLink` with a `Smartphone`
icon, label "תפריט מובייל").

### Layout

1. **Bottom-bar size selector** — a stepper (−/+) between 2 and 5.
   Labelled "כמות תאים בסרגל התחתון". Helper text: "אם יש יותר פריטים
   מהמספר הזה, התא האחרון הופך ל-'עוד' ויפתח את שאר הפריטים."

2. **Ordered visible list** — single column, drag-to-reorder via
   `@dnd-kit` (existing dep? check; otherwise add). Each row shows:
   - Drag handle (left)
   - Icon + Hebrew label
   - Role badge if applicable ("רק שחקנים" / "רק אדמין")
   - Delete (X) button → moves to hidden bucket
   A solid divider line is rendered between row `bottomBarCount - 1`
   and `bottomBarCount` with the label "מעל הקו: סרגל תחתון | מתחת:
   תפריט 'עוד'". Divider only renders if total > bottomBarCount.

3. **Hidden items** — collapsed section under "פריטים מוסתרים".
   Each row has a restore (↺) button that appends the item back to
   the visible list.

4. **Live preview** — fixed mock of the bottom bar on the right side
   (lg+) or below (md and under), showing exactly what a phone user
   will see with the current draft config. Updates in real time.

5. **Sticky save bar** — bottom of the page. Shows "שמור" + "בטל"
   buttons. Save button disabled until the draft differs from
   persisted state. Confirmation toast on success.

### Validation

- At least one item must be visible (block save otherwise).
- `bottomBarCount` clamped 2–5 in the UI.
- Server action re-validates: clamps count, dedupes items, drops
  unknown keys (defends against stale clients).

## Wire-through

- `AppShell` fetches `mobile_nav_config` alongside the existing
  request-user data. Splits the items into `bottomItems` and
  `sheetItems` after role filtering. Passes both to:
  - The static bottom-nav grid (renders `bottomItems`, with a "More"
    cell if `sheetItems` non-empty).
  - `MobileMoreSection` → `MobileMoreSheet` (renders `sheetItems`).
- Grid column count = `min(visibleBottomCount + (hasMore ? 1 : 0), 5)`.
  Tailwind class is `grid-cols-${n}` — we'll use a static map to keep
  Tailwind JIT happy.
- `MobileMoreSheet` no longer hardcodes its item list — accepts an
  ordered prop of `{ key, label, icon, path }`.

## Security (rule 13)

- Server action `updateMobileNavConfig` lives in
  `src/app/[lang]/admin/settings/mobile-nav/actions.ts`.
- Action calls `requireAdmin()` (or whatever the project's existing
  admin-guard helper is — check `getUserAccess`). Reject otherwise.
- Validate payload with Zod: `items` is `MOBILE_NAV_ITEM_KEYS[]`,
  unique, length ≥ 1; `bottomBarCount` is int 2–5.
- RLS already restricts settings writes server-side via the service
  role — the action runs server-side so it uses that, not the client
  Supabase key.

## Observability (rule 14)

- `console.info("[admin mobile-nav save]", { byUserId, prev, next })`
  inside the server action.
- `console.info("[app shell mobile-nav load]", { itemCount,
  bottomCount, hasMore })` on AppShell render.
- `console.info("[mobile more sheet open]", ...)` already exists —
  extend with the resolved sheet keys.
- On unknown key in stored config: `console.warn("[mobile nav unknown
  key]", { key })` and skip it.

## Settings audit (rule 15)

This feature IS the settings layer for the nav. No further user-facing
toggles needed.

## Out of scope (intentional)

- Per-user customization of nav.
- Adding new items to the catalog (the catalog is code-defined; a key
  must exist before admin can place it). If a new page appears, we
  add its entry to `MOBILE_NAV_ITEM_KEYS` and rebuild — admin can
  then arrange it.
- Desktop nav customization. The user only asked about mobile.
- Reordering the avatar dropdown.

## Steps

1. Migration `0019_mobile_nav_config.sql` adds the JSONB column to
   `settings` with the default config.
2. Add `mobileNavConfig` to the Drizzle `settings` schema.
3. Create `src/lib/mobile-nav.ts` — catalog + helpers
   (`splitItems(config, role)`).
4. Server action + Zod validator in
   `src/app/[lang]/admin/settings/mobile-nav/actions.ts`.
5. Admin page `src/app/[lang]/admin/settings/mobile-nav/page.tsx` +
   client form component.
6. Refactor `AppShell` to read the config and emit dynamic grid +
   bottom items; pass sheet items to `MobileMoreSection`.
7. Refactor `MobileMoreSheet` to accept items via props.
8. QA at 360 / 414 / 768 / 1024 / 1440. Hebrew layout. Empty More
   sheet (when count ≥ total). Logout still pinned.
