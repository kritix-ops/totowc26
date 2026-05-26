# Public signup with admin approval + Resend emails

Date: 2026-05-26
Status: Implemented — pending manual browser QA + DB migration

## Goal

Allow non-members to request to join Toto Mundial from the public login page. The admin reviews requests in the admin panel and approves or rejects each one. Resend powers two transactional emails: an admin notification when a new request lands, and a confirmation/approval email to the registrant. The closed-invite model (only admin creates accounts via `invitePlayer`) is preserved — public signups never get a Supabase auth user until the admin approves.

## Why this matters

Today the only way to join is for the admin to manually invite each player by name, phone, and email through the admin panel. That works at the start but creates friction for friends-of-friends who hear about the pool late or want to join from a phone without bugging the organizer. A "Register" button on the login page captures their details into a queue the admin can act on at their own pace, and Resend makes sure neither side has to remember to follow up.

## Decisions already made (with user)

1. **Storage architecture** — separate `signup_requests` table. No Supabase auth user is created until approval. Cleanest security model: pending requests cannot log in, cannot appear in profile lookups, and a malicious or mistaken request leaves no auth footprint to clean up.
2. **Email provider** — Resend. 3,000/month + 100/day free tier, native Next.js DX, React Email templates supported.
3. **Signup form fields** — `displayName`, `phone`, `email` only. No invite-source or comment field. Matches the existing admin invite shape exactly.

## Domain decision

**Sender domain: `kritix.io`** (user-owned, used for admin email already). From address: `Toto Mundial <noreply@kritix.io>`. Reply-to: `yoav@kritix.io` so any user reply lands in the admin inbox directly.

DNS setup happens in the Resend dashboard before the first send: SPF (TXT), DKIM (CNAME ×2 or TXT), and Return-Path (CNAME). I will produce the exact records once the Resend account is provisioned.

## Architecture

### Database — new table `signup_requests`

```ts
// src/db/schema.ts (added next to profiles)
export const signupRequestStatusEnum = pgEnum("signup_request_status", [
  "pending",
  "approved",
  "rejected",
]);

export const signupRequests = pgTable(
  "signup_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    displayName: text("display_name").notNull(),
    phone: text("phone").notNull(),
    email: text("email").notNull(),
    status: signupRequestStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedBy: uuid("decided_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    note: text("note"),
    // Ties an approved request to the auth user that resulted, so the admin
    // can see history even after profile edits.
    createdUserId: uuid("created_user_id"),
  },
  (t) => ({
    statusIdx: index("signup_requests_status_idx").on(t.status),
    // Only one open (pending) request per email at a time. Approved/rejected
    // history rows are allowed to repeat.
    pendingEmailUq: uniqueIndex("signup_requests_pending_email_uq")
      .on(t.email)
      .where(sql`status = 'pending'`),
  }),
);
```

Drizzle migration generated via `pnpm db:generate`, applied via the existing `prebuild` hook.

### Routes

- **`/[lang]/signup`** — public page, no auth required. Same layout shell as `/login`. Reuses `LoginForm` field styling. On submit, calls a server action that inserts a `signup_request` row, fires two emails, redirects to `/[lang]/signup/thanks`.
- **`/[lang]/signup/thanks`** — public thank-you page. Plain text: "תודה, קיבלנו את הבקשה. ניצור איתך קשר כשהיא תאושר." Includes a back-to-home link.
- **`/[lang]/login`** — add a secondary action under the sign-in button: "עוד לא נרשמת? להגיש בקשה →" linking to `/[lang]/signup`. Mirrors the existing login footer copy in tone.
- **`/[lang]/admin/signup-requests`** — admin-only list of requests with approve/reject buttons. Filters: pending (default) / approved / rejected / all. Sort by newest first.

### Server actions

New file `src/app/[lang]/signup/actions.ts`:

