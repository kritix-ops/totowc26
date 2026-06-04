// Scenario: live bets (per-match picks + matchday/day bets).
// Acceptance criteria live in the user prompt - the agent has
// them in context and reports a finding per criterion that fails.

export const liveBetsScenario = {
  name: "live-bets",
  userPrompt: ({
    baseUrl,
    qaBotEmail,
    qaBotPassword,
  }: {
    baseUrl: string;
    qaBotEmail: string;
    qaBotPassword: string;
  }): string => `
Test the live-bets flow at ${baseUrl}.

Steps:
1. Navigate to /he/login. Sign in as ${qaBotEmail} with password
   ${qaBotPassword}. Take a screenshot if anything looks off.

2. Navigate to /he/bets. Confirm:
   - The page renders in Hebrew, RTL layout.
   - Match cards show team names and kickoff times.
   - Kickoff times are in IL local time (look for a sensible hour
     in 24h format, e.g. "21:00" not "01:00 UTC").
   - Record any match card that is missing a name, a time, or a
     team flag.

3. Pick the first match whose kickoff is clearly in the future
   (more than 60 minutes away - if all visible matches are within
   60 minutes, just pick the latest one and note that). Open it.
   Place a 1X2 pick (1, X, or 2 - your choice).
   - Confirm you see a success indicator.
   - Reload the page. Confirm your pick is still selected.

4. Find a match whose deadline has already passed (or is within
   5 minutes of kickoff). If you can find one:
   - Confirm the form is disabled.
   - Confirm there is a clear Hebrew lock message explaining why.
   - If neither is true, record a finding.

5. Navigate to /he/bets and try to place a day-bet (matchday
   bet) on today's matchday. Confirm:
   - Stake input accepts a reasonable value.
   - The page shows "Total points" or equivalent, and the value
     is the same as "Available to bet" (they are aliases in this
     app - if they differ, that is a finding).

6. When done, return a one-paragraph summary of what you tested
   and what you found.

You have at most 25 tool calls for this scenario. Be efficient.
`,
};
