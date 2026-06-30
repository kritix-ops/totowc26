# Data-driven odds for new live bets (calibrated category prior)

Date: 2026-06-30
Owner: Yoav
Status: approved direction, phased build (pending final review of this doc)

## Origin

A WhatsApp thread with the pool admins (Mtan, Or) on 2026-06-30: players
keep "falling on offsides", drift to safe picks (4/5 → 2/3), and the team
wants odds that "look at the averages so far". Yoav's decision: make new
live-bet odds **as data-driven as possible, blended with everything we
already do** (LLM probability + manual control), to reach the best balance.
Scope is **new live bets only, at creation time** — already-opened bets are
never touched. The suggestion must be available inside the flow where the
admin opens new live bets.

## What the data actually says (verified live, not assumed)

Counts from production on 2026-06-30 (`_scripts/_count-live-*.mjs`,
`_ev-by-category.mjs`, `_calib-recoverable.mjs`, `_calibration.mjs`):

- **358 graded live bets, 4,987 picks.** 185 yes_no, 173 multi_choice.
- **All 358 have `resolved_value`**; per-option odds are stored in
  `answer_config.decimalOddsYes/No` (185) and `.decimalOddsByValue` (173).
  So the realized outcome and the priced odds are both recoverable for
  every historical bet. (Top-level `decimal_odds` is set on only 7 — it is
  NOT the source; per-option odds in `answer_config` are.)
- **Realized EV per category (net points / staked):**
  - offside **−34.5%** (250 picks) — genuine money-loser, the team is right.
  - corner −8.5% (228), BTTS +1.0% (640), penalty +8.9% (85),
    yellow +11.5% (140), goals +12.8% (1,984), red card +69.4% (103).
  - **All live bets together: +19.0%** (returned 37,935 on 31,866 staked).

Two facts this establishes, both load-bearing:

1. **"We keep losing" is false in aggregate.** Players net **+19%** on live
   bets. The felt loss is short-horizon variance, not a systemic edge
   against them. So the goal is NOT "make players win more".
2. **Offside is a real, quantified mispricing** (−34.5% over 250 picks),
   not a hunch. A handful of categories (offside, mildly corners) are off;
   most are fine or generous.

## What we are NOT building, and why (council verdict)

The first instinct — an automatic controller that re-prices odds from
historical hit-rate — was pressure-tested by a 3-lens adversarial review
(Contrarian / First-Principles / Executor). It was rejected on four
independent grounds, each confirmed by the data above:

- **Wrong signal.** User `was_correct` hit-rate confounds the true event
  rate with which side players bet. Pricing off hit-rate shifts odds toward
  the crowd's losing side — backwards. The correct signal is the
  **behaviour-independent realized outcome frequency** per category (and EV
  as the human-facing diagnostic).
- **Wrong goal for a points pool.** Perfectly calibrated odds (`odds=1/p`)
  drive every pick's EV to zero, which deletes the skill signal and makes
  the flight to safe picks *worse* (no EV reason left to take risk, only
  downside variance). We deliberately keep odds *generous and legible*, not
  mathematically fair.
- **Flight to safe picks is a scoring problem, not a pricing one.** Re-pricing
  will not change it. Logged here as a separate, optional track (boldness
  bonus / odds floor) — out of scope for this plan.
- **No silent auto-pricing.** Small samples (red card n=7, VAR n=4, penalty
  n=5), mid-tournament non-stationarity (group → knockout), and a feedback
  loop (price moves players, players are the only thing measured) make any
  auto-publishing controller unsafe. Every number stays a **suggestion the
  admin can override** — consistent with the project invariant
  "manual override always wins".

## Chosen approach: a calibrated category prior, surfaced as a suggestion

For a **new** live bet, blend three things we already trust into a single
suggested probability per outcome, then run it through the **existing**
pricing pipeline (`priceOptionsFromProbabilities` → `normalizeOdds`). No new
pricing curve, so the new path can never drift from the current one.

```
p_suggested(option) = w · p_llm(option) + (1 − w) · p_history(category, option)
w = k / (k + n_category)        # shrinkage: thin history barely moves the LLM
odds = existing pipeline(p_suggested)   # 1/p, rounding, edge, cap — unchanged
```

- **`p_llm`** — the LLM's per-option probability (context: this match, these
  teams). Already produced today by the suggestions engine.
