# Smart Reminders — תזכורות חכמות אישיות לשחקנים

**Date:** 2026-05-30
**Status:** Draft — awaiting approval
**Owner:** Yoav (via Claude)
**Target:** Live before World Cup kickoff 2026-06-11
**Builds on:**
- `_plans/2026-05-28-lock-reminders.md` (email reminders shipped; this plan delivers the deferred push iteration)
- `src/lib/notifications.ts` (`notifyUsers` helper) — feed + push pipeline already exists
- `src/db/schema.ts` (`bet_reminder_sent`, `push_subscriptions`, `profiles.push_opt_in`) — present

---

## 1. Goals

A signed-in player who opens the dashboard sees a single prominent card — "מה עכשיו" — that surfaces the 3-5 most relevant, personal, actionable things for them at this exact moment. The same engine fires push notifications for the two cases the player must not miss: an imminent lock on a bet they have not placed, and an incoming duel invite.

Success looks like:
- Players stop forgetting bets they meant to place. Empirically: drop the share of finals with no pick.
- Duels actually get accepted, not silently expire — inbound invites are visible within seconds.
- Players who fall behind in the table see a path back instead of disengaging.
- The dashboard does not feel like a generic AI widget. The copy reads like a friend nudging you, not a template.

Non-goals (deliberately out of scope for v1):
- LLM-generated copy at request time (costs + latency; deferred to phase 2 if needed).
- Reminders for match-score bets (cutoff is 5 minutes before kickoff; an asynchronous reminder cannot arrive in time to act on). The Smart Hub still surfaces unpicked imminent matches *in-app*; we just do not fire push for them.
- Cross-pool features, friend graphs, achievements gallery, etc.

## 2. Constraints

- **No new paid services.** Web-push uses the existing VAPID setup. No LLM calls at runtime. (Rule 8.)
- **Mobile-first.** Smart Hub renders correctly at 360px and up; tap targets ≥44px; no horizontal scroll. (Project CLAUDE.md.)
- **Security.** Every moment generator queries the authenticated user's own data via `getRequestUser()`. Dismiss endpoint authorizes session-bound user. Cron endpoint reuses `isAuthorizedCron(request)`. No PII or push content in logs. (Rule 13.)
- **Observability.** Namespaced logs at every meaningful step (`[smart-hub build]`, `[moments score]`, `[lock reminder push]`, `[duel notify]`, etc.). Values logged, not just events. (Rule 14.)
- **No regressions to existing notifications.** `notifyUsers()` keeps current shape; we extend `NotificationKind` and call the same helper. The `/notifications` feed page works unchanged.
- **No dashboard slowdown.** Smart Hub renders inside its own `<Suspense>`; the existing shell still paints first. Heavy queries are parallelized inside one server component.
- **Hebrew first, English mirrored.** All strings live in the dictionaries.

## 3. Requirements

### 3.1 Smart Hub (dashboard card)

**Placement.** On `src/app/[lang]/page.tsx`, sits in its own `<Suspense>` between `StatusRow` and `UpcomingSection` — the most-glanced strip on the dashboard. Replaces nothing existing.

**Anatomy.**
- Card header: small label "מה עכשיו" / "Up next", subtle accent.
- Body: vertical list of 3-5 "moments." Each moment is one row.
- Each row:
  - 40x40 round icon (lucide), tone-tinted by urgency
  - Title (bold, single line, truncates)
  - Subtitle (one short line of context)
  - CTA pill (e.g. "הימור עכשיו", "ראה לייב", "ענה לדו-קרב")
  - Small × button to dismiss until tomorrow
