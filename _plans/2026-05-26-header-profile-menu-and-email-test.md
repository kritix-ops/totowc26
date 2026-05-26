# Header profile menu + admin email test route

Date: 2026-05-26
Status: In progress

## Goal

Two small, independent slices the user asked for in one turn:

1. **Profile avatar dropdown in the header.** Today a signed-in user sees BankPill + rank + language toggle in the top bar, and has to reach `/profile` only via the mobile bottom nav or by typing the URL. Desktop has no obvious way in, and there's no visible "Log out" affordance anywhere except inside the profile page. Add an avatar button with the user's initial in the header that opens a dropdown with quick links (Profile, Settings, Log out) on both mobile and desktop.

2. **Admin email-test route.** The user wired up Resend (`RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`) and wants a low-friction way to verify it actually sends without faking a signup. Add `/he/admin/email-test` — admin-only — with a single form: target address + template picker (admin notification, user confirmation, approval) + send button. The page surfaces the Resend message id on success and the error string on failure, so you can confirm DNS / API key end-to-end.

## Why this matters

- **Profile menu** — finishability. The bottom nav has a profile tab, but desktop users have no top-right affordance, and "Log out" is two clicks deep on any device. This is the kind of friction the lazy-user rule explicitly calls out (CLAUDE.md rule 10). A standard avatar dropdown is the obvious pattern users already expect.
- **Email test** — verifying Resend through `/signup` is heavy: you create a request row, fire two emails, and mutate state. Worse, a misconfigured `EMAIL_FROM` (unverified domain in Resend) won't show up in app logs in any obvious way for a non-developer. A dedicated test route gives a one-click, no-side-effects path to confirm "yes, the wire is good."

## Decisions made with the user

1. **Profile UI shape**: dropdown menu anchored to an avatar — not a plain link or two separate icons. Mobile and desktop share the same component.
2. **Email test surface**: admin-only route at `/he/admin/email-test`, not a CLI script. Avoids needing a working dev shell to verify, and matches the project's existing admin-tool pattern (sync panel, view-as panel, paybox settings panel).

## Architecture

### 1. Profile menu

**New file** — `src/components/ProfileMenu.tsx` (client component).

Props:
- `locale: Locale`
- `displayName: string` — falls back to email-local-part if no profile name yet
- `isAdmin: boolean` — shows an "Admin" link in the menu when true (desktop nav already has one but the mobile nav does not for admins-impersonating-players, so this is a stable entry point)
- `isHebrew: boolean` for the chevron direction + RTL placement
- `labels: { profile: string; admin: string; logout: string }` so dictionary strings are resolved server-side and passed in (matches the LanguageToggle/BankPill pattern)

Behavior:
- Renders a 36×36 round button with the first letter of the display name (matches the existing `/profile` page avatar styling — bg-primary, text-on-primary, ring-tertiary-fixed-dim).
- Click → opens a dropdown anchored to the button. Outside-click and Escape close it. Uses `useState` + a `useEffect` listener for outside clicks (no Radix; the project has no headless-UI library, and pulling one in for one menu is overkill).
- Dropdown items:
  - `Profile` → `localePath(locale, "profile")` (link)
  - `Admin` → `localePath(locale, "admin")` (link, only when `isAdmin`)
  - `Log out` → a `<form action="/auth/signout" method="POST">` with a styled submit button. Reuses the existing signout route — no new server action.
- Touch target ≥44px on all rows. Width auto-fits to longest label; min-w 200px.
- RTL: in Hebrew the dropdown anchors `right-0`; in English `left-0`. The chevron icons next to row labels respect direction.
- Z-index sits above the header (z-50) but below the view-as banner (z-60).

