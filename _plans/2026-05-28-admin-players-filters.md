# Admin player-translation queue: filters + smart search

**Date:** 2026-05-28
**Status:** approved, executing
**Scope:** `/admin/players` only. No DB schema changes.

## 1. Goal

Make `/admin/players` usable as a real triage surface across the 1,357-row queue. Today it has one filter (verdict) and no search. Admin wants every meaningful parameter exposed and an instant, fuzzy player search.

## 2. Requirements

1. Search box that matches across `name_en`, `name_he`, team name (both locales), jersey number, `api_football_id`. Instant (no debounce; client-side).
2. Filter by:
   - Verdict (reject / flag / unreviewed / approved)
   - Team (48 options — searchable dropdown using the existing `SearchableChoicePicker`)
   - Source (wikidata / llm_claude / llm_reviewer / manual / null)
   - Position (Goalkeeper / Defender / Midfielder / Attacker / null)
   - Admin-locked status (any / locked / unlocked)
3. Dynamic counts on every chip given the other active filters (so "Brazil" shows "3 rejected" when Verdict=reject is also active).
4. Filter chips show a single active set + a "Clear all" button when anything is filtered.
5. Mobile-first: full-width controls at 360px, 16px input font, 44px+ touch targets.
6. Hebrew/English search both work — typing "מסי" finds Messi, typing "messi" finds Messi.

## 3. Architecture

**Server (page.tsx):** loads ALL 1,357 rows in one query, drops the existing `limit: 800`. Hands them to the new `<PlayerReviewBoard>` client component along with the parsed `?verdict=` URL hint (kept for backwards-compat — existing bookmarks must still work).

**Client (`PlayerReviewBoard.tsx`):** owns all filter state in `useState`. Computes the filtered + counted slice in one `useMemo`. Renders `<PlayerFilterBar>` + the row list. Keystroke → instant re-render. No network on filter change.

**`PlayerFilterBar.tsx`:** the controls. Always visible: search box, verdict chip strip. Behind an expandable section: team picker (uses `SearchableChoicePicker`), source pills, position pills, lock toggle, "Clear all" button. The expand button label includes the active-filter count when collapsed.

Payload size sanity check: 1,357 rows × ~400 bytes JSON each ≈ 540 KB. Acceptable for an admin-only page on desktop / strong mobile network. We're sending no photo blobs — `photoUrl` is a string the browser will lazy-fetch via `next/image`.

## 4. Decisions made

- **Client-side filter, single full load.** Instant feel + dynamic counts trump network savings on a one-admin tool.
- **`?verdict=` URL stays read-only.** Initial state hydrates from it, but changes don't push back to the URL. Keeps the back/forward stack clean while admin is triaging. Bookmark-by-verdict still works via the existing URL form.
- **No confidence slider in v1.** Sort already brings low-confidence rows to the top; a slider adds chrome without clear demand.
- **Position uses the API-Football raw value** ("Goalkeeper", "Defender", "Midfielder", "Attacker"). Hebrew labels via the existing glossary in `src/lib/translations/glossary.ts`.

## 5. Security

- Server-side `requireAdmin(locale)` already in `page.tsx`. No new auth surface.
- All filter state is client-side and read-only — no new server actions.

## 6. QA gates

1. 360px width: search box full-width, verdict chips fit (horizontal scroll if needed), no overflow.
2. Type "messi" → only Messi rows render.
3. Type "מסי" → same.
4. Click "ברזיל" in team picker → only Brazilian players.
5. Stack verdict=flag + team=BRA + source=llm_reviewer → counts everywhere reflect the intersection.
6. "Clear all" wipes every filter back to default in one click.
7. URL `/admin/players?verdict=reject` opens with the reject filter pre-applied.
8. Admin approves/edits a row → `router.refresh()` reloads server data → filter state is preserved (still on Verdict=reject).
