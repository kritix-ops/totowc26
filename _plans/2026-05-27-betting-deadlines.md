# Betting Deadlines: Admin-Controlled Lock Times

**Date:** 2026-05-27
**Status:** Awaiting Yoav's approval before code starts
**Owner:** Yoav
**Target date:** Live by **2026-06-11** (World Cup kickoff)

---

## 1. Goal

One admin surface that decides when **every** kind of bet on the app
closes for new picks, with three layers of flexibility:

- **Layer 1 – default per bet type** (six knobs): how many minutes before
  the anchor event of that type the bet stops accepting picks.
- **Layer 2 – per matchday** (one override per day): "all bets anchored
  to anything on this day lock N minutes before the earliest kickoff,
  regardless of the global default".
- **Layer 3 – per bet** (the hardest override): an explicit absolute
  `lockAt` on the individual bet (already exists for custom bets) or
  an explicit per-match override (new for 1/X/2 score bets).

Once the deadline passes, the bet is locked **in the database** by a
background pass (no longer "client says no, DB still says open"), and
the player sees a live "נסגר בעוד 1:23:45" countdown that flips to
"נעול" when the time runs out.

The same engine drives **score predictions (1/X/2)**, **all five
custom-bet scopes** (match / day / stage / group / tournament), and
the **tournament-wide bets** that need to anchor relative to the World
Cup kickoff itself (e.g. "סגור שעה לפני התחלת המונדיאל").

---

## 2. Constraints (from `~/.claude/CLAUDE.md` and project `CLAUDE.md`)

- **Verify, never guess** (rule 1): every claim in this plan ties to a
  file:line I've read this session. The DB pieces are grounded in
  `src/db/schema.ts:200-491`, the submit gate in
  `src/app/[lang]/bets/[matchId]/actions.ts:54-69`, the custom-bet
  pick gate in `src/app/[lang]/play/[date]/actions.ts:66-68`, and the
  sync passes in `src/lib/sync.ts:200-247`.
- **Clean ordered code** (rule 2): new table sits alongside existing
  Drizzle conventions in `src/db/schema.ts`. New settings columns slot
  into the existing block. New routes follow `src/app/[lang]/admin/...`.
- **Alignment before code** (rule 3): scope locked via the four-question
  round above this plan; written here so we never rebuild from scratch.
- **Alternatives + recommendation** (rule 4): three architecture options
  were considered (single-knob extension, materialised per-bet `lockAt`,
  live layered resolver). The live layered resolver was picked. The
  other two are written down in §15 so we remember why we said no.
- **Mobile-first responsive** (project `CLAUDE.md`): the admin form and
  the new countdown component both tested at 360 / 414 / 768 / 1024 /
  1440 px. 44×44 px touch targets. Asia/Jerusalem rendering via
  `formatDateTime` from `src/lib/format.ts` (auto-memory enforced).
- **Cost flagging** (rule 8): no new paid service. We piggyback on the
  existing Supabase cron call (`src/app/api/cron/sync/route.ts`) for the
  auto-lock pass. Zero incremental cost.
- **Context7 before library code** (rule 9): consult Context7 for any
  Drizzle 0.34 / Next.js 15 server-action surface touched.
- **Lazy user** (rule 10): admin sees one screen, three sections, plain
  Hebrew labels ("ננעל X דקות לפני בעיטת הפתיחה"). Player sees a single
  live countdown — no settings, no toggles.
- **Council** (rule 11): skipped per project auto-memory
  ("Autonomous in-session after scope is set"). Scope is set; running
  council on every sub-decision is exactly the friction that memory
  bans.
- **Brutal honesty** (rule 12): the one real risk is the auto-lock job
  drifting if the cron stalls. Mitigation in §7 — the submit-time check
  is the safety net, the cron is the source-of-truth update.
- **Security from day 1** (rule 13): admin route gated by existing
  `isAdmin()` helper. RLS on the new `bet_lock_defaults` table mirrors
  the policy on `settings` (admin-only writes, all signed-in reads).
  Negative offsets blocked at the DB CHECK level so a fat-finger can't
  set "lock 60 minutes AFTER kickoff".
