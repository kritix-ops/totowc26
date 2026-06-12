# Live-bet overhaul: per-choice odds + LLM suggestion engine + auto-settlement

Date: 2026-06-12
Owner: Yoav
Status: approved scope, phased build

## Goal

Fix the live-betting experience after the WC opener exposed three problems:

1. **Flat odds.** Every choice paid the same multiplier. People got 5x on
   "no VAR decision in the first half" — an event that should pay almost
   nothing. Root cause: exotic markets (VAR, red-in-half, penalty, first
   goal window) have no bookmaker source, so they were published as
   `yes_no` bets that store a single bet-level `decimalOdds` (both sides
   pay the same) or with a hand-typed flat payout.

2. **Ungrouped outcomes.** Related outcomes were published as separate
   yes/no bets instead of one market with mutually-exclusive options
   (the "when will the first goal come / VAR in 1H, 2H, or none" idea).

3. **Manual, low-quality suggestions.** There is no in-app LLM generator.
   Suggestions today come from The Odds API (4 standard markets only) or
   from copy-pasting an external chat. The user wants in-format, complete,
   logical LLM suggestions, generated automatically, that he approves.

## Decisions locked with the user (2026-06-12)

- **Odds source for exotics:** LLM proposes per-choice probabilities; admin
  approves or tweaks before publish.
- **Automation level:** Automatic generation into an **approval queue**.
  Nothing publishes without the admin's tap. (Aligns with "user bets are
  sacred" and the friends-pool stakes.)
- **Scope:** Everything, built in phases.
- **Event settlement:** Auto-settle everything possible from API-Football,
  with a fast, easy manual-override path for anything the API can't resolve
  (VAR especially).

## Hard constraints (verified in code, not assumed)

- `src/lib/odds-normalize.ts` already has the pricing math
  (`normalizeOdds`, house edge, cap, floor). We reuse it — no new pricing
  path that can drift.
- `src/lib/bets/types.ts` already supports per-choice odds:
  `MultiChoiceConfig.decimalOddsByValue` / `payoutOverridesByValue`
  (lines 100-108) and `YesNoConfig.payoutOverrideYes/No` (lines 23-24).
  The gap is the publish UI not filling them + no generator.
- `GradingConfig` (types.ts:189) only knows `auto_api_football` (per-team
  stat totals) and `auto_football_data` (match-level). **No event/minute
  bucket exists** — so "red card in the first half" / "VAR" are NOT
  auto-gradable today. `fetchFixtureStats` only hits
  `/fixtures/statistics`; we never pull `/fixtures/events`.
- VAR is unreliable in the feed. The opener (fixture 1489369) returned
  zero `Var` events even though checks happened. Auto-settlement must
  degrade to manual, never guess.

## Pricing model (the keystone)

Ask the LLM for a **probability per option**, never for odds directly.
Probabilities for a mutually-exclusive market must sum to ~1. In code we:

1. Validate + renormalize the probability vector to sum to 1.
2. Clamp each p to a sane band (e.g. 0.02..0.98) so 1/p can't explode.
3. Fair decimal odds = 1 / p.
4. Feed fair odds through the existing `normalizeOdds(config)` → per-option
   `{ decimalOdds, stake, payout }`.
5. Store `decimalOddsByValue[value]` so the variable-stake submit path in
   `write-core.ts` recomputes the payout against the player's chosen stake.

Why probabilities, not odds: a likely event (p=0.8 → odds 1.25) yields a
tiny payout automatically, which is exactly the fix for the "5x on a
near-certain outcome" bug. yes/no is just the 2-option case feeding
`payoutOverrideYes/No`.

## Phases

### Phase 1 — Per-choice odds + grouping (no LLM, ship first)
- New pure module `src/lib/bets/price-options.ts`:
  `priceOptionsFromProbabilities()` — renormalize, clamp, invert, call
  `normalizeOdds`. Full unit tests (sum-to-1, clamp bounds, flat-bug
  regression: a 0.8-prob option must NOT pay 5x).
