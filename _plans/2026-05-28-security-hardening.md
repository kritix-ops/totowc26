# Security Hardening Pass

**Date:** 2026-05-28
**Status:** Approved, executing in-session
**Owner:** Yoav
**Scope:** Three small, high-leverage fixes. The rest of the audit stays as recorded follow-ups.

---

## 1. Goal

Close the three highest-value security gaps surfaced by today's audit
without touching anything that's already working. The app already has
strong RLS, server-side authorization on every mutation, and points
accounting that resists tampering. What's missing is mostly defensive
hardening at the HTTP and credential layers.

This pass keeps the change surface tiny so we can review and ship without
risking regressions to the betting flow on the eve of the tournament.

---

## 2. Audit summary (reference)

Full audit recorded in conversation; condensed here:

- RLS, AuthZ, input validation, secrets hygiene, points integrity, deps: **OK to GOOD**
- Security headers (CSP/X-Frame/HSTS/etc): **missing → HIGH severity**
- Password policy on `set-password` (6 chars, no complexity): **WEAK → MEDIUM**
- Cron secret accepts `?secret=` query param: **leaks in logs/history → MEDIUM**
- MFA, persistent audit log, Upstash rate limit, Resend webhook signing: deferred (acceptable for friends pool).

---

## 3. Scope (the three fixes)

### 3.1 Add security headers to `next.config.ts`

Add a new headers entry that matches every path (`source: "/(.*)"`) and
sets:

| Header | Value | Why |
|--------|-------|-----|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | Force HTTPS for 2 years across all subdomains. Safe: we only ever serve over HTTPS via Vercel. |
| `X-Frame-Options` | `DENY` | Block iframe embedding. The app is never meant to be embedded. |
| `X-Content-Type-Options` | `nosniff` | Stop the browser from sniffing MIME types (defense against MIME-confusion XSS). |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Strip query params (cron secret etc.) from referrers when leaving the site. |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), browsing-topics=()` | We never use these APIs; disable to reduce attack surface and opt out of FLoC/Topics. |
| `X-DNS-Prefetch-Control` | `on` | Speed gain, no risk. |

**CSP is intentionally not in scope this pass.** A tight CSP needs a
full inventory of inline scripts, Supabase Auth UI hosts, Resend tracking
pixels, and so on. Better as its own dedicated PR. Tracking as
follow-up below.

**Acceptance:** `curl -I https://toto.kritix.io` (or local dev `curl -I
http://localhost:3000`) shows the six headers above on a regular page
load.

### 3.2 Tighten password policy in `set-password`

`src/app/[lang]/set-password/actions.ts`:
- Raise minimum length from 6 to 12.
- Require at least one letter and one digit. No symbol requirement: UX
  cost outweighs the marginal benefit at 12 chars.
- Keep `"weak"` as a single error bucket (both "too short" and "no
  letter+digit" map to it) so the client doesn't need new code paths.
  The user-facing copy describes the new rule.

`src/app/[lang]/set-password/SetPasswordForm.tsx`:
- Update `minLength={6}` → `minLength={12}` on both inputs.
- Update placeholder copy ("At least 12 characters, letters and
  numbers" / "לפחות 12 תווים, אותיות וספרות").
- Update the `translate(weak…)` copy to match.

We do **not** touch the login form. Login intentionally accepts any
length to avoid leaking the policy to attackers and to grandfather in
existing 6-char passwords until next login (Supabase forces an update on
auth events when the configured policy tightens).

**Note on existing 6-char passwords**: they continue to work for login.
Only the next password change (via `set-password`) is forced to the new
floor. This is fine because the population is small and trusted.

**Acceptance:** Manual test. Try `aaaaaa` (too short), `aaaaaaaaaaaa`
(no digit), `aaaaaaaaaaa1` (passes). All three give clean error / success
states. The form's HTML `minLength` blocks submit before reaching the
server.

### 3.3 Remove the `?secret=` query-param fallback on cron

`src/app/api/cron/sync/route.ts`:
- Remove the `searchParams.get("secret")` branch from `authorized()`.
- Keep `Authorization: Bearer ${CRON_SECRET}` as the only accepted form.

**Verified safe to remove:**
- `vercel.json` cron entry uses Vercel's signed `Authorization` header automatically.
- `scripts/e2e-reminder.mjs:181` already calls with `headers: { authorization: "Bearer " + cronSecret }`.
- `_plans/` references are historical docs, not callers.

**Acceptance:** Hit `/api/cron/sync?secret=<real-secret>` → 401.
Hit `/api/cron/sync` with the bearer header → 200.

---

## 4. Out of scope (deferred, recorded for later)

These all came up in the audit. Calmly listed, not pressured:

| # | Item | Why deferred |
|---|------|--------------|
| A | Full Content-Security-Policy header | Needs full inventory of script/style/connect sources first. Significant risk of breaking Supabase Auth or Resend tracking pixels if rushed. Own PR. |
| B | MFA / 2FA | Friends pool. Adds onboarding friction not justified by threat model. |
| C | Persistent audit log table | Vercel function logs are good enough at current scale. |
| D | Upstash/Redis rate limit | In-memory bucket is acceptable until we see actual cold-start abuse. |
| E | Explicit RLS INSERT/UPDATE/DELETE on `duels` | App-layer `getUserAccess()` already guards. Defense-in-depth would be nice, not load-bearing. |
| F | Resend webhook signature validation | No webhook endpoint exists yet; will be added when bounce handling lands. |
| G | Email unsubscribe link compliance | Transactional only; revisit when first marketing email lands. |

---

## 5. Observability

Per `CLAUDE.md` rule 14, the cron change keeps the existing log line
(`[cron sync] returning…`) so the failure mode (401 from query-param
attempt) is still visible.

No new observability needed for headers (response headers are visible
in DevTools / `curl -I`) or for password policy (form-level errors are
already logged via the existing action flow).

---

## 6. Settings audit

Per `CLAUDE.md` rule 15, walked through each change:
- Headers: not user-configurable. Correct: security headers are not a
  user preference.
- Password policy: not user-configurable. Correct.
- Cron: not user-configurable. Correct.

No new settings surface.

---

## 7. QA plan

After all three changes are made:

1. `pnpm lint`: clean.
2. `pnpm test`: existing suite passes.
3. `pnpm build`: succeeds (catches type errors in `next.config.ts`).
4. Manual: load `http://localhost:3000` → DevTools Network → check
   response headers on the document request, all six present.
5. Manual: `/he/set-password` with `aaa` → blocked at form. With
   `aaaaaaaaaaaa` (12 letters) → server returns `weak`. With
   `aaaaaaaaaaa1` → success.
6. Manual: `curl -I http://localhost:3000/api/cron/sync?secret=$CRON_SECRET`
   → 401. `curl -I -H "Authorization: Bearer $CRON_SECRET"
   http://localhost:3000/api/cron/sync` → 200.

---

## 8. Rollback

Each change is a single file, no migrations, no DB changes. Revert any
single file independently. Zero data risk.
