# Live-bet quality: distribution-first lives + real match-day aggregation

Date: 2026-06-23
Owner: (admin) info@flexelent.com
Scope decision: user picked **all three** tiers (prompt overhaul + goal-minute
distribution grader + substitution events).

## Problem (from the user, verbatim intent)

1. Live bets feel repetitive and too easy. The most engaging ones are the
   distribution bets with many options (which minute window a goal falls in,
   how many yellows / corners / offsides / shots), because the probability
   spreads and each option pays more. Push the LLM toward those, and broaden
   the idea pool tastefully (offsides, shots on target, first substitution,
   first card, winning margin, etc.).
2. Match-day bets are broken. When generating for a matchday the model
   proposes a bet **per fixture** instead of bets **aggregated across all of
   the day's matches** (total goals on the day, total yellows on the day,
   total reds, total corners, total offsides), which was the whole point.

## Root-cause findings (verified in code, not assumed)

- The day-aggregation **engine already exists and works end to end**:
  - `sync.ts:resolveDayScope` sums `total_goals` / `ht_total` across the day
    (`auto_football_data`).
  - `sync.ts:resolveDayScopeApiFootball` implements `sum_day` — it loops every
    fixture, sums any API-Football stat (corners, yellow_cards, red_cards,
    offsides, shots, ...), and maps the total to a range option via
    `range-grade.matchRangeOption`.
  So day-wide totals can **auto-grade** today.
- The day bug is the **prompt lying to the model**. `generate.ts:86` tells it
  day markets "have no single-match settlement feed, so set their grading to
  null (manual)" — factually wrong — and `generate.ts:96` says "the mix that
  fits this **specific game**" (singular). Combined, the model emits per-match
  manual bets. This is a prompt fix, not an engine build.
- The "too easy / repetitive" lives are also mostly prompt. The capabilities
  block leads with player props + yes/no and buries the count-distribution
  markets ("when the matchup ... supports them"). Yet count distributions
  (corners / yellow_cards / red_cards / offsides / shots / fouls / winning
  margin as `0-6 / 7-9 / 10+` multi_choice) **already auto-grade per match**
  via `range-grade` + `coerceApiFootballStat` / `coerceMatchField`.
- The single genuinely-missing capability is a **multi_choice "which window
  does the FIRST <event> fall in"** market. `events-grade.gradeEventBet`
  rejects `multi_choice` (events-grade.ts:75). This is the juiciest bet the
  user named (first-goal minute window) and needs new grader code.
- Substitutions are **already fetched**: `/fixtures/events` returns
  `type:"subst"` and `parseEventsResponse` keeps every event type
  (api-football.ts:182, 231-240). So "first substitution window" / "sub before
  minute X" only need a new `substitution` metric in the grader — no new
  ingestion, no extra API cost. (The earlier assumption that subs aren't
  fetched was wrong.)

## Chosen approach

### Part A — Prompt overhaul (`src/lib/bets/suggest/generate.ts`)
Make `buildSystemPrompt(scope)` genuinely scope-aware.

- **Match scope:** reorder capabilities to lead with grouped multi_choice
  **count-distribution** markets (corners / yellow_cards / red_cards /
  offsides / shots_on_goal / fouls / winning_margin), each as 3-5 mutually
  exclusive range options that MUST set grading to the matching auto source so
  they self-grade. Keep player props and yes/no events as supporting variety,
  not the lead. Explicitly call out: distribution = more options = each pays
  more = more interesting; avoid flat 50/50 yes/no that feels obvious.
  Introduce the new first-event-window market (goal / card / substitution) as
  an option, gated to the new grading branch.
