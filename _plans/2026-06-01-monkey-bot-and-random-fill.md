# Monkey bot + "Surprise me" random fill

Date: 2026-06-01
Status: approved (approach + key decisions confirmed with owner)

## Goals

1. A **"monkey" bot** competitor that auto-fills an odds-weighted random pick
   for every fillable open bet, all tournament long, so human players have a
   baseline to beat ("can you beat the monkey?").
2. A per-user **"Surprise me"** bulk button on each bet surface that fills the
   player's own open, *unfilled* bets with random picks in one tap, never
   overwriting picks they already made.

Both share one core: a pure pick generator + a single gated write path.

## Constraints

- Vercel **Hobby tier**: cron expressions more frequent than once-daily are
  rejected at deploy time, and three daily crons already exist
  (`sync`, `backup`, `odds-sync` in `vercel.json`). The monkey's recurring
  fill therefore runs on **GitHub Actions**, mirroring the existing
  `.github/workflows/news-cron.yml` (hits an endpoint with the shared
  `CRON_SECRET` Bearer header).
- Mobile-first, Hebrew-default RTL. The button and any monkey UI follow the
  project responsive rules (44px targets, full-width on mobile, `dvh`, etc.).
- No new paid services. GitHub Actions usage is free at this volume; the odds
  data is already ingested. Nothing to price.
- This is a live, money-adjacent (virtual points) app. Changes must not open a
  privilege-escalation or overspend path, and must be idempotent.

## Requirements / decisions (confirmed with owner)

- **Monkey pick intelligence**: odds-weighted, falling back to uniform where no
  odds exist.
- **Monkey fill timing**: scheduled, before lock, via GitHub Actions cron
  (workaround for Hobby tier).
- **"Surprise me" scope**: bulk — one button per surface fills all open,
  unfilled bets at once. Confirm before submitting; picks stay editable after.
- **Overwrite**: never. Random only fills empty bets.
- **Bet coverage**: fill match scores, multi_choice, outright; fill `number`
  **only when it has real min/max bounds**; **skip `free_text` entirely** and
  skip unbounded `number`. (free_text has no option set and grades on exact
  text; unbounded number grades on exact integer — both are dishonest noise for
  a benchmark. This means the monkey does NOT literally touch 100% of bets, by
  design.)
- **Monkey in standings**: shown as a **separate "beat-the-monkey" benchmark
  line**, visually marked as a bot (🐒), not ranked inline among humans.
- **Sequencing**: ship "Surprise me" first (no bot, no migration, no cron),
  add the monkey second.
- **Duels**: the monkey does NOT open or join duels, and "Surprise me" does NOT
  touch duels. A bot in a 1v1 distorts a specific human's head-to-head and
  consumes real bank. Out of scope.

## Chosen approach

Built in the council-recommended order. Each phase is independently shippable.

### Phase 0 — Verify (no code)
- Confirm how dynamic-source player picks (`options: []`, values in
  `payoutOverridesByValue`) are validated/submitted today. `validateAnswer`
  appears to reject them. If broken, raise as a separate pre-existing bug; the
  generator must not depend on undefined behaviour.
- Confirm players cannot see other players' (or the monkey's) picks before a
  bet locks (info-leak / copy integrity). If they can, the monkey reveal must
  be gated until lock.

### Phase 1 — Foundation (no user-visible change)
- `listOpenUnfilledBetsForUser(userId, { surface })` query — the spine of both
  features. Returns open, not-yet-locked bets (match + custom, by surface) that
  the user has no pick on. One query, tested against real data.
- `src/lib/random-picks.ts` — **pure** generator, zero IO, zero auth:
  - `multi_choice` (incl. outright/dynamic): weighted by per-option payout.
    Implied weight ∝ 1/payout, **normalized per-bet** (payouts bake in the
    house margin, so raw 1/payout sums to >1 and is not a probability). For
    dynamic-source bets, the option universe + weights come from
    `payoutOverridesByValue` keys.
  - match score: if H2H odds exist in `liveOddsSnapshot`, weight outcome by
    them then pick a plausible scoreline; else uniform plausible 0–3. (Kept
    simple — H2H-exact-scoreline modelling is over-engineering for a monkey.)
  - `yes_no`: 50/50.
  - `number`: uniform within `[min, max]` when both bounds exist; otherwise
    return null (skip).
  - `free_text`: always null (skip).
  - Returns a valid `PickAnswer` or `null` (skip this bet).
  - Unit-tested with vitest (project already has it; see
    `src/lib/*.test.ts`).

### Phase 2 — Gated write-core
- Extract the DB write out of `saveBet` and `submitCustomBetPick` into a shared
  inner core, keeping the per-user advisory-lock transaction intact.