- Publish UI: capture per-option odds for yes/no (`payoutOverrideYes/No`)
  and ensure multi-choice writes `decimalOddsByValue`.
- Admin "compose grouped exotic bet" surface: enter a question + N
  mutually-exclusive options + a probability each; preview the resulting
  payouts live; publish as one `multi_choice` bet.
- CustomBetCard already reads per-option odds — verify it renders distinct
  payouts per choice at 360/414/768px.

### Phase 2 — LLM suggestion engine (in our format)
- `src/lib/bets/suggest/` — a generator that takes a fixture (+ teams,
  stage, recent form, available auto-grade metrics) and returns a typed
  array of complete bets: question (he/en), answerType, options (he/en),
  probability per option, grading rule (he/en), and the machine-readable
  auto-grade spec. Strict schema validation server-side; the LLM output is
  untrusted and can never bypass odds clamps or publish without approval.
- Approval queue UI: generated bets land in a review list; admin
  approves / edits / rejects; approve = publish via the Phase 1 path.
- Model: Claude Sonnet 4.6 default (best value for structured Hebrew +
  probability estimation). Cost is pennies (see below). Provider is not
  locked — GPT-5 / Gemini Flash are cheaper and viable; not worth a second
  SDK for the savings at this volume.

### Phase 3 — Auto-settlement from events + rules engine
- `fetchFixtureEvents(fixtureId)` in api-football.ts; store events.
- New grading source `auto_api_football_events` with minute-window buckets
  (`window: '1H' | '2H' | 'FT'`, metric: red_card / yellow_card / goal /
  penalty / var, op, value). Settlement evaluates the spec; if data is
  missing or VAR absent, route to the manual queue with a clear reason.
- Fast manual-override UI on every live bet (one-tap resolve).
- Admin rules: "N minutes before each kickoff, generate these market types
  into the queue." Cron fills the queue; admin still approves.

## Security (rule 13)
- LLM output validated against a strict schema before it can be queued;
  probabilities renormalized + clamped; odds always re-derived in code,
  never trusted from the model.
- Settlement is insert / owner-explicit-update only — never silently
  mutates a placed pick (user bets are sacred).
- Approval gate: nothing reaches users without an admin tap.

## Observability (rule 14)
- `[live-gen]` (generation), `[live-price]` (probability→odds),
  `[live-settle]` (settlement + why a bet went manual), `[live-events]`
  (events fetch). Log actual values: probabilities, derived odds, the
  metric read, the bucket, the decision.

## Testing (rule 18)
- Unit: probability renormalization, clamp bounds, 1/p inversion, the
  flat-5x regression, event bucketing by half, settlement spec evaluation,
  yes/no override pricing.
- Run the affected suites green before each phase is called done.

## Settings (rule 15)
- Exotic-bet house edge, min/max payout, probability clamp band, default
  model, bets-per-match cap, generation lead time, enabled market types,
  auto-publish flag (default OFF — queue only).

## Cost (rule 8, verified models.dev 2026-06-12)
- Sonnet 4.5/4.6 ≈ $3 in / $15 out per M tokens. One match generation ≈
  4k in + 3k out ≈ $0.057. ~104 WC matches × ~2-3 regenerations ≈ ~$17
  for the entire tournament. Haiku ≈ $6. Negligible for a friends pool.

## Alternatives rejected
- **Bookmaker odds for exotics:** no source prices "VAR in 1H" for a
  national-team match. Dead end.
- **Fully automatic publishing:** rejected by the user — an LLM
  probability error would reach real points before he can catch it.
- **Statistical base-rate model:** accurate for common events but we have
  no historical event dataset built; far more work than LLM + approval.

## Open questions
- Exact storage for events (new `match_events` table vs jsonb on matches) —
  decide at Phase 3 start.
- Whether grouped exotic markets need a dedicated answerType or fit
  `multi_choice` as-is (current read: multi_choice fits).
