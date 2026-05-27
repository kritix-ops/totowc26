# Lock Reminders: "Bet X locks in Y" Notifications

**Date:** 2026-05-28
**Status:** Iteration 1 (email) approved; iteration 2 (push) outlined
**Owner:** Yoav
**Target:** Live before World Cup kickoff 2026-06-11
**Builds on:** `_plans/2026-05-27-betting-deadlines.md`

---

## 1. Goal

Players get a reminder a configurable amount of time before each custom
bet they could still pick locks. The admin sets the offset once in
`/admin/deadlines` (e.g. "60 minutes before"). Players who have already
made a pick on that bet do **not** get a reminder for it — keeps volume
down and keeps the reminders relevant.

Two iterations because they have very different infrastructure costs:

- **Iteration 1 (this PR, today): email** via Resend. Existing
  integration; lowest friction.
- **Iteration 2 (separate PR, separate session): push notifications**
  via web-push + VAPID + service worker.

When iteration 2 lands, the sender pass dispatches both channels in
parallel — opt-out controls land with iteration 2 since email alone has
no user-side toggle today.

---

## 2. Decisions locked (this session)

| # | Question | Yoav's answer |
|---|----------|---------------|
| 1 | Channels | **Email + push, both** (iterated; email first) |
| 2 | Recipients | **Only users who haven't picked the bet yet** |
| 3 | Schedule | **One reminder, admin-configurable offset** |

---

## 3. Cost flag (rule 8)

Resend pricing as of 2026-05-28:
- Free tier: 3,000 emails/month with a **100/day hard cap**.
- Pro: $20/month for 50,000 sends; $0.90 per 1,000 overage.

Conservative volume model for this app:
- ~30-50 players × ~10 custom bets opening per matchday × 30 matchdays
  = up to ~15,000 emails if everyone got every reminder.
- "Only unpicked users" filter cuts ~50%, weighted to bets where most
  haven't yet picked.
- Daily peak around the group stage likely exceeds the 100/day free cap.

**Conclusion**: expect to upgrade to Pro ($20/month) during the live
window. Free tier may hold during slow days. Admin can throttle by
choosing larger reminder offsets to combine batches.

Push notifications (iteration 2): zero incremental cost (self-hosted
web-push, browser-native API).

---

## 4. Iteration 1 (this PR): email only

### 4.1 Data model

**New table** `bet_reminder_sent`:

```sql
create table public.bet_reminder_sent (
  custom_bet_id uuid not null references public.custom_bets(id)
    on delete cascade,
  user_id uuid not null references public.profiles(id)
    on delete cascade,
  channel text not null check (channel in ('email', 'push')),
  sent_at timestamptz not null default now(),
  primary key (custom_bet_id, user_id, channel)
);
```

Per (bet, user, channel) idempotency — the cron pass that runs every
minute won't re-send a reminder that's already been sent. `channel` is
on the primary key so iteration 2 (push) can record its own row
alongside the email row without conflict.

**New settings column**:

```sql
alter table public.settings
  add column reminder_offset_minutes integer not null default 60
    check (reminder_offset_minutes between 0 and 60 * 24 * 7);
```

Default 60 min before lock. 0 = feature off (no reminders sent).
Hard upper bound at 7 days because longer reminders make no sense for
short-lived bets.

### 4.2 Sender pass (`src/lib/sync.ts`)

New function called from `_runSync()`:

```ts
async function sendDueReminders(): Promise<number> {
  // 1. Skip entirely when reminder_offset_minutes = 0.
  // 2. Find every open custom bet whose lock_at is in the window
  //    (now, now + reminder_offset_minutes].
  // 3. For each, find users who:
  //      - have access (canEdit per existing access table)
  //      - have NOT placed a pick on this bet
  //      - have NOT already received an email reminder for this bet
  //    in a single SQL query (3-way LEFT JOIN) to avoid N+1.
  // 4. For each (bet, user) row, send the reminder email and insert
  //    bet_reminder_sent on success. Failures are logged and skipped;
  //    the next cron pass retries because the marker only lands on
  //    successful send.
  // 5. Log [lock reminder send] per row and
  //    [lock reminder sweep] per pass with the count and duration.
}
```

Why insert AFTER send and not before:
- If we insert first and the send fails, the user never gets a reminder
  and we can't retry without a manual cleanup.
- If we send first and the insert fails, the user gets two reminders
  on the next pass — annoying but not load-bearing.
- The send is the side effect we care about; the marker is just dedup
  state.

### 4.3 Email template

`src/lib/email/templates/BetLockReminderEmail.tsx` — mirrors the shape
of `DuelJoinedEmail`. Hebrew first, English appended.