- The core takes an explicit **principal**, never a bare userId:
  - `{ kind: 'self', userId, access }` — requires a fetched `getUserAccess`
    result; enforces access (`canEdit`), bank, deadline, status.
  - `{ kind: 'bot', userId }` — skips access + bank (the bot has its own
    starting bank and no payment), still enforces deadline + status +
    never-overwrite.
  There is no code path that writes a pick from a raw userId, so a future
  caller cannot accidentally bypass gating.
- **Bet-integrity invariants enforced unconditionally inside the locked txn**:
  status `open`, `effectiveLockAt > now`, no existing pick. This defends the
  read-then-settle race (cron reads "open", stage locks, write must not land).
- **Idempotency at the DB layer**: never-overwrite uses
  `onConflictDoNothing` on the existing unique indexes
  (`match_bets (userId, matchId)`, `user_custom_bet_picks (userId, customBetId)`).
  Combined with the advisory lock, overlapping cron runs / double-taps are
  no-ops, not duplicates.
- The existing single-pick actions are refactored to call the core with a
  `self` principal (behaviour unchanged, regression-tested).

### Phase 3 — "Surprise me" (SHIP)
- Server action `fillRandomPicks(surface)`: enumerates the caller's open
  unfilled bets for that surface, generates picks, writes each through the
  `self` principal core (so every existing gate — access, bank, deadline,
  status — still applies; bets it can't afford or that are locked are skipped),
  returns a summary `{ filled, skipped }`.
- For custom bets, fill the whole surface inside **one advisory lock per user**
  (not N serializable transactions) to avoid conflict-retry thrash.
- UI: one "🎲 הפתע אותי / Surprise me" button per surface (`/bets`,
  `/bets/live/[date]`, `/bets/tournament`, `/bets/groups`). Copy states it
  fills only empty bets. Confirm step before submit. After fill, show
  "filled N, skipped M" and leave every pick editable (that is the undo).
  Responsive per project rules.

### Phase 4 — Monkey
- Migration `0037`: add `profiles.is_bot boolean not null default false`.
- One-time bootstrap script (`scripts/`) creates the monkey's Supabase auth
  user via the admin API (like `invitePlayer`), sets `is_bot = true`,
  `display_name` = monkey, role `player`. (profiles.id is a hard FK to
  auth.users, so a real auth user is required; admin API is cleaner and safer
  than hand-inserting into auth.users in a migration.)
- Exclude `is_bot` from: emails/push fan-out, payment/paid-status queries,
  pending-signup and admin user-management surfaces where a bot would be noise.
- Cron endpoint `/api/cron/monkey` (GET+POST, `isAuthorizedCron` header-only):
  resolves the monkey profile, enumerates all open unfilled bets across scopes,
  generates odds-weighted picks, writes through the `bot` principal core
  (idempotent). Bounded `maxDuration`.
- GitHub Actions workflow `monkey-cron.yml` (~hourly), mirroring `news-cron.yml`
  (validates `APP_URL` + `CRON_SECRET`, curls the endpoint, no body to logs).
- Standings: render the monkey as a separate, clearly-bot-marked benchmark
  line (🐒), not inline among humans. Verify monkey picks are not revealed to
  humans before lock.

## Alternatives considered and rejected

- **Vercel cron for the monkey** — rejected: Hobby tier rejects sub-daily
  schedules and three daily crons already exist. GitHub Actions is the existing,
  free workaround.
- **Bare-userId write helper with an `auth: false` flag** — rejected as a
  footgun: any future caller could write as anyone. Replaced with a typed
  principal so gating cannot be skipped accidentally.
- **Raw 1/payout weighting** — rejected: ignores the house margin baked into
  payouts (weights sum to >1, overweights longshots). Normalized per-bet
  instead.
- **App-logic "is it already filled?" check only** — rejected: read-then-write
  race double-fills under concurrent cron runs. Pushed to the DB
  (`onConflictDoNothing` + advisory lock).
- **Monkey opens/joins duels** — rejected: distorts a specific human's 1v1 and
  consumes real bank.
- **Filling free_text / unbounded number** — rejected: unwinnable noise that
  makes the benchmark dishonest.
- **Persona roster, pool-consensus odds, cron-as-heartbeat** (Expansionist
  upside) — deferred: good future direction, but scaling bots on an unproven
  write path multiplies bugs. Note for later, do not build now.
- **One big combined drop** — rejected in favour of phased delivery so each
  piece is reviewable and the user-facing win lands first.

## Security & safety (rule 13)

- **No bypass primitive**: the only way to write a pick is through the typed
  principal; `self` requires a real access result, `bot` is constructible only
  server-side and is used solely by the CRON_SECRET-gated endpoint.
- **Authn on the bot fill**: `/api/cron/monkey` uses the same header-only
  `isAuthorizedCron` as every other cron route. No `?secret=` query param.
- **No overspend**: the `self` path keeps the in-txn bank check; "Surprise me"
  cannot push a user negative — unaffordable bets are skipped.
- **No deadline bypass**: deadline/status checked inside the locked txn, so a
  pick can never land on a locked/settled bet regardless of when enumeration
  ran.
- **Idempotent**: DB unique indexes + advisory lock; retries and double-taps
  are no-ops.
- **Least surprise / no PII leak**: the bot has no real email; excluded from
  notification fan-out. Monkey picks not revealed pre-lock.
- **Auditability**: automated writes log the same `[match-bet save]` /
  `[custom-bet stake]` lines; consider a `source` marker for bot writes if it
  aids debugging.

## Open questions / to confirm during build

1. Dynamic-source pick validation/submit — RESOLVED (Phase 0): it was BROKEN.
   `validateAnswer` checked the empty inline `options` array, so every
   top-scorer / golden-ball player pick was rejected as `invalid_answer`. Fixed
   in Phase 1 by validating dynamic-source values against
   `payoutOverridesByValue` (the priced roster). Affected real users, not just
   this feature.
2. Are picks hidden from other users pre-lock? — RESOLVED (Phase 0): YES.
   Every player-facing query is scoped to `pk.user_id = current user`; no
   surface leaks another user's pick before lock/grade. The monkey cannot be
   copied.
3. Monkey's starting bank: it inherits `settings.starting_bank` like everyone;
   confirm the leaderboard "overall" math treats it sanely as a benchmark.
   (Phase 4.)
4. Surfaces that get the "Surprise me" button — CONFIRMED: /bets (match picks),
   /bets/live/[date], /bets/tournament, /bets/groups. Duels excluded by design.

## Build status

- Phase 1 — DONE. `src/lib/random-picks.ts` (+14 vitest cases),
  `src/lib/bets/fillable.ts` enumeration, dynamic-source validator bug fix
  (now shared in `src/lib/bets/validate-answer.ts`).
- Phase 2 — DONE. `src/lib/bets/write-core.ts` (typed principal, in-txn
  invariants, DB-level idempotency). `saveBet` and `submitCustomBetPick`
  refactored to delegate. Typecheck + 102 unit tests green.
- Phase 3 — DONE (code). `src/app/[lang]/bets/random-actions.ts` +
  `src/components/SurpriseMeButton.tsx`, wired into all four surfaces.
  Typecheck + lint clean. Needs manual in-app verification (run the app,
  tap on each surface, confirm only-empty + editable-after + mobile layout).
- Phase 4 — DONE + SHIPPED. Migration `0038_monkey_bot` adds `profiles.is_bot`
  (auto-applied by the `prebuild` hook on every Vercel build). The leaderboard
  renders a separate "🐒 The Monkey" benchmark line (`getMonkeyBenchmark`) and
  excludes bots from the ranked list; bots are also excluded from broadcast
  recipients and the admin player listing/counts.

### Cron mechanism (final, differs from the original design)

The original plan used a dedicated hourly GitHub Actions workflow
(`.github/workflows/monkey-cron.yml`). That could not be used in practice:
the available git tokens lack the `workflow` OAuth scope (so the file can't be
pushed), and a GitHub Actions cron targets the fixed production `APP_URL`, not
a sandbox preview. Instead:

- `/api/cron/monkey` still exists for manual triggering (CRON_SECRET).
- The recurring fill rides the EXISTING `/api/cron/news` route (the news cron
  already fires every 30 min via `.github/workflows/news-cron.yml`). The news
  route calls `fillMonkeyPicks()` best-effort, fully isolated from the news
  sync. No new workflow file, no new secret.
- `fillMonkeyPicks()` SELF-PROVISIONS the bot on first run via the deploy's
  service-role env (`getSupabaseAdmin()` + `NEXT_PUBLIC_SUPABASE_URL`), so no
  manual bootstrap step is needed in production. `scripts/bootstrap-monkey.mjs`
  remains for local/manual creation but is not required.
- The standalone `.github/workflows/monkey-cron.yml` is kept on disk (untracked)
  as documentation only; add it via the GitHub web UI if a dedicated schedule
  is ever wanted.

### Activation (fully automatic on deploy)

1. Vercel build runs `prebuild` → `db:migrate` (adds `profiles.is_bot`).
2. The 30-min news cron hits production `/api/cron/news`, which self-provisions
   the monkey and fills its picks. Shared DB → it shows on every frontend.
3. Optional override: set `MONKEY_EMAIL` in Vercel env if Supabase rejects the
   default `monkey@toto.local` address.