- **Day scope:** replace the "set grading to null (manual)" lie. Tell the
  model day markets MUST aggregate across all fixtures and MUST self-grade:
  total goals → `auto_football_data total_goals` (or `ht_total`); total
  yellows/reds/corners/offsides/shots → `auto_api_football` stat with
  `aggregate:"sum_day"`. Give worked day examples. Forbid per-fixture markets
  at day scope (those belong at match scope). De-emphasize player props at day
  scope (a single player can't be aggregated cleanly).
- Tighten `buildUserPrompt` day wording ("across ALL of today's matches
  combined, not one fixture").

### Part B — First-event-window grader (the juicy distribution bet)
New pure function in `src/lib/bets/events-grade.ts`:
`gradeFirstEventWindow(events, spec, options, ctx)` →
- `spec`: `{ metric, team?, playerApiId? }` (no op/value/window).
- Find the earliest matching event (sort by `minute`, then `extra`).
- If found: `matchRangeOption(options, minute)` → the window option whose
  range token (`1-15`, `16-30`, ... using clock minute so 45+2 stays in
  `31-45`) contains it. Reuses the existing, tested range machinery.
- If no matching event: resolve to the single option that does NOT parse as a
  numeric range (the "no goal" / `none` bucket). Exactly one such option, else
  skip.
- Fail closed: ambiguous / zero matches → `null` → caller `skip` → manual.

Schema (`schema.ts`): add a 5th `grading` oneOf branch
`{ source:"auto_api_football", firstEventWindow:{ metric, team?, playerApiId?, byAssist? } }`
with `metric ∈ goal | yellow_card | card | red_card | penalty | substitution`.
`sync.ts`: in the candidate `gradingConfig` type add
`firstEventWindow?: FirstEventWindowSpec`; add a match-scope branch that, for
`answerType === "multi_choice"` with a `firstEventWindow` config, fetches the
events and calls `gradeFirstEventWindow`. Untouched yes_no/number path stays.

### Part C — Substitution metric
- `events-grade.ts`: add `"substitution"` to `EventMetric`; in `matchesMetric`
  match `e.type.toLowerCase() === "subst"`. This unlocks both yes/no
  ("substitution in the first half?", "sub before minute 60?") via the
  existing `gradeEventBet`, and the multi_choice first-sub window via Part B.
- `schema.ts`: add `substitution` to the events `metric` enum (both the
  existing events branch and the new firstEventWindow branch).
- Prompt: mention substitution markets as another distribution/yes-no idea.

## Rejected alternatives

- **Build a bespoke per-bet day aggregator UI / new DB columns for day
  totals.** Rejected: the `sum_day` engine already does this; only the prompt
  blocks it. No schema/DB change needed.
- **Persist event timelines to grade multi_choice windows.** Rejected: the
  events feed is fetched on demand at settle time (match is final); no need to
  persist. The new grader is pure and slots into the existing on-demand fetch.
- **Add a new `substitutions` API-Football stat fetch.** Rejected: subs are
  already in the `/fixtures/events` feed we fetch; a stats fetch would be
  redundant and cost extra calls.
- **Overload the existing `events` spec with a `firstWindow` flag.** Rejected
  in favor of a distinct `firstEventWindow` grading branch: keeps
  `additionalProperties:false` honest and the yes/no path untouched.

## Security
- Admin free-text steer stays fenced (untrusted, cannot bypass schema) —
  unchanged.
- New grading branch is shape-validated by the tool JSON Schema
  (`additionalProperties:false`) and by `validateSuggestion`. Player ids still
  pass through `demotePlayerIdIfInvalid` (hallucinated id → manual).
- Grader fails closed everywhere: no match / ambiguous options / malformed
  spec → `skip` → manual queue. Bets are never mis-credited. Substitution
  metric uses exact `type` match to avoid mis-grading other event types.
- No new external input, no secrets, no PII, no new network surface beyond the
  already-used `/fixtures/events` endpoint.

## Observability
- `[live-grade first-window]` log on resolve/skip with betId, metric, the
  chosen minute (or "none"), and the matched option value.
- Reuse existing `[grading skipped]` warn for unsupported combos.
- Existing `[live-gen ok]` generation log already records scope + counts.

## Testing (run the suite, not just the new test)
- `events-grade.test.ts`: new `gradeFirstEventWindow` cases — first goal in
  each window, stoppage 45+2 → `31-45`, no goal → `none` bucket, tie/sort
  order (earliest wins), team filter, player filter, ambiguous options →
  skip, substitution metric (yes/no + first-window).
- `range-grade` already covers token parsing; reused as-is.
- `schema` / `transform`: a `firstEventWindow` suggestion validates; a
  malformed one is dropped.
- Manual QA: generate a match batch (expect distribution-led variety) and a
  day batch (expect aggregated, auto-grading day totals, zero per-fixture
  markets), at 360px admin view.

## Settings audit (rule 15)
- No new persistent setting. Distribution-first + day-aggregation become the
  default behavior; admins already have the free-text steer for ad-hoc bias
  and model selection / autogen lead-hours in the existing Ai model card.
  Intentionally not adding a "distribution intensity" knob — one obvious
  default beats a clever dial, and the steer box covers exceptions.

## Open questions
- Goal-minute windows: 6×15-min buckets + "no goal" = 7 options (schema max
  8). Going with 15-min buckets per the user's "רבע שעה" wording.

## Addendum (2026-06-23) — comebacks + manual-override, delivered

Two requirements landed after the plan above was written:

### Comebacks (lead-then-lose), a 4th auto-grade shape
User asked for "will a team lead and the opponent turn it around" markets.
Not covered by any existing source, but auto-gradable from goal events.
- `events-grade.gradeComeback(events, spec, finalHome, finalAway, ctx)`:
  reconstructs the running score from goal events in minute order (own goals
  credited to the OTHER side), and reports whether the full-time WINNER was
  ever strictly behind. `team` narrows to one side ("will HOME come back").
  Fails closed: a drawn FT (incl. decided on penalties) is never a comeback;
  if the reconstructed final does not equal the real final (incomplete feed
  or stray shootout goals) it returns "skip" → manual.
- New grading shape `{ source:"auto_api_football", comeback:{ team? } }`:
  schema branch, `AutoApiFootballComebackConfig` in types, `validateComebackSpec`
  in createCustomBet, `resolveMatchScopeComeback` in sync (fetches final score
  + events). yes_no + match scope only. Prompt documents it as a high-drama
  market. Tests cover comeback / attribution / wire-to-wire / pegged-level /
  draw / own-goal / feed-completeness / missing-ctx.

### Manual override wins, always (verified — no code needed)
User: "everything must also have a manual option, and a manual change beats
everything and can't be overridden."
- Verified the invariant already holds structurally: `gradeCustomBet` flips a
  bet to status `graded`, and the auto-grader's candidate query only selects
  `status in ('open','locked')`. A manually graded bet is therefore
  unreachable by the auto-grader — it can never be overwritten. Every bet
  (any answer type / any source) is manually gradable via `gradeCustomBet`,
  and the fail-closed "skip → manual" behavior means anything the auto-grader
  can't resolve waits for the admin. My new resolvers run inside the same
  gated path, so they inherit the guarantee. No change required.

### BetForm edit guard (no silent grading corruption)
`BetForm` only has editors for the `stat` and `events` auto_api_football
shapes. Editing an AI draft that carries the new `firstEventWindow` / `comeback`
shape would have re-run `buildGradingConfig` and silently rewritten the
grading to a `corners` stats config. The review→publish golden path is safe
(`publishCustomBet` flips draft→open without touching `gradingConfig`), but the
"edit the wording then save" path was not. Fix: `BetForm` now detects an
unrepresentable auto config, preserves it verbatim on save, and shows a
read-only notice with a "replace with a different rule" escape hatch instead of
a misleading stats editor.

### Status: all delivered. tsc clean, eslint clean, full suite 720/720 green.
