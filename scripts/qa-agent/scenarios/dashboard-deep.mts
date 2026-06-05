// Scenario: signed-in home / dashboard deep-dive.
//
// The /he landing for a signed-in user is the front door for every
// other surface. If it is wrong here, every flow downstream feels
// broken. We check the bank pill math, the section headings, the
// "see all" CTAs, and the leaderboard preview - all things rtl-
// mobile sweeps past too quickly to verify functionally.

export const dashboardDeepScenario = {
  name: "dashboard-deep",
  userPrompt: ({
    baseUrl,
    qaBotEmail,
    qaBotPassword,
  }: {
    baseUrl: string;
    qaBotEmail: string;
    qaBotPassword: string;
  }): string => `
Deep-dive the signed-in landing at ${baseUrl}/he.

# Setup
1. Navigate to /he/login. Sign in as ${qaBotEmail} with password
   ${qaBotPassword}.
2. browser_wait for=ms value=2000.

# Step 1 — landing chrome
3. Navigate to /he.
4. Confirm the header carries:
   - Brand logo (link to /he), tap area >= 44x44.
   - Bank pill showing a balance like "X/Y" (e.g. "30/30").
     X (available) and Y (total) should be the same number per
     the points model — if X != Y on a fresh qa-bot account that
     has placed no live bets, that is a finding.
   - User-menu avatar (typically circular, top-right corner of
     the visual layout — top-left in RTL flow).

# Step 2 — section anatomy
5. Snapshot the landing main area. Confirm the page has:
   - A welcome / heading row.
   - A "ניחושי משחקים" / match picks teaser section.
   - A "מובילים" / leaders section with a "טבלה מלאה" CTA.
   - A "הימורי לייב" / live bets teaser section with a "הצג הכל"
     CTA.
6. Read the "--- main raw text ---" section to confirm meaningful
   content actually rendered — not just placeholders.

# Step 3 — CTA targets
7. Click the "טבלה מלאה" (full leaderboard) link.
8. Confirm you land on /he/leaderboard with the tab pills visible
   and "כללי" marked as [current=page].
9. Use the browser back navigation (or navigate explicitly) back
   to /he.
10. Click a section's "הצג הכל" link.
11. Confirm it navigates to a relevant detail page.

# Step 4 — bank pill consistency
12. From the header on /he, note the bank pill value (e.g. "30/30").
13. Navigate to /he/me/bank. Confirm the page's main balance line
    matches the pill exactly. If the pill says "30/30" but the
    bank page shows balance 28, that IS a finding (cache
    invalidation broken between the pill cache and the page
    query).

# Step 5 — mobile vs desktop
14. browser_resize to 360x800 and re-snapshot /he. Confirm the
    bottom nav appears (since we changed the breakpoint to lg,
    tablet and mobile both have it).
15. browser_resize to 1440x900 and re-snapshot /he. Confirm the
    desktop top nav has its full 7 items and bottom nav is gone.

# Things that are NOT findings
- "The bank pill displays X/Y instead of just X" - the pill is
  intentionally available/total per the project's points model,
  even when X equals Y.
- "The dashboard layout differs between mobile and desktop" -
  responsive layout is the design.

# Budget: 25 tool calls.
Return a one-paragraph summary covering bank pill consistency,
section integrity, and CTA targets.
`,
};