- `submitSignupRequest(formData)`
  - Validates `displayName.length >= 2`, `phone.length >= 7`, `email` contains `@` (matches existing `invitePlayer` validation exactly).
  - Honeypot check: hidden field `website` must be empty (server rejects if filled — silent 200 to the bot).
  - Rate-limit by IP using a simple in-memory token bucket (10 req/hour/IP). For a friends pool this is enough; not worth Redis.
  - Normalizes email (lowercase + trim).
  - Rejects if a `profile` already exists with that email (already a member) — message: "המייל כבר רשום במערכת".
  - Rejects if a `signup_request` with `status='pending'` already exists for that email — message: "כבר הגשת בקשה, נחזור אליך".
  - Inserts the row.
  - Fires admin notification email (best-effort — failure logged but does not fail the request).
  - Fires confirmation email to the registrant (best-effort — same).
  - Returns `{ ok: true }`. The page redirects to `/signup/thanks`.

New file `src/app/[lang]/admin/signup-requests/actions.ts`:

- `approveSignupRequest(requestId)` — admin-only. Loads the row, reuses the body of the existing `invitePlayer` flow (creates auth user, upserts profile, generates recovery link), sets `status='approved'`, `decidedAt`, `decidedBy`, `createdUserId`, then sends the approval email containing the recovery link (so the registrant clicks once and lands on `set-password`).
- `rejectSignupRequest(requestId, note?)` — admin-only. Sets `status='rejected'`, `decidedAt`, `decidedBy`, optional admin note. No email by default (admin can choose to send one manually) — see open question below.
- Both actions enforce `assertAdmin` exactly like `decidePayment` does today.

### Email layer

New module `src/lib/email/`:

- `client.ts` — wraps the Resend SDK with a single configured instance. Reads `RESEND_API_KEY` from env. Exposes `sendEmail({ to, subject, html, text })`.
- `templates/` — three Hebrew RTL templates as React components (using `@react-email/components` for cross-client compatibility):
  - `AdminSignupNotification.tsx` — to admin. Subject: "בקשת הרשמה חדשה — {displayName}". Body: name, phone, email (clickable), link to `/he/admin/signup-requests`.
  - `UserSignupConfirmation.tsx` — to registrant on submit. Subject: "קיבלנו את הבקשה שלך לטוטו מונדיאל". Body: thank-you + what to expect.
  - `UserApprovalEmail.tsx` — to registrant on approval. Subject: "אושרת! ברוך הבא לטוטו מונדיאל". Body: greeting + big button linking to the recovery URL + plain-text fallback link.

Naming convention: all subjects in Hebrew (the audience is Hebrew-speaking). RTL `<html dir="rtl" lang="he">`. Inline styles only (email clients strip `<style>`).

### Environment variables (new)

- `RESEND_API_KEY` — secret. Created in Resend dashboard.
- `EMAIL_FROM` — `Toto Mundial <noreply@kritix.io>`.
- `EMAIL_REPLY_TO` — `yoav@kritix.io`.
- `ADMIN_NOTIFICATION_EMAIL` — where new-signup notifications land. Set to `yoav@kritix.io`.

All three documented in `README.md` deployment section.

### Admin UI — `signup-requests` page

Card-style list, mobile-first per project CLAUDE.md. Each card shows:

- Name (large), phone (with tel: link), email (with mailto: link).
- Created-at as relative Jerusalem time via `formatDateTime` (per `[[feedback_jerusalem_timezone]]`).
- Status chip: ממתין / אושר / נדחה.
- Two primary buttons on pending rows: **אישור** (green, calls `approveSignupRequest`) and **דחייה** (red, opens a small "note?" prompt then calls `rejectSignupRequest`).
- After approval, the row collapses to a one-line "אושר ב-{date} ע"י {admin}" and links to the resulting profile.

Add a count chip on the admin home so the admin sees "3 בקשות ממתינות" without drilling in.

### Settings (per rule 15)

One new admin setting: **"אפשר הרשמה ציבורית"** (boolean, default `true`). Lives in the existing admin settings panel. When `false`:

- `/[lang]/signup` returns a 404-style "ההרשמה סגורה כרגע, פנה למנהל" page.
- The link from the login page is hidden.

Why expose this: the tournament window closes; the admin will want to shut signups off once bets lock. Hardcoding "always open" would force a code change later.

