# 2026-05-29 — Admin area reorganization + rules content editor

## Goals

1. **Mobile labels never truncate.** The current 2-column tile grid kills every label below ~8 characters at 360px (`משת...`, `בקשו...`, `הימו...`). Mobile is the primary canvas — this is the highest-priority UX failure.
2. **Logical grouping over flat list.** 15 tiles + 6 inline panels = 21 surfaces competing for attention with no hierarchy. Admins should find things by topic, not by scroll memory.
3. **Set-once-and-forget separated from daily work.** Sync, Backup, Paybox URL, WhatsApp URL, ViewAs, Signup toggle — all rarely touched. They should not occupy prime real estate on the landing page.
4. **A dedicated, friendly editor for the rules page + page guide.** Currently the rules page text is technically editable via `/admin/content`, but it's buried among ~400 other dictionary keys. The PAGE_GUIDE array (13 pages × 2 locales × 2 fields = 52 strings) is not editable at all — it's hardcoded in `rules/page.tsx`.

## Approach: Sectioned single-page + purpose-split panels (per user)

Picked over Category-cards (extra click cost) and Sidebar (foreign pattern in this app, breaks visual consistency with the rest of the bottom-nav-driven UI).

### New admin home structure (`/admin/page.tsx`)

Sections, each rendered as a vertical list on mobile (full-width rows, label always visible) and a 2-column grid on `md+`:

1. **אנשים וכסף** (People & money)
   - משתתפים *(badge: pending signup requests)*
   - ניקוד ובנק
   - מועדי סגירה

2. **הימורים** (Bets)
   - הימורי לייב (`/admin/bets`, the existing list — keeps the existing label even though the route name is `bets`)
   - הימורי טורניר
   - כפילויות הימורים *(conditional, with badge)*
   - תרגום שחקנים

3. **תוכן ונראות** (Content & visibility)
   - עריכת תוכן (the generic flat editor — kept)
   - עריכת חוקים ועזרה *(NEW — /admin/rules)*
   - זמינות עמודים
   - תפריט מובייל

4. **תקשורת** (Communications)
   - שליחת הודעה

5. **מערכת ותפעול** (System & ops)
   - מערכת ותפעול → `/admin/system` *(NEW)*

Header keeps the pot total card. The two "external" shortcut tiles (`כל המשחקים`, `טבלת הבתים`) drop entirely — they aren't admin functions, just convenience links that the bottom-nav already covers.

### `/admin/users` gets a third tab (Payments)

The existing `PaymentsPanel` on the home page is a focused queue view that complements the per-user drawer. Move its content into a third tab inside `/admin/users` alongside `משתתפים` and `בקשות הרשמה`. URL becomes `?tab=payments`.

KPI card "ממתינים תשלום" on the users page becomes a link to that tab.

### `/admin/system` (NEW page)

Hosts everything set-once-then-forget:
- **הגדרות** (Settings) — Paybox URL, WhatsApp group URL, signup toggle, ViewAs
- **תפעול** (Ops) — Sync (with team-mapping banner + API quota), Backup
- **בדיקה** (Debug) — Email test, Push test (tiles linking to existing pages)

Same sectioned vertical-list-on-mobile pattern as the home.

### `/admin/rules` (NEW page)

Purpose-built editor that writes through the existing `saveOverride` action and content_overrides table — no new schema, no parallel storage.

Two sections:
1. **תוכן עמוד החוקים** — One card per rules subsection (`rules.title`, `rules.subtitle`, `rules.whatTitle`, `rules.whatBody`, `rules.howTitle`, `rules.howBody`, `rules.bankTitle`, `rules.bankBody`, `rules.scoringTitle`, `rules.scoringBody`, `rules.tournamentTitle`, `rules.tournamentBody`, `rules.liveTitle`, `rules.liveBody`, `rules.duelsTitle`, `rules.duelsBody`, `rules.payoutsTitle`, `rules.payoutsBody`). Each card has He + En textareas side-by-side on desktop, stacked on mobile.
2. **הסבר על הדפים** — 13 page-guide rows. Each row has the icon (from code), path label, and He + En name + desc fields.

PAGE_GUIDE strings move from the inline array in `rules/page.tsx` to dictionary keys under `rules.pageGuide.<pathKey>.{name,desc}`. Icons stay in code (`path → icon` map) — they don't need to be editable.

## Implementation steps

1. Save this plan
2. New `SectionedTileGrid` component (mobile vertical list, desktop grid, with section headers)
3. `/admin/users` — add Payments tab
4. `/admin/system` — new page
5. `/admin/page.tsx` — rewrite to sectioned grid, drop relocated panels
6. Dictionaries — add `rules.pageGuide.*` keys (he + en)
7. `/admin/rules` — new editor page
8. `rules/page.tsx` — read PAGE_GUIDE from dictionary, keep icon map inline
9. tsc + eslint clean

## Out of scope

- Renaming "הימורי לייב" tile when it actually points to the generic bets list (existing labeling oddity — separate UX decision).
- Building a true sidebar layout (rejected option B).
- Reachability of `/admin/live-bets/suggestions` from the home page — currently no tile points there at all; not introducing one now.
- Renaming/cleanup of any existing admin route paths. Old URLs stay alive.

## Security / observability

- `/admin/system` and `/admin/rules` inherit `requireAdmin` via the `admin/layout.tsx` cascade. No new auth surface.
- All writes from `/admin/rules` go through the existing `saveOverride` action, which already calls `assertAdmin` + slot validation + audit log via `writeOverride`. No parallel write path.
- Logs already exist on saveOverride (`[admin content save] start/done/db_error`). Add namespaced logs on new tab navigation (`[admin people tab]`, `[admin system]`, `[admin rules]`) per Yoav's rule 14.

## Settings audit (per rule 15)

Nothing user-facing changes — this is purely an admin reorg. No new player-side knobs.
