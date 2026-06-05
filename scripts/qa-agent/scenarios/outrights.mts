// Scenario: tournament outrights + group bets.
//
// Tournament/stage/group ("outright") bets are FREE in this app: stake
// snapshot is 0, max payout is capped at 25. They live under two
// routes off the BetsTabs strip:
//   /he/bets/tournament  — tournament-wide categories (winner, top
//                          scorer, etc.)
//   /he/bets/groups      — per-group rankings
// Both have empty-state cards when the admin has not yet authored any
// bets in a category, which is the normal sandbox state pre-tournament.
//
// What the agent should NOT report:
//   - "No published bets yet / האדמין עוד לא פרסם" — that is the
//     baseline sandbox state, not a bug.
//   - Score-style displays of saved picks — same "תחזית" labelling
//     convention used elsewhere in the app.
//   - Deadline-lock UI for matches in the future — by construction,
//     nothing is locked in the pre-tournament sandbox.

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
Test the tournament-outrights + group-rankings flow at ${baseUrl}.

# Setup
1. Navigate to /he/login. Sign in as ${qaBotEmail} with password
   ${qaBotPassword}.
2. Wait for the redirect to complete (browser_wait for=ms value=2000),
   then continue from the home/dashboard.

# Tournament outrights (/he/bets/tournament)
3. Navigate to /he/bets/tournament.
4. Confirm the page renders fully:
   - Header reads "הימורים" with the BetsTabs strip.
   - The "הימורי טורניר" tab is the active one.
   - Read the "main raw text" section of the snapshot to confirm
     content is rendered. Anything more than a few hundred characters
     of meaningful text = the page is fine.
5. Identify the outright categories the admin has authored. If the
   list is empty, the page should show "אין הימורי טורניר פתוחים"
   (or similar Hebrew empty-state). THAT IS NORMAL. Do not record
   a finding for it.
6. For each category the page DOES show:
   - Pick an option (e.g. tap on a team for "Tournament winner").
   - Confirm the save state flips. Tournament bets are FREE so the
     stake shown should be 0; the max payout should read 25.
   - Reload the page. Confirm your pick persists ([pressed] or
     equivalent marker on the option you chose, or a "תחזית"
     label / saved-state badge).
   - If stake is shown as anything other than 0, that IS a real
     finding (critical-severity: this would let the bot drain
     points on what is supposed to be a free bet).
   - If max payout is shown as anything other than 25, also a
     finding.

# Group rankings (/he/bets/groups)
7. Navigate to /he/bets/groups.
8. Same expectations as step 4: page fully rendered, BetsTabs strip
   with "דירוגי בתים" active. If empty, normal — do not record.
9. For each group the admin has authored a bet for:
   - Place a ranking pick.
   - Same free-pick checks (stake=0, max payout=25).
   - Persistence check after reload.

# Things to verify before EVERY "blank page" or "missing feature"
# finding (these rules came out of earlier QA runs that filed
# false positives):
- Re-read the snapshot's "--- main raw text ---" section. Pages
  whose content is mostly text in non-interactive divs (the bank
  page, custom-bet cards, empty-state cards) often look "empty"
  in the interactive scan but have plenty of content in the raw
  text section.
- Wait 1500ms (browser_wait for=ms value=1500) and re-snapshot.
  AppShell uses <Suspense fallback={null}> heavily — content can
  arrive after the initial DOM.
- Take a screenshot AND describe its contents. A screenshot that
  shows the BetsTabs strip + empty-state card is NOT a "blank
  page", it is a working page with no admin-published content.

# Budget
You have at most 30 tool calls for this scenario. Be efficient —
each category needs just one click + one verification snapshot.
When done, return a one-paragraph summary covering which
categories you tested, the stake/payout values you saw, and any
real findings.
`,
};
