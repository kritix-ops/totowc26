# Page Visibility: Admin-Controlled Hide / Disable per Page

**Date:** 2026-05-27
**Status:** Awaiting Yoav's approval before code starts
**Owner:** Yoav
**Target date:** Live by **2026-06-11** (World Cup kickoff)
**Companion plan:** `_plans/2026-05-27-betting-deadlines.md` (separate PR, no shared code)

---

## 1. Goal

Give the admin a single switchboard that decides whether each player-
facing page is **available at all**. The switch is two things in one:

- The page disappears from navigation (header links, mobile bottom bar,
  the "more" sheet — anywhere a link to it lives).
- A direct hit on the URL (`/[lang]/duels`, `/[lang]/transparency`,
  etc.) **does not render the page**. The server redirects to home
  and surfaces a Hebrew toast: "העמוד אינו זמין כרגע".

Default state: **every page is on**, so an upgrade behaves exactly
like the current build. Admin opts a page off when they want it.

This is **separate** from `mobile_nav_config` (which is a curation
layer for the bottom bar). Visibility is the gate; nav curation sits
on top and renders only the pages that pass the gate.

---

## 2. Constraints (from `~/.claude/CLAUDE.md` and project `CLAUDE.md`)

- **Verify, never guess** (rule 1): catalog grounded in
  `src/lib/mobile-nav.ts:13-25` (`MOBILE_NAV_ITEM_KEYS`) — the only
  place in the codebase that defines the player-page key universe.
  We add the visibility layer next to this so it stays the single
  source of truth for what a "page key" is.
- **Read local Next.js docs before coding** (`AGENTS.md`): this app
  runs a custom Next.js build where conventions diverge from upstream.
  Before writing the gate, I consult
  `node_modules/next/dist/docs/` for the current `redirect()`,
  middleware, and server-action surfaces. No copy-pasting from
  training-data memory.
- **Clean ordered code** (rule 2): new column slots into `settings`
  next to `mobileNavConfig` (they share a domain). New helper file
  next to `mobile-nav.ts`. New admin page follows
  `src/app/[lang]/admin/settings/mobile-nav/page.tsx` patterns 1:1.
- **Alignment before code** (rule 3): three-question round above this
  plan locked the scope. No additional ambiguity.
- **Alternatives + recommendation** (rule 4): three options in §10.
- **Mobile-first responsive** (project `CLAUDE.md`): admin form
  tested at 360 / 414 / 768 / 1024 / 1440 px. 44×44 px touch targets.
- **Cost flagging** (rule 8): zero incremental cost — no new services.
- **Context7 before library code** (rule 9): consult Context7 for any
  Next.js 15 `redirect()` / middleware semantics. The
  AGENTS.md notice raises the bar — I read the local node_modules docs
  too.
- **Lazy user** (rule 10): one screen with a list of toggles + a "save"
  button. Each toggle row shows the page name in Hebrew + the URL
  segment + a short helper line.
- **Brutal honesty** (rule 12): the one risk is admin hiding the page
  they themselves are sitting on. Mitigation: admin pages are not
  hideable (rule confirmed in §4.1). Plus a re-confirmation modal
  before any save.