- Left border accent: 3px, color-coded
  - red: critical (lock in <2h, unpicked)
  - amber: time-sensitive (today's live bets, pending duel invite)
  - neutral: opportunity (catch-up suggestion, idle bank, near-miss recap)
- Entry micro-animation: `fade-up` 200ms, staggered 40ms per row.
- Empty state: a single 1-line card "הכל מסודר. תחזור לכאן לפני המשחק הבא." No giant placeholder.

**Responsiveness.**
- Mobile (<md): single column, full width inside the existing dashboard container.
- Desktop (md+): same card, max-w-3xl, sits above the columned section below.
- Rows are tap-friendly: each row is a `<Link>` to the CTA target, with the × stop-propagating onto a separate button.

**Visual style.** Matches existing card aesthetic (`Card` component, `surface-container-low`, `outline` border). Accent stripe uses existing token colors (`primary`, `tertiary`, `error`). No glassmorphism, no gradients — matches the rest of the app's deliberate, slightly editorial feel.

### 3.2 Moment catalog (the "smart" engine)

Each moment is a pure async function `generate(userId, ctx) → Moment | null` living in `src/lib/moments/<key>.ts`. Returns `null` when the moment does not apply.

**Shape of a `Moment`:**

```ts
type Moment = {
  key: string;            // stable identifier, e.g. "unpicked_match:<matchId>"
  type: MomentType;       // enum below
  urgency: "critical" | "time" | "opportunity" | "info";
  score: number;          // 0-100, ranker input
  icon: LucideIcon;
  titleHe: string;
  titleEn: string;
  bodyHe: string;
  bodyEn: string;
  ctaLabelHe: string;
  ctaLabelEn: string;
  ctaHref: string;        // localePath result
};
```

**Catalog (v1):**

| # | type | When it fires | Urgency | Base score |
|---|------|---------------|---------|-----------|
| 1 | `unpicked_match_imminent` | Match kicks off in ≤24h, user has no pick yet | critical if ≤2h, else time | 70-100 (rises as kickoff nears) |
| 2 | `pending_duel_invite` | Duel exists with status=open, joinerId=user, joinDeadlineAt in future | time | 90 |
| 3 | `live_bets_open_today` | ≥1 live custom_bet with scope=match/day, lock_at today, no user pick | time | 75 |
| 4 | `tournament_bet_open` | ≥1 tournament/stage custom_bet, lock_at in future, no user pick | opportunity | 50 |
| 5 | `group_winner_unpicked` | Group-scope custom_bet, lock_at ≤48h, no user pick | time | 65 |
| 6 | `duel_opportunity` | User in lower half, ≥1 player 1-3 ranks above is not in an active duel with user | opportunity | 45 |
| 7 | `position_catchup` | User in bottom 50% AND ≥3 open custom_bets exist they haven't placed | opportunity | 55 |
| 8 | `bank_idle` | User's available bank ≥ 30pts AND ≥1 stake-bet open without a pick | opportunity | 40 |
| 9 | `near_miss_recap` | Most recent graded match-pick missed exact score by exactly 1 goal | info | 25 |
| 10 | `matchday_summary` | At least one match graded in the last 24h, user has not seen the recap | info | 30 |

`streak_at_risk` and `leader_seized` are flagged for phase 2 once we have data to validate.

**Scoring.** Each generator returns a `baseScore`. The ranker applies:

- Recency boost: critical urgency adds +20 if T-lock ≤ 60min, +10 if ≤ 4h.
- Personal-impact boost: +10 if the user is in the bottom half of the leaderboard and the moment is a catch-up type.
- Diversity penalty: when ranking, after picking each moment, subsequent moments of the same `type` get a −15 penalty. Prevents 3 `unpicked_match_imminent` rows in a row.

The ranker picks the top N (default 4, configurable in settings, range 3-5). It also applies the user's per-moment dismissal state — see 3.3.

### 3.3 Dismissals

New table `user_moment_dismissals`:

```sql
create table public.user_moment_dismissals (
  user_id uuid not null references public.profiles(id) on delete cascade,
  moment_key text not null,             -- the Moment.key from the generator
  dismissed_until timestamptz not null, -- default: tomorrow 04:00 Asia/Jerusalem
  created_at timestamptz not null default now(),
  primary key (user_id, moment_key)
);

create index user_moment_dismissals_until_idx
  on public.user_moment_dismissals (dismissed_until);
```

The ranker `LEFT JOIN`s this per-user and drops any moment whose `key` has `dismissed_until > now()`. The dismiss button POSTs `/api/moments/dismiss { momentKey }`, the route inserts/upserts with `dismissed_until = tomorrow 04:00 IL`, and the client optimistically removes the row.

### 3.4 Push triggers (critical only)

Two new `NotificationKind` values: `lock_reminder` and `duel_received`. Both use the existing `notifyUsers()` helper.

**`lock_reminder`** — already wired for email in iteration 1. We add the push channel:

- `src/lib/sync.ts → sendDueReminders()` already finds (bet, user) pairs in the lock window and writes `bet_reminder_sent` rows with `channel='email'`.
- New branch: after the email pass, run the same eligibility query for the push channel. Filter users by `push_opt_in=true` AND owning ≥1 row in `push_subscriptions`. For each, call `notifyUsers({kind:'user', userId}, {kind:'lock_reminder', title, body, url, push:true})`. The unified helper inserts the feed row, fires push, and we record `bet_reminder_sent(channel='push')` on success — same dedup pattern.
- Idempotency: `bet_reminder_sent(custom_bet_id, user_id, channel='push')` PK prevents resends.

**`duel_received`** — fires inline:

- In `src/app/[lang]/duels/actions.ts`, the duel-creation server action (the one that inserts into `duels` with `status='open'`, joinerId set) calls `notifyUsers({kind:'user', userId: joinerId}, {kind:'duel_received', title:'דו-קרב חדש בשבילך', body:'<opener> פתח דו-קרב על <subject>. נותרו <X> דקות לענות', url:'/he/duels/<id>', push:true})` on success.
- The push helper already honors `push_opt_in`; users who opted out still see the feed row.

**`/notifications` page:** add the two new kinds to the `NotificationIcon` and `toneFor` switches with sensible icons (`Clock` for lock_reminder, `Swords` for duel_received).

### 3.5 Settings (rule 15)

The profile page already has a notification preferences area (push opt-in toggle). We add a section "תזכורות חכמות" with three checkboxes, all defaulting to ON:

- ☐ הצג Smart Hub בדשבורד הראשי
- ☐ קבל push כשמשחק שלא הימרת עליו נסגר בקרוב
- ☐ קבל push כשמישהו פותח נגדך דו-קרב

New columns on `profiles`:

```sql
alter table public.profiles
  add column smart_hub_enabled boolean not null default true,
  add column push_lock_reminders boolean not null default true,
  add column push_duel_received  boolean not null default true;
```

- `smart_hub_enabled = false` → server returns `null` for the Hub section, Suspense renders nothing.
- `push_lock_reminders = false` → user excluded from the push branch of `sendDueReminders`. Email still sends per existing behavior (no per-user email toggle today, by design from iteration 1).
- `push_duel_received = false` → inline duel notify still inserts the feed row, but `push: false` so no device wake.

The columns are AND'd with the existing top-level `push_opt_in` — both must be true to fire a given push.

### 3.6 Security (rule 13)

- Smart Hub server component reads `getRequestUser()`; all generators take `userId` and only query that user's rows.
- `/api/moments/dismiss` (POST): reads session, ignores body's `userId`, derives from session, validates `momentKey` against a regex (`^[a-z_]+(:[a-z0-9_-]+)?$`) before insert.
- Cron for lock reminder push reuses `isAuthorizedCron(request)` — no new attack surface; it's the same cron path that already runs email reminders.
- Push payload contains only the bet/duel surface URL + a short body. No tokens, no PII beyond the user's own first name (which the user already sees everywhere). Logs strip the body.
- Rate-limit on the dismiss endpoint: trivial per-user (one row per momentKey, idempotent), not separately rate-limited.

### 3.7 Observability (rule 14)

- `[smart-hub build] { userId, candidates: N, after_dismiss: N, picked: N, picked_keys: [...] }`
- `[moments score] { userId, key, type, baseScore, finalScore }` (one line per candidate, at info)
- `[moments dismiss] { userId, key, until }`
- `[lock reminder push] { betId, userId, lockAt }` (per send)
- `[lock reminder sweep] { channel, candidates, sent, failed, durationMs }` (per pass — already exists for email; we add channel field)
- `[duel notify] { duelId, recipientId, push: bool }`
- All at `console.info`; failures at `console.error` with `{ error: msg, …context }`.

### 3.8 Testing (rule 18)

Unit tests for every moment generator:
- `unpicked_match_imminent`: matches the window, excludes already-picked, scores rise with proximity.
- `pending_duel_invite`: only fires for joinerId=user, status=open, deadline future.
- `live_bets_open_today`: respects timezone (Asia/Jerusalem) for "today."
- `duel_opportunity`: rank-window logic + excludes existing active duels.
- `position_catchup`: bottom-half eligibility + count threshold.
- `bank_idle`: idle threshold + open custom_bet existence.
- `near_miss_recap`: |diff|=1 detection on most recent graded.
- `matchday_summary`: only the freshest 24h window, only once.

Ranker tests: diversity penalty, dismissal filter, top-N selection, urgency boost.

Push sweep test: same `bet_reminder_sent` table, second pass does not re-send; user without subscription is skipped without an error; opt-out user excluded.

Integration test on `<SmartHub />`: server component renders the expected count given a seeded user state, with the dismiss button wired to the API.

Run the relevant Vitest suite before declaring done. If any test framework decisions are needed, default to the project's existing one (per file naming) — do not introduce a new framework.

## 4. Approach (recommended)

Single PR, ordered like this:

1. **DB migration `0030_smart_reminders.sql`**: `user_moment_dismissals` table; `profiles` columns for smart hub + per-trigger push toggles; extend the kind check on `user_notifications` to include the two new kinds.
2. **Schema TS** updates in `src/db/schema.ts` — extend `NOTIFICATION_KINDS`, add the new table + columns.
3. **Moment generators** under `src/lib/moments/`:
   - `index.ts` — types + ranker + dismissal join
   - one file per generator listed in 3.2
   - `score.ts` — pure scoring utility
4. **API route** `src/app/api/moments/dismiss/route.ts` — POST dismiss.
5. **Smart Hub component** `src/components/SmartHub.tsx` — server async + small client island for the dismiss button (`SmartHubRow.tsx`).
6. **Dashboard wire-up** `src/app/[lang]/page.tsx` — add `<Suspense fallback={<SmartHubSkeleton/>}><SmartHubAsync .../></Suspense>` between `StatusRow` and `UpcomingSection`. Add the skeleton in `src/components/PageSkeleton.tsx`.
7. **Push wiring for lock reminders** — extend `sendDueReminders` in `src/lib/sync.ts` with a push branch, dedup via `bet_reminder_sent(channel='push')`. Honor `profiles.push_lock_reminders` + `push_opt_in`.
8. **Duel notify** — find the duel-create server action in `src/app/[lang]/duels/actions.ts` and call `notifyUsers` after the insert. Honor `profiles.push_duel_received`.
9. **Notification feed icons** — extend `NotificationIcon` + `toneFor` in `src/app/[lang]/notifications/page.tsx` for the new kinds.
10. **Settings UI** — add the three checkboxes to the profile page's notifications section + the corresponding server action.
11. **Dictionaries** — all Hebrew + English strings under the existing dictionary structure (one new namespace `smartHub`).
12. **Tests** — Vitest suites for generators, ranker, dismiss route, push sweep behavior. Manual QA per section 5.
13. **Observability** — verify the namespaced logs print as expected for one representative moment + one push.

### What stays untouched

- The existing `/notifications` page, broadcast admin, push-test admin, `notifyUsers` signature — none changes.
- Email-channel lock reminders. We only add a parallel push pass; email continues as-is.
- Match-pick scoring, duel scoring, leaderboard logic.

## 5. QA checklist (rule 6)

**Golden path:**
- Signed-in player on `/he` sees the Smart Hub with 4 personalized rows above their upcoming matches; tapping a row navigates correctly; dismiss removes that row immediately and it does not reappear until tomorrow 04:00 IL.
- 30 minutes before kickoff of a match the user has not picked: their device receives a push titled with the match teams; tapping it opens the matchday picker; the row also shows up in `/notifications`.
- Opponent opens a duel against the user; within seconds the user's device receives a push; the row shows in `/notifications` and the Smart Hub.

**Edges:**
- New user with zero bets and zero history → Hub shows the empty state ("הכל מסודר…"), not a half-broken card.
- All moments dismissed → empty state.
- User opted out of push entirely (`push_opt_in=false`) → no pushes; feed rows still recorded.
- User opted out of one trigger but not the other → exactly the chosen behavior.
- User in last place with many open bets → catch-up + bank-idle both eligible; diversity penalty leaves at most one of each.
- Matchday late at night crossing the 04:00 IL dismissal boundary → dismissed rows reappear correctly at 04:00.
- Lock reminder push fires once even if cron runs every minute (idempotency via `bet_reminder_sent`).
- Push send fails (browser revoked subscription) → `notifyUsers` prunes the subscription; feed row still present; no infinite retry.

**Mobile checklist (project CLAUDE.md):**
- 360px width: every row readable, CTA tappable, dismiss button ≥44px.
- Long Hebrew strings do not push horizontal scroll.
- Bottom nav doesn't obscure the Hub; existing `pb-24` on the dashboard container suffices.

## 6. Cost (rule 8)

- Web push: zero incremental cost (browser API, VAPID self-hosted).
- DB: one tiny table + 3 columns, indexed. Negligible.
- LLM: none.
- Email: no change from iteration 1.

No cost flag triggered.

## 7. Settings audit (rule 15)

Three new user-facing toggles in the profile (3.5). Defaults ON. No hardcoded behavior that the user cannot change later. Admin-side defaults are not exposed for v1 because this is a per-user preference, not an org-wide one.

## 8. Files

**New:**
- `src/db/migrations/0030_smart_reminders.sql`
- `src/lib/moments/index.ts`
- `src/lib/moments/score.ts`
- `src/lib/moments/unpicked_match_imminent.ts`
- `src/lib/moments/pending_duel_invite.ts`
- `src/lib/moments/live_bets_open_today.ts`
- `src/lib/moments/tournament_bet_open.ts`
- `src/lib/moments/group_winner_unpicked.ts`
- `src/lib/moments/duel_opportunity.ts`
- `src/lib/moments/position_catchup.ts`
- `src/lib/moments/bank_idle.ts`
- `src/lib/moments/near_miss_recap.ts`
- `src/lib/moments/matchday_summary.ts`
- `src/components/SmartHub.tsx`
- `src/components/SmartHubRow.tsx` (client island for dismiss)
- `src/app/api/moments/dismiss/route.ts`
- Vitest suites alongside each generator + `__tests__` for the ranker and route

**Modified:**
- `src/db/schema.ts` — `NOTIFICATION_KINDS` + new table + new columns
- `src/lib/sync.ts` — push branch of `sendDueReminders`
- `src/app/[lang]/duels/actions.ts` — inline `notifyUsers` on create
- `src/app/[lang]/page.tsx` — `<SmartHubAsync/>` Suspense
- `src/components/PageSkeleton.tsx` — `<SmartHubSkeleton/>`
- `src/app/[lang]/notifications/page.tsx` — `NotificationIcon` + `toneFor` cases
- `src/app/[lang]/profile/page.tsx` (or the existing notifications-settings surface) — three new toggles + server action
- `src/app/[lang]/dictionaries/he.ts`, `…/en.ts` — `smartHub` namespace

## 9. Open questions

Defaults below. Will proceed unless flagged.

1. **Max rows in the Hub.** Default 4. Range 3-5 via the settings (deferred — single fixed value in v1).
2. **Reappearance window of a dismissed moment.** Default: tomorrow 04:00 IL. Some moments could justify shorter (e.g. catch-up: same matchday). Sticking with the single rule for v1.
3. **Match-imminent moment also fires push?** Default NO. Email/push for match picks was out of scope in iteration 1 because the cutoff is too tight; we keep it that way. The Hub row covers in-app awareness.

## 10. Alternatives considered

**Distributed mini-nudges per page instead of a central Hub.** Rejected at scope alignment — Hub centralizes "what should I do now" and reads as one place to check. Distributed nudges are a future extension if specific surfaces (live tab, duels tab) need their own in-context call-out.

**Score-less, fixed-priority list.** Rejected. The interesting value is "the Hub reads my situation"; a fixed list devolves to a static checklist and stops feeling personal once the catalog grows.

**LLM-narrated copy at request time.** Rejected for v1. Latency on the dashboard's most-glanced strip is the wrong place to add a model round-trip, and the cost (rule 8) per pageview adds up across the pool. Hand-written Hebrew copy that uses the actual data (team names, ranks, minutes-to-lock) reads more specific than templated LLM output and zero-cost. Phase 2 can experiment with LLM-flavored variations behind a settings flag.

**Reuse `/notifications` as the only surface.** Rejected at scope alignment — the existing feed is a chronological log. Smart reminders are state-dependent, must-act-now items. Mixing them dilutes both surfaces.
