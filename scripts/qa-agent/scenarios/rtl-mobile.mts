// Scenario: RTL + Hebrew + mobile-responsive sweep.
//
// We visit a curated set of high-traffic Hebrew pages at three
// viewports (mobile / tablet / desktop) and run the project's
// responsiveness rules from CLAUDE.md against each one:
//   - no horizontal overflow at the page level (carousels and
//     opt-in scrollable strips are exempt — the agent's
//     browser_check_horizontal_overflow already skips children of
//     overflow-x:auto ancestors)
//   - every tap target >= 44x44 on the 360px viewport (inline
//     text links inside <p>/<li> are exempt)
//   - bottom-nav padding (mobile section main needs pb-24 so
//     content does not slip under the fixed nav)
//
// Pages chosen for impact-per-turn. Adding more pages would push
// the turn count past 60 without surfacing new bug classes - the
// patterns repeat across surfaces. If a real bug exists in this
// app's mobile UI, it almost certainly appears on at least one of
// the seven pages below.

import { VIEWPORTS } from "../config.mts";

const PAGES_TO_SWEEP = [
  "/he",
  "/he/bets",
  "/he/bets/tournament",
  "/he/bets/groups",
  "/he/bets/live",
  "/he/me/bank",
  "/he/leaderboard",
];

// Cut the viewport list to the three that matter most. Full sweep
// across all five (mobile/+/tablet/desktop/wide) eats 50+ turns
// without surfacing new bug classes - desktop-only bugs rarely
// hide between 1024 and 1440. Three viewports × seven pages × ~2
// tool calls each fits inside the scenario's 60-turn budget.
const SWEEP_VIEWPORTS = VIEWPORTS.filter((v) =>
  ["mobile-360", "tablet-768", "desktop-1440"].includes(v.name),
);

export const rtlMobileScenario = {
  name: "rtl-mobile",
  userPrompt: ({
    baseUrl,
    qaBotEmail,
    qaBotPassword,
  }: {
    baseUrl: string;
    qaBotEmail: string;
    qaBotPassword: string;
  }): string => `
Test the RTL + mobile responsive behaviour at ${baseUrl}.

# Setup
1. Navigate to /he/login. Sign in as ${qaBotEmail} with password
   ${qaBotPassword}.
2. Wait for the redirect (browser_wait for=ms value=2000).

# The matrix
For EACH viewport in this list:
${SWEEP_VIEWPORTS.map((v) => `  - ${v.name} (${v.width} × ${v.height})`).join("\n")}

…visit EACH of these pages:
${PAGES_TO_SWEEP.map((p) => `  - ${p}`).join("\n")}

# Per (viewport, page) pair, the loop is:
1. browser_resize to the viewport's width × height.
2. browser_navigate to the page.
3. Take a screenshot named like "rtl-<viewport>-<pagename>" so the
   user can review later.
4. Run browser_check_horizontal_overflow.
   - If offenders > 0 AND the viewport width <= 414, record a HIGH
     finding. Quote the first 2-3 offenders' tag + class + side
     ("left" vs "right" — RTL pages overflow LEFT, LTR overflow
     RIGHT).
   - Tabs/snap-carousels with intentional overflow-x are already
     filtered out by the check; if the tool returns them, that is
     a real layout escape and worth flagging.
   - Offenders on viewport >= 768 are usually NOT findings (desktop
     widths rarely produce real overflow bugs). Skip those.
5. On mobile viewports only (width <= 414), run
   browser_check_tap_targets.
   - If tooSmallCount > 0, record a MEDIUM finding with the first
     2-3 offenders. The 44×44 rule applies to standalone buttons
     and icon-only controls; inline text links inside <p>/<li>
     are already filtered out.
6. Scan the "--- main raw text ---" section of the post-navigate
   snapshot for trouble signs:
   - Text ending in "…" or visibly truncated mid-word → MEDIUM
   - English copy where Hebrew is expected (e.g. "Login" instead
     of "התחבר") → LOW (this would be a translation gap, not a
     style bug)
   - "[object Object]" or "undefined" rendered anywhere → HIGH
     (template literal mistake, real bug)
7. Skip the page if it returns a redirect to /login or /onboarding
   — that is the auth flow, not a layout bug.

# Things that are NOT findings (calibrated from earlier runs)
- "No admin-published live/day bets yet" — sandbox default. Skip.
- "Card shows score 4-0 for unstarted match" — that is the user's
  saved prediction, labelled with "תחזית". The match has not
  started. NOT a finding.
- "Saturday weekday is formatted as 'יום שבת' not 'שבת'" — that
  is the intended Hebrew weekday format (matches every other
  day's "יום X" pattern).
- "Header logo is 36px tall on mobile" — the click area is now
  min-h-[44px]; the visible logo at 36px is fine.
- "The bank page is blank" — false positive from earlier runs.
  Before recording, re-read the "--- main raw text ---" section.
  If it has >80 chars, the page IS rendered.

# Budget
You have at most 60 tool calls. The three viewports × seven pages
= 21 pairs; budget about 2-3 tool calls each (resize, navigate,
checks, screenshot). When you run out of time, stop and write the
summary — covering 5 mobile-viewport pages is more useful than
covering 3 viewports for 7 pages.

Return a one-paragraph summary covering: which (viewport, page)
pairs you actually completed, the top issues by severity, and
any pattern (e.g. "the bracket page is the worst offender on
360" — though /he/bracket does not exist in this app, so do not
expect to find it).
`,
};