- **Observability from day 1** (rule 14): every step in the resolver
  emits `[deadline resolve]` with the inputs and the chosen branch;
  the background pass logs `[deadline auto-lock]` per row it flips;
  the admin save logs `[admin deadlines save]` with the diff. See §10.
- **Settings audit** (rule 15): the six default offsets, the tournament
  start datetime, and the per-matchday override all land in a dedicated
  admin surface (`/admin/deadlines`) rather than hidden in the scoring
  form. Defaults set so the existing 5-minute behavior is preserved on
  upgrade — no surprise lockout for already-published bets.
- **Polished UI** (rule 16): the countdown is a thin, restrained pill
  next to the bet title; not a giant red banner. The admin form uses
  the same input shapes as `ScoringForm.tsx` so it feels like one app.

---

## 3. Decisions locked (this session, 2026-05-27)

| # | Question | Yoav's answer |
|---|----------|---------------|
| 1 | How many layers of flexibility? | **Three** — type default + matchday override + per-bet override |
| 2 | Auto-close in DB? | **Yes** — background job flips `status` to `locked`, client also blocks |
| 3 | Anchor for tournament-wide bets? | **`tournamentStartAt` in settings + relative offset** |
| 4 | Show player a "נסגר בעוד..." countdown? | **Yes** — countdown when close, "נעול" badge after |

No further open questions on scope. Sub-decisions during build (column
names, log namespaces, exact placement of the countdown pill) are mine
to make autonomously per the project auto-memory.

---

## 4. Data model

### 4.1 New table: `bet_lock_defaults`

```sql
create table public.bet_lock_defaults (
  bet_type text primary key,
  offset_minutes integer not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  check (offset_minutes >= 0),
  check (bet_type in (
    'match_score',         -- 1/X/2 prediction
    'custom_match',        -- custom bet scoped to one match
    'custom_day',          -- custom bet scoped to a whole matchday
    'custom_stage',        -- custom bet scoped to a tournament stage
    'custom_group',        -- custom bet scoped to a group letter
    'custom_tournament'    -- custom bet scoped to the whole tournament
  ))
);
```

Seed rows in the same migration:

| bet_type | offset_minutes | Anchor | Result with default |
|---|---|---|---|
| `match_score` | 5 | `matches.kickoff_at` | locks 5 min before kickoff (preserves current behavior) |
| `custom_match` | 5 | `matches.kickoff_at` | locks 5 min before kickoff |
| `custom_day` | 5 | earliest kickoff of the matchday | locks 5 min before the day's first match |
| `custom_stage` | 60 | earliest kickoff in the stage | locks 1 hr before the stage opens |
| `custom_group` | 60 | earliest kickoff in the group | locks 1 hr before the group's first match |
| `custom_tournament` | 60 | `settings.tournament_start_at` | locks 1 hr before WC kickoff |

RLS: `select` open to authenticated, `update` only when
`profiles.role = 'admin'`. Migration mirrors the policy on `settings`
in migration 0009.

### 4.2 `settings` table: one new column

```sql
alter table public.settings
  add column tournament_start_at timestamptz not null
    default '2026-06-11 18:00:00+00';  -- WC 2026 first match kickoff UTC
```

(The 18:00 UTC corresponds to the first scheduled match of the
tournament; admin can edit any time.) `betLockMinutes` stays on the
table but becomes unused at runtime — kept for one cycle so existing
queries that join `settings.bet_lock_minutes` don't break mid-deploy,
then dropped in a follow-up.

### 4.3 `matchdays` table: one new column

```sql
alter table public.matchdays
  add column lock_offset_override_minutes integer
    check (lock_offset_override_minutes is null
           or lock_offset_override_minutes >= 0);
```

When set, this overrides **every** per-type default for bets anchored
to this matchday (`match_score`, `custom_match`, `custom_day`). Stage-,
group-, and tournament-scope bets are not affected — those have their
own anchors.

`matchdays.default_lock_at` is left in place (it's been a stored
snapshot all along, not the truth) and will be deprecated in a
follow-up. We don't read it anywhere new.

### 4.4 `matches` table: one new column

```sql
alter table public.matches
  add column lock_at_override timestamptz;
```

This is the per-bet override for **score bets on this match**. If set,
it wins over both the matchday override and the type default. Null
means "use the resolver chain".

### 4.5 `custom_bets.lockAt` — semantics change

