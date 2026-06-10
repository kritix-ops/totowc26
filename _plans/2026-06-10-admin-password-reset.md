# Admin password reset

Date: 2026-06-10
Status: approved, implementing

## Goal

Let an admin reset a user's password from the admin panel (the user drawer in
`admin/users`), with an audit trail of who reset whom and when.

## Key finding

The recovery-link mechanism already exists. `regenerateInviteLink` in
`src/app/[lang]/admin/users/actions.ts` generates a Supabase `recovery` link
that lands the user on `/set-password`. That is functionally a password reset
link. So this feature is mostly about (a) a clearly labeled action and (b) the
audit trail that the existing flows lack.

## Decisions

- Method: recovery link (reuse the existing Supabase `generateLink({ type:
  "recovery" })` + `buildInviteCallbackUrl` machinery). Chosen over direct
  temp-password reset because the admin never handles a working credential and
  it reuses the proven `/set-password` flow.
- Audit: append-only `password_reset_audit` table, mirroring the immutability
  pattern of `bet_admin_audit` (migration 0043): RLS admin read, admin insert
  with `admin_id = auth.uid()`, REVOKE UPDATE/DELETE from client roles.
- Email is derived server-side from the target user id (via
  `auth.admin.getUserById`), not trusted from the client, so the link and the
  audit row cannot be aimed at a different account.
- No mandatory reason field, to keep the action one tap (rule 10). The audit
  captures actor, target, timestamp. A reason column can be added later if we
  want it.
- Non-destructive: generating a recovery link does not invalidate the current
  password until the user sets a new one, so no confirmation dialog is needed.

## Alternatives rejected

- Direct temp-password reset (admin sets a random password, reads it out): the
  admin sees a live credential, weaker, and needs a force-change-on-login flow
  we do not have. Rejected.
- Adding audit only to the existing "Regenerate invite link" and relabeling it:
  conflates "invite a new/returning player" with "this person forgot their
  password." Keeping both, distinct, is clearer.

## Files

- `src/db/migrations/0045_password_reset_audit.sql` (new)
- `src/db/migrations/meta/_journal.json` (add 0045 entry)
- `src/db/schema.ts` (add `passwordResetAudit`)
- `src/app/[lang]/admin/users/actions.ts` (add `resetUserPassword`)
- `src/app/[lang]/admin/users/UsersExplorer.tsx` (add "Reset password" action +
  reuse the link-display panel)

## Security

- Admin-only: `assertAdmin()` gate on the server action.
- Service-role insert into an append-only, RLS-protected audit table; client
  roles cannot UPDATE/DELETE.
- Email derived server-side; client cannot redirect the link to another email.
- Recovery link is single-use and time-limited by Supabase.
- No secrets or passwords are logged; the audit stores ids and a timestamp.

## Open questions

- Do we want to surface the reset history in the UI later? Out of scope now.
