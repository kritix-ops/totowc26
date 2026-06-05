// Scenario: per-match score predictions and (when present) day-bets.
//
// The match-pick flow on /he/bets is the most exercised path in the
// app. The route handler at /api/bets/save (rather than the legacy
// server action) processes saves now, and the QuickPickRow client
// component handles in-place +/- adjustments + a fetch save. Earlier
// QA runs surfaced bugs that have since been fixed in the code:
//   - updateTag-in-route-handler 500 (cab0d08)
//   - aria-label not reflecting save state (016b024)
//   - "נשמר" badge auto-clearing (016b024)
//   - "שבת" weekday inconsistency (d643a48)
// The agent should NOT re-file findings for those — if it sees the
// post-fix behaviour, that is correct.

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
Test the match-pick + save flow at ${baseUrl}.

# Setup
1. Navigate to /he/login. Sign in as ${qaBotEmail} with password
   ${qaBotPassword}.
2. browser_wait for=ms value=2000 so the redirect + session
   propagation completes.

# Step 1 — bets list (/he/bets)
3. Navigate to /he/bets.
4. Confirm the list renders in Hebrew RTL with match cards.
5. Spot-check ONE card from the snapshot:
   - Team names in Hebrew (or fallback to codes if a name row is
     missing — that IS a finding).
   - A kickoff time in IL local time. WC2026 evening games in
     North America land at 04:00–07:00 IL — those are CORRECT,
     not bugs. Hours 20:00–23:00 are also normal for late-evening
     IL kickoffs.

# Step 2 — save a pick
6. Find a future match (kickoff > 60 min from now). The current
   sandbox runs before the tournament so ALL matches qualify.
7. Click the home-stepper + button to bump the home score from
   0 to 1.
8. Click the save button ("שמור" / "שמור הימור").
9. browser_wait for=ms value=2000.
10. Re-snapshot. The save button should show "[disabled]" with
    inner text "נשמר" (snapshot will render this as
    "הימור נשמר (text: \\"נשמר\\") [disabled]"). If you see "שמור"
    (active, not נשמר), that is a finding.
11. Navigate away and back to /he/bets. Confirm the same row
    still shows "נשמר" — persistence check.

# Step 3 — deadline lock check (optional, often unreachable)
12. Look for any match in the snapshot whose card shows the row
    as DISABLED with text other than "נשמר" (e.g. a generic lock
    chip). If you find one AND it lacks a Hebrew lock message,
    that is a MEDIUM finding.
13. If no past-deadline match exists in the sandbox, **do not
    record a finding for that**. The agent runs pre-tournament
    by construction; "no locked matches to test" is the expected
    state, not a bug.

# Step 4 — live/day-bets section (often empty in sandbox)
14. Navigate to /he/bets/live. Click a matchday row to open
    /he/bets/live/<date>.
15. If the page shows "האדמין עוד לא פרסם הימורי לייב ליום הזה"
    or the fixtures list with no day-bets attached, that is the
    EXPECTED empty state. Do not record a finding for it.
16. If the day page renders completely blank (no header, no
    fixtures, no empty-state card), apply the 3-step triage
    BEFORE recording: re-read main raw text, wait 1500ms +
    re-snapshot, take a screenshot and describe it. Only file
    a finding if all three confirm zero content.

# Step 5 — bank page (/he/me/bank)
17. Navigate to /he/me/bank.
18. Should render header "היסטוריית בנק", balance breakdown card,
    stats card, and transaction list. Apply the 3-step blank-
    triage before recording any "blank" finding.

# Things that are NOT findings (calibrated from prior runs)
- "Saturday is rendered 'יום שבת' (or any other 'יום X' pattern)"
  — intended Hebrew format.
- "Match card shows '4-0' next to תחזית" — that IS the user's
  prediction, not a live score. The match has not started.
- "No admin-published day-bets / no locked matches" — sandbox
  default.
- "Kickoff at 04:00 / 07:00 IL" — correct IL conversion of US
  evening games. Not a timezone bug.
- "Header brand link is 36px tall" — its click area is now 44px
  via min-h-[44px].

# Budget
You have at most 30 tool calls. When done, return a one-paragraph
summary.
`,
};