Not exposed (intentional): notification email address (env var — security-sensitive), email templates (code, not config), rate limit (sensible default).

## Security (per rule 13)

- **Input validation**: every field validated server-side. Email regex via standard `@` presence + length. Display name and phone length bounds match `invitePlayer`.
- **Honeypot**: hidden field; bots fill everything, humans skip it.
- **Rate limit**: 10 submissions/hour/IP. Stops a single source from flooding the queue.
- **Duplicate guard**: unique index on `(email)` where `status='pending'`. Database-enforced, not just app-level.
- **No auth user until approval**: a malicious request creates one row in `signup_requests`, nothing in `auth.users` or `profiles`. Admin can mass-reject with one button if abuse happens.
- **Email enumeration**: when an email already exists as a member or as a pending request, the error message is the same generic "כבר הגשת בקשה לטוטו, נחזור אליך" — does not leak whether the email is already a member vs already in the queue. (Slightly weaker UX, but worth it for a public form.)
- **Admin actions**: every action in `admin/signup-requests/actions.ts` calls `assertAdmin` first, same pattern as existing admin code.
- **Resend API key**: server-only env var, never imported into client components.
- **Logs**: never log full email bodies or PII beyond what we already log (`{email, requestId}` is fine — same as existing admin logs).

Verified against current OWASP guidance for public sign-up forms (need to re-check at implementation time per rule 1 — these are training-data recollections, not current).

## Observability (per rule 14)

All emit-on-write logs use the existing `console.info('[namespace step]', { ... })` convention:

- `[signup request submitted]` — `{requestId, email, displayName}`
- `[signup request duplicate]` — `{email, existingRequestId}`
- `[signup email] admin_notification` — `{to, requestId, messageId, ok}`
- `[signup email] user_confirmation` — `{to, requestId, messageId, ok}`
- `[signup approved]` — `{requestId, userId, by}`
- `[signup rejected]` — `{requestId, by, note}`
- `[signup email] user_approval` — `{to, requestId, messageId, ok}`

Errors logged via `console.error` with the full error object, never the API key.

## Lazy-user walkthrough (per rule 10)

**Registrant — first time:**
1. Lands on `/he/login`. Sees the form. Below it: "עוד לא נרשמת? להגיש בקשה →". One tap.
2. `/he/signup`. Three fields. Big submit button. Done.
3. `/he/signup/thanks`. "תודה, ניצור איתך קשר." Inbox: confirmation email arrives in seconds. They close the tab.
4. Day later, approval email arrives. Big button: "להיכנס לטוטו". Tap → set password → in.

**Registrant — re-submit attempt:**
1. They forgot they already submitted. Fill the form again.
2. Generic friendly error: "כבר הגשת בקשה, נחזור אליך בקרוב." No mention of pending vs member.

**Admin — new request comes in:**
1. Email lands: "בקשת הרשמה חדשה — דני כהן". One tap on the link → `/he/admin/signup-requests` (logged in via existing session).
2. Top of the list: דני's card. אישור / דחייה buttons. One tap on אישור.
3. Toast: "אושר. נשלח מייל הזמנה." Card collapses.
4. דני gets the approval email instantly.

**Admin — closing signups:**
1. Admin settings panel → toggle "אפשר הרשמה ציבורית" off.
2. Public `/signup` page now says "ההרשמה סגורה כרגע."
3. The "להגיש בקשה" link on `/login` disappears.

## Alternatives considered and rejected

- **Profiles row with `status='pending'`** — simpler in some ways but pollutes the profile table with non-members, requires every existing query that joins `profiles` to filter by status, and creates a Supabase auth user for someone who may never be approved. Rejected per user choice.
- **Supabase's built-in `signUp()` with email confirmation** — gives self-service signup for free but bypasses admin approval entirely. Would need a second gate anyway (e.g. `approved` flag on profile), so it just adds a second pre-approval state without simplifying anything. Rejected because the table approach is cleaner.
- **reCAPTCHA / hCaptcha** — better spam protection than a honeypot but adds a third-party script, a privacy disclosure obligation, and friction on mobile. Honeypot is enough at friends-pool scale; can upgrade later if real spam appears.
- **Email verification code on submission** — adds a "type the 6-digit code" step before the request reaches the admin. Stops typo'd emails earlier but adds friction. For a friends pool the admin will spot a typo in seconds and rejecting is one click — not worth the UX cost. Skipped.
- **Brevo / Postmark / SendGrid instead of Resend** — comparable free tiers, worse Next.js DX, no React Email integration. Rejected per user choice.

