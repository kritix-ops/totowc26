// Scenario: login / logout / session protection.
//
// Tests the auth perimeter: that a signed-out user is bounced from
// protected routes, that login works, that logout works, and that
// the session survives navigation across pages.
//
// This is the most "happy-path is the only path" scenario in the
// catalog. A flaky finding here is almost always a real bug.

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

# Step 1 — already logged in (initial state)
1. Navigate to /he. Confirm:
   - The header carries the bank pill (e.g. "30/30") - signed-in
     marker.
   - A user-menu trigger is reachable (typically a circular avatar
     in the header).

# Step 2 — find + use logout
2. Click the user-menu trigger. A menu sheet should open with at
   least a "logout" / "התנתק" / "צא" option.
3. If you cannot find a logout control after the menu opens, that
   is a HIGH finding.
4. Click logout. Wait 2000ms.
5. Confirm the header now shows guest UI (no bank pill, login
   button visible) and / or you have been redirected to /he or
   /he/login.

# Step 3 — protected route refuses anonymous
6. While signed out, navigate directly to /he/bets.
7. Expect a redirect to /he/login (the URL bar should change). If
   /he/bets actually renders with content for a signed-out user,
   that IS a CRITICAL finding (means a strangers can see bets).
8. Same check for /he/me/bank and /he/admin: both must redirect
   when signed out.

# Step 4 — login again
9. From the login page, enter ${qaBotEmail} and the password.
10. Click the submit / "התחבר" button.
11. Wait 2000ms.
12. Confirm the redirect lands on /he or /he/dashboard and the
    bank pill returns to the header.

# Step 5 — session survives navigation
13. Navigate /he → /he/bets → /he/me/bank → /he/profile. The bank
    pill should persist across each page. If you ever land back on
    /he/login mid-flow, that is a HIGH finding (session lost
    unexpectedly).

# Things that are NOT findings
- "The user menu shows 'logout', 'profile', 'settings', and the
  options are not in the order I expect" - layout choice, not a
  bug.
- "The redirect from a protected route adds a ?from=… query" - by
  design, that is the return-after-login mechanism.

# Budget: 25 tool calls.
Return a one-paragraph summary covering the auth perimeter
results.
`,
};
