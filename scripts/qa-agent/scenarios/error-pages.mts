// Scenario: 404 + error-boundary integrity.
//
// Verifies the safety nets we built after the QA agent kept
// reporting blank pages:
//   - /he/bets/<bad-uuid> hits the [matchId] not-found.tsx
//   - /he/bets/<garbage> hits the same not-found.tsx (via the
//     upstream uuid regex guard in page.tsx)
//   - /he/me/bank/error.tsx renders when the page throws (we
//     cannot reliably force a throw from the agent, so this run
//     just confirms the route still renders normally - the error
//     boundary surfaces only if a real bug brings it up)
//   - Random nonexistent routes go to the global not-found page.

export const errorPagesScenario = {
  name: "error-pages",
  userPrompt: ({
    baseUrl,
    qaBotEmail,
    qaBotPassword,
  }: {
    baseUrl: string;
    qaBotEmail: string;
    qaBotPassword: string;
  }): string => `
Test 404 + error-boundary surfaces at ${baseUrl}.

# Setup
1. Navigate to /he/login. Sign in as ${qaBotEmail} with password
   ${qaBotPassword}.
2. browser_wait for=ms value=2000.

# Step 1 — invalid match UUID
3. Navigate to /he/bets/00000000-0000-0000-0000-000000000000
   (syntactically valid UUID, no matching row).
4. Expect the "המשחק לא נמצא" / "Match not found" card with a
   "חזרה להימורים" / "Back to bets" link. Confirm the link's
   href targets /he/bets.
5. Click the back link. Confirm you land on /he/bets.

# Step 2 — non-UUID matchId
6. Navigate to /he/bets/garbage-not-a-uuid.
7. Expect the same "המשחק לא נמצא" card (the regex guard kicks
   notFound() before Postgres ever sees the bad input).

# Step 3 — invalid live date
8. Navigate to /he/bets/live/not-a-date.
9. Expect a 404 page (the date regex in the live/[date] page
   triggers notFound on malformed dates).
10. Navigate to /he/bets/live/2026-99-99. Same: 404.

# Step 4 — bank page renders normally
11. Navigate to /he/me/bank.
12. Confirm the bank page renders ("היסטוריית בנק", balance card,
    tx list). If instead you see the "לא הצלחנו לטעון את הבנק"
    error card, that means a real query started throwing — read
    the error.digest line from the snapshot and quote it as a
    HIGH finding.

# Step 5 — wholly random route
13. Navigate to /he/this-route-does-not-exist-12345.
14. Expect the global Next.js 404 page. It should have something
    interactive (a Hebrew "Page not found" line + a link back to
    /he). If it is a raw, unstyled "404" only, that is a LOW
    finding — a project this size deserves a styled global
    not-found.tsx, and we don't currently have one.

# Things that are NOT findings
- "The Hebrew copy on each error variant is slightly different"
  - different boundaries, different copy. As long as each makes
    sense in context, no finding.
- "The browser URL still shows the bad path" - that is correct.
  notFound() does not rewrite the URL; it renders the 404 UI
  under the requested path.

# Budget: 20 tool calls.
Return a one-paragraph summary of which error variants you
confirmed and any that misbehaved.
`,
};