- **`p_history`** — the **realized outcome frequency for the category**,
  computed from graded history (behaviour-independent: counts how often each
  resolved option actually occurred, not how users bet). For yes_no this is
  the event base rate; for multi_choice it is the resolved-option
  distribution.
- **`w` (shrinkage)** — `k/(k+n)` with `k` a configurable strength
  (default 50). Goals (n≈142) pull meaningfully toward history; red card
  (n=7) stays almost all-LLM. Below a **min-sample gate** (default n≥20) the
  category contributes **zero** weight and the suggestion is pure LLM — the
  thin categories where one bad bet would swing the prior simply do not get a
  vote.
- The admin always sees the blend AND can **override with a manual ratio**
  (existing ratio mode). Nothing publishes without the admin's tap.

### Why realized-frequency, not EV, drives the number

EV per category (offside −34.5%) is the right **diagnostic** to show a human,
but a blunt **pricing input**: it mixes the pricing error with which side
players chose. Realized outcome frequency is behaviour-independent and is the
honest estimate of the event's probability. So: EV is what we *show* the
admin as the headline ("offside bets returned −34% over 250 picks → consider
higher odds"); realized frequency is what *feeds the math*.

### Where it surfaces (the two creation paths)

1. **AI suggestions flow** (`/admin/live-bets/suggestions`, generated via
   `src/lib/bets/suggest/generate.ts`): the LLM also returns a **category**;
   the engine applies the blend before showing the suggested odds. The
   per-outcome card shows the blended ×N plus a one-line "why".
2. **Manual create form** (`BetForm.tsx`, `/admin/bets/new`): a **category
   dropdown** (closed list, keyword-guessed default). When a category clears
   the gate, a read-only reference line appears next to the odds field:
   *"offside: −34% EV / hit 24% over 250 picks · suggested ×N"*. The admin
   accepts the pre-fill or overrides.

The breakdown (LLM vs history vs blended) is collapsed behind a "why?" tap so
the match-day admin sees **one** number by default, not three.

## Category taxonomy

Fixed, closed list for the rest of the tournament (no free-text taxonomy to
rot under match-day pressure). Set locked with Yoav (2026-06-30): `offside`,
`yellow`, `red`, `corner`, `penalty`, `goals`, `btts`, `var`, `other`.
Yellow and red are **separate** categories — the data shows they behave very
differently (red +69% EV vs yellow +11.5%), so collapsing them into one
"card" prior would blur the signal. A new bet that fits nothing → `other` →
no prior → priced exactly as today. Categorization is **never on the critical
path of publishing** a bet.

History for the prior is computed by **keyword-matching legacy bets** to
categories at query time (the same regexes used in `_scripts/_*.mjs`, which
already reproduce the numbers above). No risky one-time backfill migration;
the stored `category` column only applies to **new** bets going forward.

## Hard constraints (verified in code)

- Existing pricing lives in `src/lib/bets/price-options.ts`
  (`priceOptionsFromProbabilities`, `priceYesNo`) → `src/lib/odds-normalize.ts`.
  The blend must feed these, not replace them.
- Per-option odds are stored in `customBets.answerConfig`
  (`decimalOddsByValue` / `decimalOddsYes/No`); resolved outcome in
  `resolved_value`. Both confirmed populated for all 358 graded bets.
- "Manual override always wins" and "no silent post-lock change" are project
  invariants — the blend is advisory only and touches no open/locked bet.
- This is NOT stock Next.js; read `node_modules/next/dist/docs/` before
  touching routing/server-action code (per AGENTS.md).
- Mobile-first is mandatory: the reference line + "why?" disclosure must work
  at 360px with 44px targets (per CLAUDE.md).

## Rejected alternatives

1. **Auto-pricing controller from hit-rate.** Rejected: wrong signal,
   feedback loop, samples too thin to earn weight before the tournament ends,
   and it makes the safe-pick flight worse. (See council verdict above.)
2. **Per-outcome Brier calibration correction.** Statistically cleanest, but
   per-category yes_no calibration is too sparse and structure-mixed in this
   data (offside is multi_choice, several categories n<8). Held as a possible
   refinement once samples grow; realized-frequency + shrinkage is the robust
   v1.
3. **Read-only dashboard only, no blend** (the council's minimal option).
   Strong and safe, but Yoav explicitly wants the odds themselves
   data-driven, not just a side panel. We keep the read-only diagnostic
   *and* add the blend, gated and override-first.
4. **Reprice existing open bets too.** Explicitly out of scope by Yoav's
   decision and by the feedback-loop risk. New bets only.

## Phasing

- **Phase 1 — signal + reference (safe, ship first).** Category field on new
  bets + closed taxonomy; query-time category history; read-only reference
  line (EV%, hit-rate, n, suggested ×N) in both creation paths. Pure
  instrumentation: cannot misprice anything because it does not change the
  stored price. Behind a settings flag.
- **Phase 2 — the blend (conditional on a passing backtest).** Apply the
  shrinkage blend to the *suggested* (pre-filled) odds; "why?" disclosure;
  kill-switch flag reverts to LLM-only with no data loss. Ship only after the
  backtest gate passes.
- **Phase 3 — later / maybe never.** LLM auto-classification of legacy bets,
  stored backfill, per-outcome Brier calibration, recency weighting for
  group→knockout drift.

## Backtest gate (must pass before Phase 2 trusts the blend)

Replay the blend over the 358 graded bets and confirm the blended
probabilities track realized outcome frequency **better than raw LLM
estimates** (lower Brier score per category, no degradation on the fat
categories). If the blend does not beat raw LLM on history, Phase 2 does not
ship. Runs offline against the DB; an afternoon's work.

## Security

- All new surfaces are admin-only; reuse the existing admin auth guard on the
  bets routes. No new public endpoint.
- The prior reads only aggregate, already-resolved data; no PII, no per-user
  exposure. The "n=250 picks" counts are aggregate, never naming players.
- Validate every blended odds value through the existing
  `validateLiveOddsConfig` before persist (finite, >1, ≤ MAX_MANUAL_RATIO in
  ratio mode) so a malformed blend can never store a bank-destroying payout.
- The blend is a pure function (no DB writes); the only write is the bet the
  admin explicitly creates, through the existing create path.

## Observability (per project rule 14)

Namespaced logs at every step, values not just labels:
- `[live-odds blend] computed` `{ category, n, w, p_llm, p_history, p_final, odds }`
- `[live-odds prior] category history` `{ category, samples, realizedFreq, evPct }`
- `[live-odds gate] skipped` `{ category, n, minSample }` when below the gate.
- Suggestion runs already log to `live_gen_runs`; extend that row (or a
  sibling) with the blend inputs so a wrong suggestion is diagnosable from the
  admin UI inline, not from guesswork.

## Settings audit (per project rule 15)

New admin controls, grouped under a "Live-bet odds" settings section:
- **Blend enabled** (master flag; off = today's behaviour exactly).
- **Shrinkage strength `k`** (default 50).
- **Min-sample gate `n`** (default 20).
- **Show reference line** (Phase 1 diagnostic) on/off.
Intentionally NOT exposed: the category taxonomy (frozen for the tournament),
the pricing pipeline constants (already in odds settings).

## Testing (per project rule 18)

- **Unit:** the blend function — shrinkage weight monotonic in `n`, gate
  returns pure-LLM below threshold, blend == LLM when history absent,
  renormalization across options sums to 1, output fed to
  `priceOptionsFromProbabilities` yields valid odds (>1, ≤ cap). Golden cases
  from real categories (offside, goals, red card) with hand-computed
  expected values. A regression test that offside's prior pulls the suggested
  odds *up* (toward fairer) given its low realized frequency.
- **Calibration/data tests:** the category-history query returns the verified
  numbers above for a fixed snapshot (offside 250 picks etc.) so a schema
  change that breaks the prior fails a test, not production.
- **Backtest harness** (Phase 2 gate) as a runnable script under `_scripts/`,
  asserting Brier improvement.
- Run the full affected suite (`pnpm test`) before calling either phase done.

## Deploy (per project rule 19)

Standard flow: feature branch → PR into `master` → CI → merge triggers
deploy. Nothing here touches production-tracking branches by hand. Phase 1 is
behind the "show reference line" flag and changes no stored price, so it is
safe to ship dark. Phase 2 ships behind "blend enabled" (default OFF); enable
in admin settings only after the backtest passes and a manual spot-check on a
draft bet looks sane. Rollback = flip the flag (no deploy, no data loss).

## Decisions locked with Yoav (2026-06-30)

1. **Default state:** Phase 2 ships with blend **OFF**. Admin enables it in
   settings after the reference panel + a couple of suggestions look right.
2. **Taxonomy:** 9 categories with **yellow and red split** (see Category
   taxonomy above).
3. **Flight-to-safe-picks / boldness-bonus track: PARKED.** Finish the
   data-driven odds first; plan the scoring change separately afterward.