Content:
- Hebrew subject: "תזכורת: הימור נסגר בקרוב"
- Greeting with first name
- Bet question (questionHe)
- Grading rule one-liner (gradingRuleHe)
- Stake/payout chip
- Lock time absolute (Asia/Jerusalem) + "locks in ~X minutes" relative
- CTA button "פתח את ההימור" linking to the right surface based on
  scope (/bets/live/{date} or /bets/tournament or /bets/groups etc).
- English summary at bottom for the EN-locale subset.

### 4.4 Admin UI

`/admin/deadlines` gets a new section above the type defaults:

**Section: תזכורות**
- Single number input "reminder offset (minutes)" with helper text
  "תזכורת אחת תישלח לכל שחקן שעוד יכול להמר, X דקות לפני שההימור
  נסגר. 0 = ללא תזכורות."
- Save button.

### 4.5 Observability

- `[lock reminder send]` per (bet, user) send: `{ betId, userId, channel, lockAt, offsetMinutes }`
- `[lock reminder skip]` per row that was filtered out: rare, for debugging.
- `[lock reminder failed]` per send failure: `{ betId, userId, error }`
- `[lock reminder sweep]` per pass: `{ candidates, sent, failed, durationMs }`

### 4.6 What we are NOT shipping in iteration 1

- Per-user opt-out (covered in iteration 2 with push opt-in, since
  email alone wasn't called out as needing a toggle).
- Push notifications (iteration 2).
- Multiple escalating reminders.
- Reminders for match score (1/X/2) bets — their default cutoff is
  5 minutes; an email reminder wouldn't arrive in time to act on.
- Reminders for duels — duels have their own joinDeadlineAt flow.

---

## 5. Iteration 2 (separate PR, separate session): push notifications

Outlined here so iteration 1 can build the right abstractions.

### 5.1 Data model

- `push_subscriptions` table: `(id, user_id, endpoint, p256dh, auth, user_agent, created_at, last_seen_at)`. Multi-device supported.
- `profiles.push_opt_in boolean default false`. Opt-IN, not opt-out:
  users must agree to receive push.

### 5.2 Infrastructure

- New env vars: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.
  Generated once via `scripts/generate-vapid.mjs`.
- New dep: `web-push@^3.6`.
- New API routes: `POST /api/push/subscribe`, `POST /api/push/unsubscribe`.
- Service worker push handler: add to existing `public/sw.js` (or new one).
- Profile page toggle: "Receive push notifications".

### 5.3 Sender pass changes

`sendDueReminders` becomes channel-aware:
- Compute the (bet, user) set once.
- For each user, filter by `push_opt_in` + active subscription → push channel.
- All users always get email channel (no opt-out in iteration 1).
- Both channels write to `bet_reminder_sent` with their own row.

---

## 6. Files (iteration 1)

**New:**
- `src/db/migrations/0023_lock_reminders.sql`
- `src/lib/email/templates/BetLockReminderEmail.tsx`
- `_plans/2026-05-28-lock-reminders.md` (this file)

**Modified:**
- `src/db/schema.ts` — `settings.reminderOffsetMinutes` + `betReminderSent` table
- `src/lib/sync.ts` — `sendDueReminders()` + register in `_runSync`
- `src/app/[lang]/admin/deadlines/page.tsx` — load reminder offset
- `src/app/[lang]/admin/deadlines/DeadlinesForm.tsx` — reminder section
- `src/app/[lang]/admin/deadlines/actions.ts` — `saveReminderOffset`

---

## 7. QA (rule 6)

**Golden:**
- Open a custom bet, set its lockAt 90 min from now. Set
  reminder_offset_minutes = 60. Run sync. No reminder yet (90 > 60).
  Wait until ~58 min before lock. Run sync. Reminder lands; row in
  bet_reminder_sent. Run sync again 1 min later. No second email.

**Edges:**
- reminder_offset_minutes = 0 → no emails ever sent.
- User has already picked → no email.
- Email send fails (Resend down) → no row inserted; next pass retries.
- Bet auto-locks (status open → locked via existing lockExpiredCustomBets
  pass) before reminder fires → reminder still sends if the (bet, user)
  query catches it before the lock pass; the bet is then locked and
  email is "you'd have liked to pick this but it's gone now" — a bit
  awkward. Acceptable for v1; fix in a follow-up if it matters.
- 100/day Resend cap hit mid-sweep → some sends fail with rate-limit;
  next pass retries them; eventual consistency.

**Tests:**
- Unit: pure helpers for choosing the email surface URL per scope.
- Manual: trigger the cron with a near-deadline test bet.
