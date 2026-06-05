// Scenario: bulk-fill via the "תפתיע אותי" / "Surprise me" button.
//
// Each surface (/he/bets, /he/bets/tournament, /he/bets/groups,
// /he/bets/live/<date>) renders the button when the surface has
// open unfilled bets the user could plausibly fill. The bot's
// existing picks (from earlier QA runs) make some surfaces "all
// filled" - in that case the button is hidden by design and the
// bot should record that, not file it as a missing-button finding.
//
// Surprise Me writes to the DB but is idempotent in the agent
// sense: the next QA run can re-fill / re-overwrite the same picks
// without state pollution. The cost is acceptable.

export const surpriseMeScenario = {
  name: "surprise-me",
  userPrompt: ({
    baseUrl,
    qaBotEmail,
    qaBotPassword,
  }: {
    baseUrl: string;
    qaBotEmail: string;
    qaBotPassword: string;
  }): string => `
Test the bulk-fill "תפתיע אותי" flow on each bets surface at
${baseUrl}.

# Setup
1. Navigate to /he/login. Sign in as ${qaBotEmail} with password
   ${qaBotPassword}.
2. browser_wait for=ms value=2000.

# Step 1 — /he/bets (match picks)
3. Navigate to /he/bets.
4. Look for a button labelled "תפתיע אותי" / "Surprise me" / "תפתיע".
5. If the button is missing AND the snapshot shows match cards in
   "נשמר" state (i.e. every match already has a pick), that is
   correct - there is nothing left to fill. Note it but do NOT
   file a finding.
6. If the button is present:
   - Click it. A confirmation step usually opens (a sheet or
     inline confirm). If a confirm button appears (e.g. "בצע" /
     "אשר" / "מלא לי"), click it.
   - browser_wait for=ms value=3000.
   - Re-snapshot. Confirm at least 3 previously-blank match cards
     now show non-zero scores AND the saved state.
   - If clicking the confirm did nothing visible after 3 seconds,
     file a HIGH finding and quote the console output from the
     "--- console ---" section.

# Step 2 — /he/bets/tournament (outrights, free picks)
7. Navigate to /he/bets/tournament.
8. Repeat the same flow: locate Surprise Me, click + confirm,
   verify some bets now have picks attached.
9. Specific check: each filled pick MUST show stake=0 (outrights
   are free). If after bulk fill the bot's bank balance changes,
   that is a CRITICAL finding (would mean Surprise Me drained
   the bank on free bets).

# Step 3 — /he/bets/groups
10. Navigate to /he/bets/groups.
11. Same flow. If empty (admin hasn't published group bets), note
    and skip - normal sandbox state.

# Things that are NOT findings
- "Surprise Me is hidden on a surface where every bet is already
  picked" - that is the intended behaviour.
- "The picks are random" - Surprise Me uses odds-weighted
  randomness intentionally.
- "An existing pick was preserved through Surprise Me" - that is
  the intentional never-overwrite semantics (see _plans/
  monkey-bot-and-random-fill).

# Budget: 25 tool calls.
Return a one-paragraph summary covering which surfaces you
exercised Surprise Me on, the count of bets filled, and any real
findings.
`,
};
