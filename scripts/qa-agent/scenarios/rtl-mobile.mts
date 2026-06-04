// Scenario: RTL + Hebrew + mobile responsive sweep.
// Visits the main pages at each of the project's standard
// viewports and runs in-page checks for the classic mobile bugs:
// horizontal overflow, tiny tap targets, bottom-nav obscurance.

import { VIEWPORTS } from "../config.mts";

const PAGES_TO_SWEEP = [
  "/he",
  "/he/bets",
  "/he/tournament-bets",
  "/he/leaderboard",
  "/he/bracket",
  "/he/standings",
  "/he/profile",
];

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

Setup:
- Sign in once at /he/login as ${qaBotEmail} with password
  ${qaBotPassword}.

For EACH of these viewports:
${VIEWPORTS.map((v) => `  - ${v.name} (${v.width}x${v.height})`).join("\n")}

...visit each of these pages:
${PAGES_TO_SWEEP.map((p) => `  - ${p}`).join("\n")}

On every (viewport, page) pair:
1. Resize to the viewport (browser_resize).
2. Navigate to the page.
3. Take a screenshot named like "rtl-<viewport>-<pagename>".
4. Call browser_check_horizontal_overflow. If offenders > 0 on a
   viewport <= 768 wide, record a high-severity finding with the
   first 3 offenders in the actual field.
5. On viewports <= 414 (mobile), call browser_check_tap_targets.
   If tooSmallCount > 0, record a medium-severity finding with
   the first 3 offenders.
6. Scan the snapshot text for:
   - Headings or labels that look truncated (ending in "...").
     Record medium.
   - Any text that appears in English where Hebrew is expected
     (e.g. "Login" instead of "התחבר"). Record low.

This will be a lot of (viewport, page) pairs. Prioritise the
mobile viewports (360, 414) - desktop overflow is usually fine.
If you run out of turns, stop and summarise what you tested. The
runner will not penalise you for skipping desktop viewports.

When done, return a one-paragraph summary covering: which
(viewport, page) pairs you actually tested, the top issues by
severity, and any pattern you noticed (e.g. "the bracket page is
the worst offender on 360").

You have at most 60 tool calls for this scenario.
`,
};