- **Security from day 1** (rule 13): admin route gated by existing
  `isAdmin()`. RLS on the new column carried by the existing
  `settings` policy (it's just a new column, no new table).
- **Observability from day 1** (rule 14): every gate decision and
  every admin save emits a `[page visibility ...]` log. See §8.
- **Settings audit** (rule 15): visibility toggles live on
  `/admin/pages` (dedicated page, not buried in scoring). Default
  matrix preserves current behavior. Label per row uses the player-
  facing Hebrew name from `dict.nav`, not the technical key.
- **Polished UI** (rule 16): the toast on home is a short, restrained
  one-liner with subtle styling. No alarms.

---

## 3. Decisions locked (this session, 2026-05-27)

| # | Question | Yoav's answer |
|---|----------|---------------|
| 1 | Which pages are hideable? | All player-facing — **never** admin / login / profile / signup |
| 2 | What happens on direct URL hit to a hidden page? | **Redirect to home + toast** "העמוד אינו זמין כרגע" |
| 3 | Does hiding a page also remove it from mobile nav? | **Yes** — single source of truth; the nav rendering filters by visibility |

---

## 4. Hideable page catalog

### 4.1 What's in scope

From the 11 keys in `MOBILE_NAV_ITEM_KEYS`, the **8** hideable keys:

| Key | Path | Hebrew label |
|---|---|---|
| `bets` | `/[lang]/bets` | משחקים |
| `duels` | `/[lang]/duels` | דואלים |
| `leaderboard` | `/[lang]/leaderboard` | טבלה |
| `tournament` | `/[lang]/tournament` | טורניר |
| `live` | `/[lang]/live` | שידור חי |
| `transparency` | `/[lang]/transparency` | שקיפות |
| `pay` | `/[lang]/pay` | תשלום |
| `rules` | `/[lang]/rules` | חוקים |

### 4.2 What's intentionally **not** hideable

- `home` — the redirect *target* for hidden pages. If home were
  hideable we'd need a second-tier fallback; not worth the complexity.
- `admin` — admin must never lock themselves out of the control
  panel. Hard rule, not configurable.
- `profile` — every user needs the route to their account and
  password reset.
- `login` / `signup` — auth surfaces are never optional; users locked
  out of the app would have no path back in.

Hard-coded in the helper (§5) and surfaced in the admin UI as "מערכת —
לא ניתן להסתיר" disabled rows so the admin sees the full picture.

### 4.3 Bets-area sub-pages

`/[lang]/bets/[matchId]` and `/[lang]/play/[date]` are children of
`bets`. Hiding `bets` hides them too — the gate runs at the layout
level for the segment, so any URL under a hidden segment also
redirects. Confirmed by a test in §11.

---

## 5. Data model

One new column on `settings`:

```sql
alter table public.settings
  add column hidden_pages jsonb not null default '[]'::jsonb;
```

- Shape: an array of page-key strings.
- Default: `[]` — preserves current "everything visible" behavior on
  upgrade.
- Validation enforced in the server action (admin save), not on the
  DB, so we can grow the catalog without migrating every row.

Why a column on `settings` and not a new table:
- The catalog is small (8 keys, fixed).
- Atomic save: admin toggles five pages at once, one UPDATE.
- Mirrors the `mobile_nav_config` jsonb pattern already on `settings`.
- No new RLS policy needed — `settings` already gates writes to
  admins (migration 0005). One thing fewer to get wrong.

---

## 6. The gate (`src/lib/page-visibility.ts` — new file)

Single helper called from each top-level page's `page.tsx`:

```ts
import { redirect } from "next/navigation";

export const HIDEABLE_PAGE_KEYS = [
  "bets", "duels", "leaderboard", "tournament",
  "live", "transparency", "pay", "rules",
] as const;
export type HideablePageKey = (typeof HIDEABLE_PAGE_KEYS)[number];
const HIDEABLE_SET: ReadonlySet<string> = new Set(HIDEABLE_PAGE_KEYS);

/**
 * Server-only. Call at the top of any hideable page's `page.tsx` /
 * `layout.tsx`. If the page is in `settings.hidden_pages`, the
 * function does NOT return — it redirects to `/[lang]?hidden=<key>`.
 *
 * The `[lang]/page.tsx` reads the `?hidden` param and surfaces the
 * toast.
 */
export async function gatePage(
  key: HideablePageKey,
  lang: string
): Promise<void> {
  if (!HIDEABLE_SET.has(key)) return;          // catalog defends here
  const hidden = await readHiddenPages();      // cached per request
  if (!hidden.includes(key)) return;           // page is on
  console.info("[page visibility gate]", { key, lang, action: "redirect" });
  redirect(`/${lang}?hidden=${key}`);
}

export async function readHiddenPages(): Promise<string[]> { ... }
export async function isPageHidden(key: HideablePageKey): Promise<boolean> { ... }
```

`readHiddenPages` reads `settings.hidden_pages` once per request via
React's `cache()` so multiple `gatePage()` calls (or a layout + a
page) don't repeat the query.

### 6.1 Where the gate is wired

For each hideable key, add a `gatePage(key, lang)` call at the top
of the route's `page.tsx`. Specifically:

- `src/app/[lang]/bets/page.tsx` → `gatePage("bets", lang)`
- `src/app/[lang]/duels/page.tsx` → `gatePage("duels", lang)`
- `src/app/[lang]/leaderboard/page.tsx` → `gatePage("leaderboard", lang)`
- `src/app/[lang]/tournament/page.tsx` → `gatePage("tournament", lang)`
- `src/app/[lang]/live/page.tsx` → `gatePage("live", lang)`
- `src/app/[lang]/transparency/page.tsx` → `gatePage("transparency", lang)`
- `src/app/[lang]/pay/page.tsx` → `gatePage("pay", lang)`
- `src/app/[lang]/rules/page.tsx` → `gatePage("rules", lang)`