## File-by-file change list

New files:
- `src/db/migrations/<next>_signup_requests.sql` (drizzle-generated)
- `src/app/[lang]/signup/page.tsx`
- `src/app/[lang]/signup/SignupForm.tsx`
- `src/app/[lang]/signup/actions.ts`
- `src/app/[lang]/signup/thanks/page.tsx`
- `src/app/[lang]/admin/signup-requests/page.tsx`
- `src/app/[lang]/admin/signup-requests/SignupRequestsList.tsx`
- `src/app/[lang]/admin/signup-requests/actions.ts`
- `src/app/[lang]/admin/signup-requests/queries.ts`
- `src/lib/email/client.ts`
- `src/lib/email/templates/AdminSignupNotification.tsx`
- `src/lib/email/templates/UserSignupConfirmation.tsx`
- `src/lib/email/templates/UserApprovalEmail.tsx`
- `src/lib/rate-limit.ts` (small in-memory token bucket)

Edited files:
- `src/db/schema.ts` — add `signupRequestStatusEnum` and `signupRequests`.
- `src/app/[lang]/login/LoginForm.tsx` — add "להגיש בקשה" link below the form.
- `src/app/[lang]/admin/page.tsx` — add a pending-signups count chip.
- `src/app/[lang]/admin/settings/page.tsx` (or wherever admin settings live) — add the public-signup toggle.
- `package.json` — add `resend` and `@react-email/components` dependencies.
- `README.md` — document the three new env vars.
- `.env.local.example` (if it exists; otherwise add one) — same.

## Cost

- Resend: **$0/month** at expected volume. Friends pool of ~50 people × ~3 emails/signup × signup phase only = far under 3,000/month and well under 100/day.
- If volume ever exceeds the free tier: Resend Pro is $20/month for 50,000 emails. Not in scope.
- No other paid services touched.

## Out of scope

- Bulk approve for signup requests (the existing `bulkApprovePending` is for payments, not signups).
- Custom rejection email templates per reason.
- A "resend approval email" button on already-approved requests (use existing `resendMagicLink` if needed).
- SMS notifications.
- Localizing the form to English. The `[lang]` route stays in place but only the `he` strings are written; an English speaker still sees Hebrew if they hit `/en/signup`. Can be added later by following the existing dictionary pattern.

## Test plan

After implementation:
1. **Golden path**: submit a request as a stranger from incognito → confirmation email arrives → admin approves → approval email arrives with working recovery link → recovery flow lands on `set-password` → password set → user logs in and sees their profile.
2. **Duplicate email already a member**: existing member's email → generic error.
3. **Duplicate pending request**: same email twice → generic error on second.
4. **Honeypot**: fill hidden field via devtools → server silently rejects (200 to bot, no row inserted).
5. **Rate limit**: 11th submission within an hour from same IP → error.
6. **Settings toggle off**: signup page renders the closed message; the login-page link is gone.
7. **Admin reject**: rejection with note → row updated, no email sent (per plan; user can change this later).
8. **Email delivery to Gmail and to a non-Gmail address**: check spam folder, headers, RTL rendering.
9. **Mobile**: every screen at 360px, 414px, 768px, 1024px per project CLAUDE.md.
10. **No regressions**: existing `invitePlayer` still works, existing login still works.

## Sequencing

1. User answers the From-domain question.
2. Schema + migration.
3. Resend client + templates.
4. Public signup page + action + thanks page.
5. Login page link.
6. Admin signup-requests page + actions.
7. Admin home count chip.
8. Settings toggle.
9. End-to-end test from incognito.
