# Nav realignment after audit

Date: 2026-05-26
Status: Approved, ready to implement

## Goal

Bring the top (desktop) nav and bottom (mobile) nav into one coherent
system after several rounds of incremental additions left them
inconsistent in items, order, and labels. A user moving between mobile
and desktop should see the same menu, in the same order, with the same
names.

## Problems audit found

1. Same page, two labels: `/` ("ראשי" vs "דאשבורד"), `/bets`
   ("ההימורים שלי" vs "ניחושים").
2. Top has Play and Standings; bottom has Leaderboard and Profile.
   Mobile users could not reach the main betting hub (`/play`) from
   the nav at all — only via dashboard shortcuts.
3. "טבלה" was being reused for three different concepts: `/standings`
   (FIFA group tables), `/leaderboard` (toto pool rankings), and a
   dashboard widget titled "טבלת המובילים". Easy to confuse.
4. `/bets` (flat list of upcoming matches) and `/play` (matchdays +
   tournament + groups) were two entry points to essentially the same
   functionality.
5. No consistent ordering principle between top and bottom.

## Decisions

### Information architecture
- Merge `/bets` into `/play`. `/play` becomes the single betting hub.
- Keep `/bets/[matchId]` URL for the single-match bet form — it is
  cited by dozens of links and is semantic ("place a bet on a match").
- Keep `/standings` and `/leaderboard` as separate pages — they show
  different data — but disambiguate their labels.

### Canonical labels

| Path | Hebrew | English |
|---|---|---|
| `/` | ראשי | Home |
| `/play` | הימורים | Bets |
| `/leaderboard` | מובילים | Leaders |
| `/club` | מועדון | Club |
| `/standings` | המונדיאל | World Cup |
| `/pay` | תשלום | Pay |
| `/profile` | פרופיל | Profile |
| `/admin` | ניהול | Admin |

Labels are identical between top and bottom nav.

### Top nav (desktop, signed in)

Order, left to right (RTL: right to left):
```
ראשי · הימורים · מובילים · מועדון · המונדיאל · תשלום
   [divider — admin only]   ניהול
```
- `תשלום` is hidden for admins (no balance to pay).
- `ניהול` is admin-only and sits after a divider.
- Avatar dropdown on the far end keeps: פרופיל, ניהול (admin), התנתק.

### Bottom nav (mobile, signed in)

5 fixed cells in the same order as desktop, then "עוד" as the 6th:
```
ראשי | הימורים | מובילים | מועדון | עוד
```
Tapping "עוד" opens a bottom sheet with the items that didn't fit
plus account/session controls:
- המונדיאל
- תשלום (player only)
- ניהול (admin only)
- פרופיל
- התנתקות

Why a sheet, not more tabs: at 360px, 7 cells = ~51px each → labels
clip and tap zones get cramped. Per CLAUDE.md project rule, mobile
must work flawlessly. 5 + "More" is the common pattern (Instagram,
LinkedIn, Spotify) and keeps the primary surface clean.

## Affected files

- `src/app/[lang]/dictionaries/he.json`, `en.json`
  - Add: `nav.worldCup`, `nav.leaders`, `nav.more`, `nav.logout`
  - Repurpose `nav.play` → label is now "הימורים" / "Bets"
  - Remove (or stop reading): `nav.myBets`, `nav.dashboard`,
    `nav.predictions`, `nav.standings` (replaced by `nav.worldCup`),
    `nav.leaderboard` (replaced by `nav.leaders`)
- `src/components/AppShell.tsx`
  - New top nav order
  - New bottom nav: 5 + More
- `src/components/MobileMoreSheet.tsx` (new)
  - Client component, bottom sheet with overflow items
- `src/app/[lang]/bets/page.tsx`
  - Replace body with `redirect(localePath(locale, "play"))`
- `src/app/[lang]/page.tsx`
  - Update "view all" link from `bets` to `play`
  - Update LeaderboardSection heading from "טבלת המובילים" /
    "Standings" to "מובילים" / "Leaders" so it matches the new
    canonical label
- Search for any other `localePath(locale, "bets")` and switch to
  `"play"` (except `/bets/[matchId]` which stays)

## Observability (rule 14)

Each nav surface logs once on render with the namespace already
established in `AppShell.tsx`:
- `[app shell render]` — keep existing payload, add `mobileNavCells`
  count and `moreSheetHasItems` flag.
- `[mobile more sheet open]` — new, logged from the sheet client
  component when opened.

## Settings (rule 15)

No new settings introduced. The nav layout is opinionated and
identical for all users. Future audit: if users ask to customize
which 4 items go in the bottom bar, that becomes a setting then,
not now.

## Out of scope

- Visual redesign of nav items (colors, icons) — only structure and
  labels change.
- Moving `/bets/[matchId]` to `/play/[matchId]` — keep current URL.
- Reordering `/play` internal sections (tournament card, groups card,
  matchdays) — not part of this pass.

## QA checklist

1. Signed-out guest: header shows Sign in / Sign up. No bottom nav.
2. Signed-in player on desktop (1440px): all 6 items visible, avatar
   dropdown with profile + logout. No Admin chip.
3. Signed-in player on mobile (360px): 5 cells + עוד. Tap עוד →
   sheet shows המונדיאל, תשלום, פרופיל, התנתקות.
4. Admin on desktop: top nav drops תשלום, adds ניהול after divider.
5. Admin on mobile: עוד sheet shows המונדיאל, ניהול, פרופיל,
   התנתקות (no תשלום).
6. Admin impersonating a player ("viewing as"): banner stays, nav
   matches a regular player nav (existing behavior preserved).
7. `/bets` direct visit → redirects to `/play`.
8. `/bets/abc123` (real matchId) → opens the bet form unchanged.
9. Dashboard "view all" on upcoming matches → goes to `/play`.
10. RTL/LTR: labels read correctly in both languages.
11. Press header logo → home.
12. No horizontal scroll at 360px on any page.

## Alternatives considered and rejected

- Keeping `/bets` separate as "my picks": adds a redundant entry
  point for a friends pool app where nobody will distinguish "place a
  bet" from "manage my bets". Cut it.
- 6 mobile cells with World Cup as the 5th: cramped at 360px, no room
  for Profile without a sheet anyway. Sheet is cleaner.
- Renaming `/leaderboard` to "Standings" and `/standings` to
  "Groups": leaks tournament jargon to the menu — most players don't
  use the term "groups" casually in Hebrew.