Plus the **segment-level layout files** so the child routes inherit
the gate without duplicating the call:

- `src/app/[lang]/bets/layout.tsx` (if it exists; if not, create one)
  → handles `/bets/[matchId]` and `/play/[date]` automatically.
- Same for any other segment with child routes.

Pre-write check (per AGENTS.md): I read the local Next.js docs in
`node_modules/next/dist/docs/` for the **exact** layout / page server-
component contract before authoring the call sites. The docs in
training memory may not match this build's surface.

---

## 7. Home redirect toast

### 7.1 Server side

`src/app/[lang]/page.tsx` reads `searchParams.hidden` (a key string).
If present and a member of `HIDEABLE_PAGE_KEYS`, it passes the key
down to a small client component that fires a one-shot toast on mount,
then strips the param from the URL via `history.replaceState` so a
refresh doesn't re-show the toast.

### 7.2 Toast copy

Hebrew: "העמוד אינו זמין כרגע."

English (for `lang=en`): "This page is currently unavailable."

Resolved label comes from the existing dict structure, not a
hard-coded string in the component.

### 7.3 Toast UX

- Uses the existing toast helper if one is in place; otherwise a thin
  inline toast component (auto-hide after 4 s; dismissable; positioned
  bottom-center; respects safe area).
- Single line, no icons, no jargon. Per rule 10 and 16.

---

## 8. Observability (rule 14)

Every gate and every admin save logs:

| Namespace | Where | Payload |
|---|---|---|
| `[page visibility gate]` | each `gatePage()` redirect | `{ key, lang, action }` |
| `[page visibility read]` | `readHiddenPages` cache miss | `{ hidden: string[] }` |
| `[page visibility save]` | admin save action | `{ adminId, oldList, newList, diff }` |
| `[page visibility toast]` | home toast component on mount | `{ key }` |

All `console.info`. Bracketed namespace, structured payload. Same
convention as the rest of the codebase.

---

## 9. Admin UI

### 9.1 New route: `/admin/pages`

One page, two sections:

**Section 1 — עמודים פעילים**
- A toggle list of the 8 hideable keys.
- Each row: a switch + the Hebrew label + the URL segment + a one-
  line helper ("הסתרה תפנה כל מי שמגיע לכתובת זו לעמוד הבית").
- Switch off = page in `hidden_pages`; switch on = page removed from
  `hidden_pages`.
- A "שמירה" button below the list — saves the whole list in one
  server action.

**Section 2 — מערכת (לא ניתן להסתיר)**
- A disabled, faded list of the four system keys: בית, אדמין,
  פרופיל, התחברות.
- Helper line above: "העמודים האלו תמיד פעילים — נדרשים לתפעול
  הבסיסי של המערכת."

### 9.2 Save flow

Server action `saveHiddenPages(keys: string[])`:

1. `isAdmin()` check.
2. Validate each key is in `HIDEABLE_PAGE_KEYS`. Unknown keys
   rejected.
3. Compute diff vs. current `settings.hidden_pages`.
4. Single UPDATE on `settings`. No transaction needed — single row.
5. Log `[page visibility save]` with the diff.
6. Revalidate the layout cache so the nav re-renders immediately.

### 9.3 Wire into admin home

Add a tile to `src/app/[lang]/admin/page.tsx`:
"זמינות עמודים" → `/admin/pages`.

---

## 10. Nav integration

`mobile-nav.ts` currently exposes a function (probably
`getMobileNavItems(config, role)`) that the bottom bar renders. We
extend that signature:

```ts
export function getMobileNavItems(
  config: MobileNavConfig,
  role: "player" | "admin",
  hiddenPages: ReadonlySet<string>,
): MobileNavItemMeta[] {
  return config.items
    .filter(k => MOBILE_NAV_KEY_SET.has(k))
    .filter(k => !hiddenPages.has(k))           // new gate
    .map(k => MOBILE_NAV_CATALOG[k])
    .filter(meta => allowedForRole(meta, role));
}
```

Single source of truth: the gate decides. `mobileNavConfig.items`
stays as the **curated order**. If admin re-enables a previously-
hidden page, it reappears at its existing position in the nav (no
data lost) — exactly the behavior we want per the locked answer.

