# Rules page (/rules) + always-visible prizes

Date: 2026-05-26
Status: Approved, ready to implement

## Goal

Two related asks from the user:

1. A short, plain-language "how this works" page covering what the pool
   is, how to bet, how scoring works, and how prizes are distributed.
   Brief — not a wall of text.
2. A consistently visible breakdown of prizes 1-4 (Hebrew: 1-4), so
   players (and guests) know what they're playing for even before any
   payments have landed in the pot.

## Decisions taken with the user

- Dedicated page at `/rules` (Hebrew label: "חוקי המשחק", English: "How
  it works"). Linked from the Profile dropdown on desktop and the
  "More" sheet on mobile. Not in the primary nav — it is reference
  content, not a daily-use destination.
- Prizes 1-4 live both on the rules page AND on the home page. The
  current `PrizeStrip` is modified so it does not bail out when
  `potIls === 0` — it shows the percentages and `0 ILS` placeholders
  so a first-time visitor sees the structure.
- `/rules` is public (no login required) so guests can read it from
  the landing page before signing up.

## Page sections

In order, each tight:

1. **מה זה?** / **What is this?**
   Two sentences. Friends-only pool around the 2026 World Cup; everyone
   predicts, the top 4 split the pot.

2. **איך מהמרים?** / **How to bet**
   - In **הימורים** pick the match day, then each match.
   - Per match: tap 1/X/2 for the basic pick, or fine-tune the exact
     score with +/-.
   - Tournament-wide bets (champion, top scorer, ...) and group
     standings bets live in their own cards under `/play`.

3. **איך מנקדים?** / **Scoring**
   - Exact score = **3 pts**
   - Correct outcome (1/X/2) = **1 pt**
   - Tournament + group bets have their own payouts (shown on each
     bet card).

4. **בנק נקודות** / **Points bank**
   - Every bet costs points from your bank. Right answer → stake back
     + payout. Wrong → stake stays in the pool.
   - Your current bank balance is the pill in the top header.

5. **קופה ופרסים** / **Pot and prizes** (with `PrizeStrip`)
   - Entry: 100 ILS via Paybox.
   - The pot pays out to ranks 1-4 per the percentages configured by
     the organizer.

## Component changes

### `src/components/PrizeStrip.tsx`

Drop the `if (prize.potIls <= 0) return null` and `if (positive.length
=== 0) return null` early exits — render the full strip with whatever
amounts the pot produces (zero is fine). The "from current pot" caption
becomes "תזרים מהקופה" / "from current pot: 0 ILS" when nothing has
landed yet; the percentages still convey what the split looks like
once payments come in. The rank-1 highlight stays.

### `src/components/ProfileMenu.tsx`

Add a "חוקי המשחק" row above the logout entry. Same `flex items-center
gap-3 px-4 min-h-[48px]` shape as the other rows. Closes the menu on
click via the existing `close` handler.

### `src/components/MobileMoreSheet.tsx`

Add `rules` to the `SheetItem["key"]` union and to the `Labels` type.
Push it after `profile` so the visible order in the sheet is:

  תשלום (player only) · ניהול (admin only) · פרופיל · חוקי המשחק · התנתקות

Icon: `BookOpen` from lucide.

### `src/proxy.ts`

Add `"rules"` to `PUBLIC_PATHS`. Currently `["", "login", "signup"]`.

## Affected files

### New
- `src/app/[lang]/rules/page.tsx` — the page itself
- `_plans/2026-05-26-rules-page.md` — this plan

### Modified
- `src/components/PrizeStrip.tsx` — drop pot=0 early exit
- `src/components/ProfileMenu.tsx` — add rules link
- `src/components/MobileMoreSheet.tsx` — add rules row
- `src/components/AppShell.tsx` — pass `rules` label and `homeIsClear`
  into MobileMoreSheet labels
- `src/proxy.ts` — `PUBLIC_PATHS`
- `src/app/[lang]/dictionaries/he.json`, `en.json`
  - `nav.rules`
  - new `rules` block: `title`, `intro`, plus headings and bodies for
    each of the 5 sections, plus `prizesNote` for "from current pot"
    when zero.

## Observability (rule 14)

- `[rules render]` server log on each page render with `{ isHebrew,
  potIls, signedIn }`.

## Settings (rule 15)

No new settings. The prize percentages are already settings-driven
(`settings.prize_pct_1..4`); the page surfaces what's already there.

## Out of scope

- Live edits to rules by admins. Copy lives in dictionaries; admin
  editing of marketing copy would be a separate feature.
- The full points-bank ledger view (`/me/bank` already exists for that).
- Per-bet payout tables for the custom-bets system. The rules page
  points players at the bet cards themselves.

## QA checklist

1. Signed-out visitor → `/rules` loads without redirect to login.
2. Signed-in player → `/rules` loads. Profile dropdown shows the link.
3. Mobile signed-in → "More" sheet includes "חוקי המשחק" between
   profile and logout.
4. Home page with `potIls === 0` → PrizeStrip is visible with
   percentages and "0 ILS" amounts.
5. Home page with `potIls > 0` → PrizeStrip behaves as before.
6. Rules page on Hebrew (`/he/rules`) → RTL flows correctly.
7. Rules page on English (`/en/rules`) → LTR flows correctly.
8. Mobile (360px) → all sections fit, no horizontal scroll.
9. PrizeStrip on the rules page is identical to the one on home.
10. Typecheck + build + lint green.

## Alternatives considered and rejected

- **Modal `?` icon in header**: dismissable info bubbles get ignored
  on second visit. A page can be linked, shared, and bookmarked.
- **Always-on-home collapsible**: pollutes the dashboard for repeat
  users who already know the rules. Profile dropdown is the right
  place for reference content.
- **Splitting rules and prizes into two pages**: prizes are part of
  how the game works; splitting buries the most actionable detail
  (what do I win?) under an extra click.
