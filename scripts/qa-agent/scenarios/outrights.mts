// Scenario: tournament outrights (winner, top scorer, group winners).
// These are FREE bets in the points model - stake is 0 and max
// payout is capped at 25.

export const outrightsScenario = {
  name: "outrights",
  userPrompt: ({
    baseUrl,
    qaBotEmail,
    qaBotPassword,
  }: {
    baseUrl: string;
    qaBotEmail: string;
    qaBotPassword: string;
  }): string => `
Test the tournament-outrights flow at ${baseUrl}.

Steps:
1. Navigate to /he/login. Sign in as ${qaBotEmail} with password
   ${qaBotPassword} if not already signed in.

2. Navigate to /he/tournament-bets (or whichever page is the
   tournament bets page - check the bottom nav if unsure).
   Confirm all five categories are present:
   - Winner of the tournament
   - Runner-up
   - Top scorer
   - Group winners (per group)
   - Top scorer per team (or similar)
   If any category is missing, record a high-severity finding.

3. Place one pick in each category you can find. After each:
   - Confirm a success indicator appears.
   - Confirm the displayed stake is 0 (these are free bets).
   - Confirm the maximum payout shown is 25 (the configured cap).
   If stake is not 0 or max payout is not 25, that is a critical
   finding (model misconfiguration).

4. Navigate away and back. Confirm your picks persist.

5. Try to edit a pick whose deadline has passed (if you can
   identify one - look for a lock icon or grayed-out card). If
   you can change it, that is a critical finding.

6. When done, return a one-paragraph summary.

You have at most 25 tool calls for this scenario. Be efficient.
`,
};