Today `lockAt` is `not null` and admin sets it explicitly at creation.

After this change:
- `lockAt` stays `not null` (no DB migration needed for the column).
- It's now treated as the **per-bet override** — the resolver returns
  it verbatim when it's set.
- New bets created via the admin form get `lockAt` auto-filled from
  the resolver at submit time so existing rows stay consistent.
- A "use defaults" checkbox in the form clears the override by writing
  the resolver's current answer back to the row — that means future
  default changes don't shift this bet, which matches today's mental
  model (admin saw a time, that's the time).

This avoids a destabilising "what if lockAt is null?" branch across the
codebase. Net: every custom bet always has a concrete `lockAt` on the
row, but the admin can ask the form to recompute it from current
defaults at any time.

---

## 5. The resolver (`src/lib/deadlines.ts` — new file)

Pure function, no DB writes:

```ts
type BetType =
  | "match_score"
  | "custom_match" | "custom_day" | "custom_stage"
  | "custom_group" | "custom_tournament";

export type ResolveInput =
  | { type: "match_score"; match: { kickoffAt: Date; lockAtOverride: Date | null };
      matchday: { lockOffsetOverrideMinutes: number | null } }
  | { type: "custom_match"; bet: { lockAt: Date };
      match: { kickoffAt: Date };
      matchday: { lockOffsetOverrideMinutes: number | null } }
  // ... one variant per bet type
  ;

export interface ResolveResult {
  effectiveLockAt: Date;
  source: "per_bet_override" | "matchday_override" | "type_default";
  appliedOffsetMinutes: number;
  anchor: Date;
}

export function resolveDeadline(
  input: ResolveInput,
  context: {
    defaults: Record<BetType, number>;          // from bet_lock_defaults
    tournamentStartAt: Date;                     // from settings
  }
): ResolveResult { ... }
```

Resolution order (highest priority first):

1. **Per-bet override** —
   - Score bet: `match.lockAtOverride` if non-null.
   - Custom bet: `bet.lockAt` (always set; admin's explicit value).
2. **Matchday override** — only for score / custom-match / custom-day
   bets that have a `matchdayId`. If `matchday.lockOffsetOverrideMinutes`
   is non-null, anchor minus that many minutes.
3. **Type default** — `defaults[type]` minutes before the anchor.

Anchor by type:
- `match_score`, `custom_match` → `match.kickoffAt`
- `custom_day` → earliest `matches.kickoff_at` on `matchday.date`
- `custom_stage` → earliest kickoff in that `stage`
- `custom_group` → earliest kickoff in that `groupId`
- `custom_tournament` → `settings.tournamentStartAt`

The resolver returns the **chosen source** in the result so callers
can log it and the admin UI can render "this bet's lock came from
matchday X's override".

Sibling helper `getDeadlineContext()` loads defaults + tournament start
in one query and caches per request via React's `cache()` so a page
that renders 30 bets doesn't run 30 settings reads.

**No `null` ever returned.** A bet with an anchor we can't resolve
(e.g. tournament-scope bet but admin hasn't set `tournament_start_at`)
falls back to `tournament_start_at` default value, which the migration
guarantees is non-null. The DB constraint is the safety net.

---

## 6. Submit enforcement

Two server actions update:

### 6.1 Score bet submit
File: `src/app/[lang]/bets/[matchId]/actions.ts:54-69`

Replace the current single-line SQL gate
(`m.kickoff_at > now() + (s.bet_lock_minutes || ' minutes')::interval`)
with a call to the resolver, then compare `effectiveLockAt > now()`.
The match row + matchday row + override columns get pulled together in
one query so we still do one round trip.

### 6.2 Custom-bet pick submit
File: `src/app/[lang]/play/[date]/actions.ts:66-68`

Today: `if (bet.lockAt.getTime() <= Date.now()) return locked`. Replace
with resolver call on the loaded `bet`. (For now the resolver mostly
echoes `bet.lockAt` back because that's the per-bet override, but the
indirection is what lets a future "no per-bet override, compute live"
toggle work without touching submit code again.)

Both actions log `[deadline resolve]` with the resolver result before
the comparison, and `[bet rejected lock]` with the time skew when they
reject a submission.

---

## 7. Auto-lock background pass (`src/lib/sync.ts`)

New function, called from `runSync()`:

```ts
export async function lockExpiredCustomBets(): Promise<number> {
  // Pull every status='open' bet, resolve its effective lockAt, and
  // flip status='locked' for any whose deadline has passed. Idempotent.
  // Uses one batch query joined to matches + matchdays so a 200-bet
  // tournament doesn't hammer the DB.
}
```

Implementation note: for cost / simplicity, we compute the lock time
**in SQL** for the bulk pass rather than calling the TS resolver in a
loop. The resolver is the source of truth for *one* bet; the SQL is
the source of truth for *the batch update*. Both apply the same rule
chain. A unit test (§13) asserts the two agree on a fixture set so
they don't drift.

For score bets: we don't flip a row per (user, match) — that's already
how `matchBets.locked` works, set when the match becomes `final`. The
*betting window* for a score bet is closed by the submit-time check
plus the player-facing UI; no new per-row flip needed.

The pass is added to the existing cron at
`src/app/api/cron/sync/route.ts`, which already runs every minute, so
the worst-case delay between "deadline passed" and "DB reflects lock"
is ~60 seconds. The submit-time check (§6) closes that window —
players can't slip a pick in during the 60s gap because the resolver
rejects them client-locally and the server re-checks.

Drift mitigation: if the cron fails for >5 minutes the existing
`/admin` health tile will flag it. The submit gate is the real safety
net.

---

## 8. Admin UI

### 8.1 New page: `/admin/deadlines`

One screen, three sections, top to bottom:

**Section 1 — תאריך תחילת המונדיאל**
- Single datetime input (Asia/Jerusalem display, stored UTC).
- Help text: "כל ההימורים ברמת הטורניר מחושבים יחסית לתאריך הזה."
- "שמירה" button at the section level.

**Section 2 — ברירות מחדל לפי סוג הימור**
- Six rows, one per `bet_type`.
- Each row: Hebrew label + a number input + suffix "דקות לפני".
- Help text per row explains the anchor in plain Hebrew.
- A preview chip on the right of each row showing what the lock time
  would be **right now** for an example anchor ("דוגמה: 18:00 → ננעל 17:55").

**Section 3 — דריסות לפי יום הימורים**
- Table of matchdays (one per existing row in `matchdays`).
- Columns: date / earliest-kickoff / current-override / "ערוך"
- Edit opens an inline number input + "נקה דריסה" link.
- "אין דריסה — נופל לברירת המחדל" placeholder for null rows.

### 8.2 Per-match override

Lives inside the existing match admin (if there isn't one, the place to
add it is the bet edit form on `src/app/[lang]/admin/bets/BetForm.tsx`).
Single optional datetime field. The form already renders match metadata
when a match-scope bet is being created/edited.

### 8.3 Wire into the admin home

Add a tile on `src/app/[lang]/admin/page.tsx`:
"מועדי סגירת הימורים" → `/admin/deadlines`.

### 8.4 Bet form integration

In `src/app/[lang]/admin/bets/BetForm.tsx`:
- The `lockAt` input gets a sibling "השתמש בברירת המחדל" checkbox.
- Checking it computes the resolver's answer for the current scope and
  writes it back to the input as the new value. Unchecking it allows
  manual editing.
- Below the input, a live preview line: "ננעל ב-17:55 (5 דקות לפני
  בעיטת הפתיחה של אנגליה-אירן)" so admin sees the *why*.

---

## 9. Player UI: live countdown

### 9.1 New component: `src/components/LocksInCountdown.tsx`

- Client component.
- Props: `lockAt: Date`.
- Renders nothing if `lockAt` is more than 24 hours away.
- Renders `נסגר בעוד H:MM:SS` (ticking every second) when between 60 s
  and 24 h.
- Renders `נסגר בעוד MM:SS` (red) when under 60 seconds.
- Renders `נעול` badge (gray, locked icon) when past.
- Updates via `setInterval(..., 1000)`, cleared on unmount.
- Respects user's reduced-motion preference: under reduced motion the
  ticking stops at minute granularity to avoid flashing seconds.

### 9.2 Where it gets used

- Bet cards on `/play/[date]/...` — score bet card, every custom bet
  card. Replaces the silent "your pick is locked" we have today.
- Tournament zone (`/tournament/...`) for stage / group / tournament
  bets — they currently show no lock indicator at all.
- Admin bet list at `/admin/bets` — the same component reused so admin
  sees what the player sees.

The countdown ALWAYS reads `lockAt` from the row, which the resolver
keeps in sync (custom bets) or which is derived server-side (score
bets pass the resolved time down via props). Client never re-resolves.

---

## 10. Observability (rule 14)

Every step that decides "is this bet open" emits a log. Concrete
shape, all `console.info`:

| Namespace | Where | Payload |
|-----------|-------|---------|
| `[deadline resolve]` | resolver, every call | `{ betId, type, anchor, source, offsetMinutes, effectiveLockAt }` |
| `[deadline auto-lock]` | sync pass, per row flipped | `{ betId, scope, oldStatus, lockAt, now }` |
| `[deadline auto-lock sweep]` | sync pass, per run | `{ candidates, flipped, durationMs }` |
| `[bet rejected lock]` | submit actions | `{ userId, betType, lockAt, now, skewSeconds }` |
| `[admin deadlines save]` | admin form action | `{ adminId, section, diff }` |
| `[admin deadlines tournament-start]` | tournament start save | `{ adminId, oldValue, newValue }` |
| `[admin deadlines matchday-override]` | matchday override save | `{ adminId, matchdayId, oldValue, newValue }` |

Logs match the project convention (bracketed namespaces, structured
values). The user can grep `[deadline ` and see the full flow for any
incident.

---

## 11. Security (rule 13)

- `/admin/deadlines` page guarded by the existing `isAdmin()` helper at
  the layout level — same gate as every other admin page.
- All save server actions re-check `isAdmin()` before any DB write.
  No "trust the client" path.
- New table `bet_lock_defaults` carries an RLS policy that mirrors
  `settings`:
  - `select`: any authenticated user (so the resolver can read it).
  - `insert` / `update` / `delete`: `profiles.role = 'admin'`.
- `bet_lock_defaults.offset_minutes >= 0` CHECK constraint blocks the
  fat-finger "lock 60 minutes AFTER kickoff" — bets locking after the
  event makes no sense in this product and the constraint enforces it.
- `matches.lock_at_override` is unconstrained at the DB level (a date
  is a date) but the admin form rejects times past `kickoffAt` with a
  visible error message.
- Settings audit (rule 15): every new control lives on `/admin/deadlines`
  with sensible Hebrew labels. The six type defaults, the tournament
  start, and the matchday override are all exposed there; nothing
  hardcoded; nothing silently configurable in a way only an engineer
  can find. Defaults preserve current behavior on upgrade.

---

## 12. Rollout / migration plan

1. **Drizzle migration** (`drizzle/000X_betting_deadlines.sql`):
   - Create `bet_lock_defaults` + RLS + seed.
   - Add `settings.tournament_start_at` with WC 2026 default.
   - Add `matchdays.lock_offset_override_minutes`.
   - Add `matches.lock_at_override`.
   - No data backfill needed — defaults preserve current behavior.
2. **Resolver + tests** ship before any UI does so submit actions can
   be flipped over with low risk.
3. **Submit actions** swapped over (one PR each so a rollback is easy).
4. **Background pass** added to `sync.ts` and wired into `runSync()`.
5. **Admin UI** ships next — until it's live, defaults stay at the
   seeded values and the system behaves like today.
6. **Player countdown** ships last — the resolver and DB are already
   correct; the countdown is pure cosmetic surface that can wait a
   day if needed.

Pre-tournament merge target: every piece above lives by **2026-06-04**
to leave a week of buffer before kickoff.

---

## 13. QA checklist (rule 6 — extreme QA)

**Golden path:**
- Admin sets `custom_tournament = 60 min`, `tournamentStartAt =
  2026-06-11 21:00 IDT`. Create a tournament-scope bet. Resolver
  returns `2026-06-11 20:00 IDT`. Countdown ticks. After 20:00, status
  flips to `locked` within 60 s. Pick submission rejected with `locked`.

**Edge paths:**
- Matchday override set to 0 minutes — bet locks exactly at first
  kickoff. Resolver still returns a valid Date (not NaN).
- Matchday override unset (null) — falls back to type default.
- Per-bet `lockAt` set explicitly — overrides matchday override.
- Per-match `lockAtOverride` set on a single match — overrides
  matchday for *that* match's score bet, others on the day unchanged.
- Tournament start in the past — resolver still returns a past date,
  auto-lock pass flips the bet, no exception.
- 200 custom bets in one sweep — sync pass completes in <1 s.
- Reduced motion — countdown updates per minute, not per second.
- Mobile 360 px — admin form usable, no horizontal scroll, all touch
  targets ≥44 px. Bet card countdown legible.
- Two browsers, same user, one bet — both clients see countdown
  finish; both see `נעול`; neither can submit. Server time, not
  client time, decides.
- Stage anchor with no matches yet scheduled — resolver returns the
  type default applied to `tournamentStartAt` as a sane fallback +
  logs a warning.

**Regression sweep:**
- Existing matchday bets keep their `lockAt`; behavior unchanged for
  bets created before the migration.
- Duels untouched — `joinDeadlineAt` flow still works.
- `betLockMinutes` removal doesn't break any settings page that joined
  it (we keep the column for one cycle to be safe).

**Tests added:**
- `src/lib/deadlines.test.ts` — pure-fn resolver, every branch.
- `src/lib/sync.test.ts` extension — auto-lock pass on a fixture set
  of 6 bets covering all six types.
- One Playwright happy-path test — admin sets a default, creates a
  bet, player sees the countdown, time passes (mocked clock), pick
  rejected.

---

## 14. Out of scope / future work

- **Per-stage / per-group override rows.** The matchday override
  covers the highest-frequency case (a single hectic day with multiple
  matches). Stage- and group-level overrides can land if the friends
  pool asks for them — schema is set up to add it without breaking
  changes.
- **Soft warnings before lock.** ("Your pick will be locked in 2 min,
  finalise?") Not in v1.
- **Push notification on lock.** Out of scope until the push backend
  is wired up elsewhere.
- **Per-user grace period.** Friends pool — uniform rules for
  everyone is the simpler and fairer model.

---

## 15. Alternatives considered (and rejected)

**A. Extend `bet_lock_minutes` into a single per-type column set on
`settings` (no new table).** Cleaner migration (no new table, no RLS
on new table), but bakes the bet-type list into the schema. Adding a
seventh bet type (e.g. live-bets in a future PR) would mean another
column. The dedicated table generalises.

**B. Materialise `lockAt` on every bet at creation, never resolve
live.** Admin changes a default → existing bets unaffected. Simpler
read path (`SELECT lockAt`). Rejected because the user explicitly
asked for "X לפני התחלת המונדיאל" — a relative rule that needs to
shift if the admin moves `tournamentStartAt`. With materialised
`lockAt`, the admin would have to remember to re-apply the rule per
bet. Live resolution is the user requirement.

**C. Status quo + a single admin number input for the global cutoff.**
Smallest change, smallest power. Rejected because the user asked for
*ממש הכל* — per matchday, per bet, per type. A single-knob ship would
miss the actual request and we'd be back here in a week.

---

## 16. Files this PR touches

**New:**
- `src/lib/deadlines.ts` — resolver + context loader
- `src/lib/deadlines.test.ts`
- `src/db/migrations/00XX_betting_deadlines.sql` — table + columns + RLS + seed
- `src/components/LocksInCountdown.tsx`
- `src/app/[lang]/admin/deadlines/page.tsx`
- `src/app/[lang]/admin/deadlines/DeadlinesForm.tsx`
- `src/app/[lang]/admin/deadlines/actions.ts`

**Modified:**
- `src/db/schema.ts` — new table + column adds
- `src/app/[lang]/bets/[matchId]/actions.ts` — submit gate via resolver
- `src/app/[lang]/play/[date]/actions.ts` — submit gate via resolver
- `src/lib/sync.ts` — add `lockExpiredCustomBets()` + register in `runSync()`
- `src/app/[lang]/admin/bets/BetForm.tsx` — "use defaults" checkbox + live preview
- `src/app/[lang]/admin/page.tsx` — tile linking to `/admin/deadlines`
- bet card components on `/play/[date]/...` and `/tournament/...` — drop the countdown pill in

No file in this list is touched blindly — each one already has the
shape we need and the change is a slot-in, not a rewrite.
