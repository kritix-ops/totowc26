// Scenario: login / logout / session protection.
//
// Tests the auth perimeter: that a signed-out user is bounced from
// protected routes, that login works, that logout works, and that
// the session survives navigation across pages.
//
// Each agent run starts with a fresh browser context (no cookies),
// so the scenario must log in explicitly. Earlier version of this
// prompt assumed "already logged in" - that was wrong, and the bot
// spent the run guessing passwords. Fixed in commit that landed
// with this comment.

export const authFlowScenario = {
  name: "auth-flow",
  userPrompt: ({
    baseUrl,
    qaBotEmail,
    qaBotPassword,
  }: {
    baseUrl: string;
    qaBotEmail: string;
    qaBotPassword: string;
  }): string => `
Test the login / logout / session perimeter at ${baseUrl}.

The browser starts with NO cookies, so we begin from the logged-
out state and work outward.

# Step 1 — protected route refuses anonymous
1. Navigate directly to /he/bets (a protected route, no login yet).
2. Expect a redirect to /he/login. The URL bar should change. If
   /he/bets actually renders the bets list for a signed-out
   request, that is a CRITICAL finding (strangers seeing bets).
3. Same check: navigate to /he/me/bank. Must redirect to /he/login.
4. Same check: navigate to /he/admin. Must redirect to /he/login
   (or to a "not authorised" surface - either is acceptable, but
   /he/admin rendering admin content unauthenticated is CRITICAL).

# Step 2 — successful login
5. Navigate to /he/login.
6. Type ${qaBotEmail} into the email field.
7. Type the exact password ${qaBotPassword} (use it character for
   character; do not invent a password).
8. Click the submit / "התחבר" button.
9. browser_wait for=ms value=2500.
10. Confirm the redirect lands somewhere signed-in (e.g. /he or
    /he/dashboard) and the header now shows a bank pill like
    "30/30". If login fails ("מייל או סיסמה שגויים"), DO NOT
    guess - that means the credentials block is wrong; record
    it as a finding and stop.

# Step 3 — session survives navigation
11. From the signed-in landing, navigate /he → /he/bets → /he/me/
    bank → /he/profile.
12. The bank pill should persist on every page. If you ever land
    back on /he/login mid-flow, that is a HIGH finding (session
    lost unexpectedly).

# Step 4 — find + use logout
13. Click the user-menu trigger in the header (typically a
    circular avatar at the top corner, top-left in RTL flow).
14. A menu sheet should open with at least a "logout" / "התנתק" /
    "צא" option.
15. If you cannot find a logout control after the menu opens,
    that is a HIGH finding.
16. Click logout. browser_wait for=ms value=2000.
17. Confirm the header now shows the guest UI (no bank pill,
    "התחבר" button visible) and / or you have been redirected.

# Things that are NOT findings
- "The user menu also has 'profile', 'settings', and they are
  not in the order I expect" - layout choice, not a bug.
- "The redirect from a protected route adds a ?from=… query
  param" - by design, that is the return-after-login mechanism.

# Hard rules
- NEVER invent or guess the password. The exact value to type is
  given to you above. If login fails with that password, that is
  the finding — stop the scenario, do not retry with variations.

# Budget: 25 tool calls.
Return a one-paragraph summary covering the auth perimeter
results.
`,
};
