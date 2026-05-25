# Paybox-only payment + paid-user gate

Date: 2026-05-25
Owner: Yoav

## Goals

1. Make Paybox the only payment method in the onboarding flow (Bit out).
2. Lock down the app so that any non-admin user who does **not** have an
   approved payment can view everything but cannot perform any mutating
   action (no bets, no bracket picks, no group orderings, no specials).

## Constraints

- Stack: Next.js (this project's custom build, see `AGENTS.md`), Drizzle,
  Supabase auth, server actions, React Server Components.
- Hebrew is the primary language; UI strings live in `dictionaries/he.json`
  + `en.json`.
- Jerusalem timezone is mandatory for any visible date (existing rule).
- Don't drop the `payment_method` enum from Postgres — existing rows with
  `method = 'bit'` should still render in the admin panel for history.

## Approach (chosen)

### Paybox only
- Remove the Bit/Paybox toggle in `OnboardingForm.tsx`. Show a single
  "Pay via Paybox" CTA that:
  - Opens the Paybox deep link in a new tab (URL via
    `NEXT_PUBLIC_PAYBOX_URL`, defaults to a `PAYBOX_URL_PLACEHOLDER`
    constant until the real link is provided).
  - Below it, show "I've paid" button that fires `recordPayment("paybox")`.
- `recordPayment` server action drops its `method` parameter and always
  inserts `paybox`.
- `PaymentsPanel.tsx` keeps rendering the chip for whatever `method` the
  row has, so legacy Bit rows still show "Bit". The admin can still
  approve/reject them.
- `dictionaries.*.onboarding.bit` stays defined (used by legacy rows) but
  is no longer surfaced in the onboarding screen.

### Paid-user gate
- New helper `getUserAccess(userId): { isAdmin, isPaid, canEdit }` in
  `src/lib/access.ts`. `canEdit = isAdmin || isPaid`.
- Server actions (`bets/[matchId]/actions.ts`, `bracket/actions.ts`,
  `standings/actions.ts`, `specials/actions.ts`) check `canEdit` and
  return `{ ok: false, error: "not_paid" }` if false.
- Pages (`/bets/[matchId]`, `/bracket`, `/standings`, `/specials`) fetch
  `canEdit` and pass it to their form components.
- Forms gate every input/button on `!canEdit`. When `!canEdit`, render a
  prominent `<PayGateBanner />` at the top with a CTA pointing to
  `/onboarding`.
- Banner copy (HE/EN) in `dictionaries.*.payGate.{title,subtitle,cta}`.

## Alternatives considered (and rejected)

1. **Hide action screens entirely for unpaid users** — too aggressive,
   blocks them from seeing the format/flow before they decide to pay.
2. **Redirect unpaid users to /onboarding from action screens** — same
   problem; also strips the social motivation of seeing what others are
   doing.

## Out of scope

- DB migration to drop `bit` from the enum.
- Refunds / payment edits.
- A new payment provider integration (Paybox is currently honor-system).

## Security / Safety

- Server-side enforcement is the source of truth. UI disabling is purely
  UX — never the gate.
- Admin path remains intact (`requireAdmin` unchanged).
- No new secrets: `NEXT_PUBLIC_PAYBOX_URL` is a public URL by design.

## Observability

- `recordPayment` logs `[onboarding paybox]` with the new payment id.
- Each gated action logs `[gate <surface>]` with `{ userId, isAdmin, isPaid }`
  when it rejects so a "save failed" report can be diagnosed quickly.

## Settings audit

- No new user-tunable settings introduced. Paybox URL is build-time only
  (not per-user). Entry fee already lives in `settings.entry_fee_ils`.