**AppShell wiring** (`src/components/AppShell.tsx`):
- Replace the current "rank short" span on desktop with a row of `[BankPill] [rank] [ProfileMenu] [LanguageToggle]`.
- On mobile (`md:hidden`), the BankPill stays, rank stays hidden, ProfileMenu sits to the left of LanguageToggle. Tested at 360px to make sure the brand + bank pill + avatar + lang toggle still fit without overflow.
- The mobile bottom-nav `Profile` tab stays (it's the canonical way for mobile users to land on the profile page). The avatar in the header is a parallel/additive entry point, not a replacement.

**Dictionary keys**: existing `dict.profile.logout` covers "Log out". Add `dict.nav.profileMenu` ("פרופיל" / "Profile") so the dropdown label is independent of the bottom-nav label if we ever want to change it. Skip adding a "Settings" row — `/profile` itself already has a settings section; routing users to a separate page would be cargo-cult. The "Settings" the user mentioned in their request is satisfied by the existing Settings section inside the profile page.

### 2. Admin email-test route

**New folder** — `src/app/[lang]/admin/email-test/`
- `page.tsx` — server component. Reads admin (already guaranteed by `[lang]/admin/layout.tsx → requireAdmin`). Renders the form.
- `actions.ts` — one server action `sendTestEmail({ to, template })`. Re-asserts admin. Switches on template, calls `sendEmail`, returns `{ ok, messageId, error, envSummary }`. `envSummary` is a redacted snapshot of which env vars are present (`RESEND_API_KEY: set|missing`, `EMAIL_FROM: <value>`, `EMAIL_REPLY_TO: <value>`) so the page can show config status without the secret value.
- `TestForm.tsx` — client component. Form with: target email input (defaults to admin's own email), template `<select>` (admin_notification, user_confirmation, user_approval), submit button. Uses `useFormState` / `useTransition` (React 19 pattern — confirmed via Context7 below) to show inflight state and the result inline.

**Admin index link**: add an "Email test" tile to `src/app/[lang]/admin/page.tsx` nav grid, gated on dev/prod alike (admin is already small enough that hiding it is unnecessary).

## Settings audit (CLAUDE.md rule 15)

- ProfileMenu: no new user-facing settings — the existing language toggle stays in the header, and the "Settings" section inside `/profile` already covers per-user preferences. Hardcoded choices: dropdown width, animation speed (none — instant open), avatar size (36px). None are knobs a user would reasonably want to change.
- Email-test: no user-facing settings — this is a developer/admin tool.

## Observability (rule 14)

- ProfileMenu: `console.info("[profile menu open]", { isAdmin })` on open. No log on close.
- Email test: existing `[email sent]` / `[email send failed]` logs in `sendEmail` already cover the outcome. Add `console.info("[email test submit]", { to, template, byAdminId })` in the action so the audit trail is clear.

## Security (rule 13)

- ProfileMenu has no privileged actions of its own — Profile/Admin links are plain `<Link>`s gated server-side at the destination, and Log out goes through the existing `/auth/signout` POST.
- Email-test re-asserts admin in the server action (don't rely on layout gate alone — actions are reachable from any client). Validates the `to` address with a simple `includes('@')` shape check, matching the rest of the codebase. Does not allow free-form subject/body — only the existing React Email templates, so there's no way to use this as an open relay.
- Logs do not include the Resend API key. `envSummary.RESEND_API_KEY` returns the string `"set"` or `"missing"` only.

## Testing plan

Manual, in dev:

1. **Profile menu — desktop**: sign in, open at ≥1024px. Click avatar → dropdown opens. Click outside → closes. Press Escape → closes. Click Profile → lands on `/he/profile`. Click Log out → redirects to `/he/login`. Repeat in English locale; chevron + alignment flip correctly.
2. **Profile menu — mobile**: at 360px, sign in, confirm header doesn't horizontal-scroll. Tap avatar → dropdown fits within viewport (no clip on the trailing edge). Tap Log out → signs out.
3. **Profile menu — admin**: sign in as admin, confirm Admin row appears in dropdown. Impersonate a player (`view-as`) — Admin row hides (because `access.isAdmin` is the effective role).
4. **Email test**: open `/he/admin/email-test`, type your own email, pick each template, send. Verify: Resend dashboard shows the send; inbox receives the email; the page shows a success banner with the message id. Try with an obviously bad `to` (`foo`) → shape check rejects. Temporarily unset `RESEND_API_KEY` → page shows "not_configured" with the envSummary diagnostic.
5. **Lint + typecheck**: `pnpm lint` and `pnpm exec tsc --noEmit` (or `pnpm build` if it's already wired to typecheck).
