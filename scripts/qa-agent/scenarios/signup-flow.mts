// Scenario: public signup form integrity (read-only).
//
// This scenario does NOT submit a real signup. Each submit creates a
// signup_requests row that an admin would then have to dismiss, and
// after a dozen runs the admin queue would be polluted. The flow does
// verify the form renders, validates, and refuses obvious bad input.
//
// What the agent should NOT report:
//   - "I couldn't actually submit" - by design. We are testing the
//     form, not the end-to-end approval pipeline.

export const signupFlowScenario = {
  name: "signup-flow",
  userPrompt: ({
    baseUrl,
  }: {
    baseUrl: string;
    qaBotEmail: string;
    qaBotPassword: string;
  }): string => `
Test the public signup form at ${baseUrl}/he/signup. The QA bot is
already authenticated, but the signup form is reachable from the
login page without a session - navigate there directly.

# Form integrity
1. Navigate to /he/signup.
2. Snapshot the page. Confirm all required form fields are present:
   - Display name (שם)
   - Phone (טלפון)
   - Email (אימייל / דוא"ל)
   - A submit button
   - The honeypot "website" input (hidden, but should NOT be visible
     to a sighted user - if you see a literal "website" field on the
     visible form, that IS a finding)
3. Read the "--- main raw text ---" section to verify the page has
   meaningful copy ("הרשמה" / "להירשם" / etc.).

# Client-side validation
4. Fill in just the display name (e.g. "Q") - too short. Try to
   submit. The form uses native HTML validation: 'required' and
   'minLength=2' on the input. **Browsers show a NATIVE TOOLTIP**
   ("Please lengthen this text…") when the user tries to submit a
   too-short value, and **the snapshot cannot see native tooltips**.
   What you SHOULD see: the URL stays on /signup (no navigation),
   the form is still visible, and the input still has focus. That
   is correct behaviour - the browser refused to submit. Do NOT
   record a finding just because no Hebrew error appeared in the
   snapshot; the native tooltip is doing the work.
5. Fill in a malformed email (e.g. "not-an-email") and try to
   submit. Same pattern: 'type=email' triggers native validation,
   the snapshot cannot see the popup. If the URL stayed on /signup
   and the form is still there, the browser blocked it correctly.

# Visible-honeypot smoke test
6. Use browser_check_tap_targets to confirm there is no oddly-sized
   tap target that would be a giveaway for the honeypot. The
   honeypot field should not appear in the interactive snapshot at
   all because it is display:none / aria-hidden.

# Things that are NOT findings (calibrated)
- "I cannot actually submit and verify the request was created" -
  by design. Do not record.
- "The page also has links to /he/login" - expected, since signup
  and login share a footer/header link.

# Budget: 15 tool calls max. Be tight.
Return a one-paragraph summary covering what fields you saw, what
validation refused which inputs, and any visual / accessibility
issues with the form.
`,
};
