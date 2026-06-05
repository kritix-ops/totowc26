// Scenario: duels (challenge another player) UI integrity.
//
// Read-only against the duels routes:
//   /he/duels       — list of duels (the bot's incoming, outgoing,
//                     completed).
//   /he/duels/new   — form to challenge a specific opponent.
//   /he/duels/[id]  — single-duel detail.
//
// The bot does NOT actually create a duel (that would write a real
// pending challenge to another user). The scenario verifies the
// pages render, the form has the right shape, and lists / empty
// states match the qa-bot's current data.

export const duelsFlowScenario = {
  name: "duels-flow",
  userPrompt: ({
    baseUrl,
    qaBotEmail,
    qaBotPassword,
  }: {
    baseUrl: string;
    qaBotEmail: string;
    qaBotPassword: string;
  }): string => `
Test the duels surface at ${baseUrl}.

# Setup
1. Navigate to /he/login. Sign in as ${qaBotEmail} with password
   ${qaBotPassword}.
2. browser_wait for=ms value=2000.

# Step 1 — /he/duels (list)
3. Navigate to /he/duels.
4. Confirm:
   - h1 / heading present (e.g. "דו-קרבות" / "Duels").
   - At least one of these sections is visible OR an empty state
     for it:
     • Incoming challenges
     • Outgoing challenges
     • Completed / settled duels
   - A "New duel" / "אתגר חדש" CTA somewhere on the page (likely
     a button or link to /he/duels/new).
5. Read the "--- main raw text ---" section; if it has more than
   ~80 characters of meaningful text the page IS rendered, even
   if every section is empty for this bot.

# Step 2 — /he/duels/new (challenge form)
6. Navigate to /he/duels/new (or click the New-duel CTA).
7. Confirm the form has:
   - Some opponent selector (a dropdown / list of users to
     challenge). If you cannot find one, that is a HIGH finding —
     the duel cannot be created.
   - A wager / stake input.
   - Some way to pick the challenge terms (a match, a stage, a
     specific bet — the exact shape depends on the duel type).
   - A submit / "שלח אתגר" button.
8. Do NOT submit. We deliberately do not create real duels.

# Step 3 — single-duel detail
9. Back on /he/duels, if any existing duel row is shown:
   - Click the first row.
   - The URL should change to /he/duels/<id>.
   - Confirm the detail page renders (challenger, challenged,
     terms, status). Apply the blank-page triage if it looks
     empty.
10. If no duel rows exist, skip this step and note that the bot
    has no duels yet — that is the normal sandbox state.

# Things that are NOT findings
- "I did not create a real duel" — by design.
- "No other users to challenge" — sandbox often only has qa-bot
  + admin. Empty opponent lists are a real state, not a UI bug.

# Budget: 20 tool calls.
Return a one-paragraph summary covering the pages you visited
and the form shape you observed.
`,
};