Same approach for any **header / desktop nav** components that
reference the catalog. We grep for `MOBILE_NAV_ITEM_KEYS` /
`MOBILE_NAV_CATALOG` usages before merging to make sure no caller is
left filtering on its own.

---

## 11. QA checklist (rule 6 — extreme QA)

**Golden path:**
- Admin hides `duels`. Visit `/he/duels` directly → redirected to
  `/he/`. Toast appears: "העמוד אינו זמין כרגע." Refresh → no toast
  (param stripped).
- Same in `lang=en` → "This page is currently unavailable."
- Mobile bottom bar no longer shows the duels icon.
- Header link to duels (if present) is gone.

**Edge paths:**
- Hidden + URL contains a child segment (`/he/duels/<id>`): also
  redirects. Layout-level gate confirmed.
- Hide all 8 hideable pages at once. Visit `/he/`. Page loads. Mobile
  nav shows only system items (home / admin / profile depending on
  role).
- Admin visits their own `/he/admin` while everything else is hidden.
  Loads fine. (Hard rule from §4.1 holds.)
- Save with a non-catalog key (e.g. via direct fetch to the server
  action). Rejected by validation in §9.2.
- Multiple tabs: admin saves, another tab refreshes a hidden page —
  redirect happens. (Cache-busting handled by `revalidatePath`.)
- Mobile 360 px: admin toggle list usable, no horizontal scroll, all
  switches ≥44 px tap target.

**Regression sweep:**
- All eight pages reachable when nothing is hidden (default).
- `mobileNavConfig` editing still works — order and bottom-bar count
  preserved on save.
- No regression on admin role gating for `pay` (player-only) or
  `admin` (admin-only) — both are evaluated separately from
  visibility.

**Tests added:**
- `src/lib/page-visibility.test.ts` — pure helpers (catalog membership,
  redirect URL shape).
- One Playwright test — admin hides `transparency`; player visits
  `/he/transparency`; lands on home; toast visible; nav lacks the
  link.

---

## 12. Files this PR touches

**New:**
- `src/lib/page-visibility.ts` — catalog + `gatePage` + `readHiddenPages`
- `src/lib/page-visibility.test.ts`
- `src/db/migrations/00YY_page_visibility.sql` — `hidden_pages` column
- `src/app/[lang]/admin/pages/page.tsx`
- `src/app/[lang]/admin/pages/PageVisibilityForm.tsx`
- `src/app/[lang]/admin/pages/actions.ts`
- `src/components/HiddenPageToast.tsx` (client component)

**Modified:**
- `src/db/schema.ts` — new `settings.hiddenPages` column
- `src/lib/mobile-nav.ts` — `getMobileNavItems()` accepts a hidden set
- The 8 hideable pages' `page.tsx` files (one `gatePage(...)` call each)
- Any segment layouts that wrap children of hideable segments
- `src/app/[lang]/page.tsx` — read `?hidden=` and render the toast
- `src/app/[lang]/admin/page.tsx` — add the tile
- Any nav-rendering component that calls `MOBILE_NAV_CATALOG`
  directly without going through `getMobileNavItems()` — grepped and
  fixed in this PR.

---

## 13. Alternatives considered (and rejected)

**A. Middleware-based gate.** Single `middleware.ts` reads
`settings.hidden_pages` per request and rewrites. Cleanest one-stop,
but every static asset request would also hit the DB read; even
cached, it's an extra layer of complexity for a feature that only
needs to gate page render. The layout/page-level call is colocated
with the code it protects — easier to read, easier to test.

**B. Soft hide — link removed, URL still loads.** Rejected by Yoav's
explicit answer: a hidden page must be inaccessible even by direct
URL.

**C. Per-language hiding.** Hide `bets` in Hebrew but not English.
Rejected: friends pool, one product, one truth. Adds a second
dimension to every toggle for no real-world use.

---

## 14. Out of scope / future work

- **Scheduled hide / unhide.** ("Hide live scores between 02:00 and
  06:00.") Not requested; can fold into a future PR with the same
  data shape.
- **Per-user role hide.** ("Show live scores only to paid users.")
  Already covered by the existing role gates on `pay` and `admin`;
  not a visibility feature.
- **Custom unavailable page** with explanatory body. Yoav chose the
  toast option; a dedicated page is the rejected option B in §13.
