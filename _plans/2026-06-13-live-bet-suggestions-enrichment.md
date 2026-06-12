# Live-bet suggestions: kill the repetition, make it match-specific

Date: 2026-06-13
Owner: Yoav
Status: approved, in progress
Builds on: `_plans/2026-06-12-live-bets-llm-overhaul.md` (Phases 1-3 already shipped:
probability->odds pricing, draft queue, events auto-grading, autogen cron).

## The problem (user's words)

The LLM live-bet generator repeats itself, is not creative, never references the
specific match, and never proposes player-specific bets even though we hold a full
squad database via API-Football. It wastes API spend (we pay for Opus/Sonnet and get
the same generic markets every time), and the Hebrew reads translated.

## Root cause (verified in code, not guessed)

`src/lib/bets/suggest/generate.ts` + `loadFixtureContext` feed the model **only**:
team names (he/en), stage label, kickoff time. No squad, injuries, scorers, form,
head-to-head, standings, or API-Football's own prediction. A frontier model handed
nothing but "Argentina vs Mexico, Group Stage" regresses to the mean: over 2.5 goals,
red card yes/no, BTTS. Same markets for every fixture, because nothing distinguishes
one fixture from another in the prompt.

Three compounding gaps:
1. **Context starvation.** All `src/lib/api-football-data.ts` wrappers exist
   (`fetchSquad`, `fetchInjuries`, `fetchTopScorers/Assists/YellowCards`,
   `fetchTeamStatistics`, `fetchHeadCoach`, `fetchTeamFixtures`, `fetchStandings`,
   `fetchPrediction`) and none feed the generator.
2. **Single forced-tool shot, no agency.** `tool_choice` is forced onto the emit
   tool from the first token, so the model cannot search or reason first. No web
   search.
3. **Hebrew gets one line** ("Hebrew must read naturally"). No register, glossary,
   or examples, so it comes out translated.

## Correction logged (I was wrong, the user was right)

Initial claim: "player props can't be auto-graded." False. The data exists:
- `fetchMatchDetails` returns `playerRatings[]` with `apiId, goals, assists, yellow,
  red` per player (this is the "live results" page).
- The raw `/fixtures/events` payload carries `player:{id,name}` and `assist:{id,name}`;
  our parser (`api-football.ts:213`) currently drops them.
- `players.api_football_id` is a clean join key to the API's `player.id`.

So player props **can** be auto-graded by extending the grader to filter by player id.
We get creativity AND zero manual grading. This is the right answer.

## Decisions (locked with the user)

1. Player-specific markets, **auto-graded** by extending the events grader with an
   optional `playerApiId` / `assistApiId` filter. Not manual.
2. **Focused web search**: `web_search_20250305`, `max_uses: 3`, localized to Israel.
3. Default model stays **Sonnet 4.6** (configurable to Opus 4.8 in settings).

## Clarifications added 2026-06-13 (mid-build)

4. **Expose, never compel.** The dossier + every capability (player props, stats,
   web search) are presented to the model as an *available toolbox it reasons over*,
   not a required output shape. The prompt says "here is everything you have for this
   fixture, decide what actually fits this game." A scrappy group-stage game with no
   stars should not get forced star-player props. The model judges per match. This is
   a prompt-framing rule: capabilities are offered, the model owns the selection.
5. **Scope is match AND day (and beyond).** Generation must work for a single fixture
   AND for a whole matchday (`day` scope) — and the design must not preclude
   tournament/stage/group later. Generalize the dossier + `generateSuggestions` to a
   scope-aware `GenerationContext`. The day dossier aggregates a compact mini-dossier
   per fixture that day; day-scope markets the model invents may be manual-graded
   (cross-match player props have no single-fixture settlement source — fine, manual).

## Verified facts

- Pricing (models.dev, Jun 2026): Opus 4.8 $4.29/$21.46 per M in/out; Sonnet 4.6
  $3.00/$15.00 per M.
- Web search: $10 / 1,000 searches (official docs). 3 searches ~= $0.03/generation.
- Web search tool id `web_search_20250305`; params `max_uses`, `user_location`,
  `allowed_domains`, `blocked_domains`; supported on Sonnet 4.6 + Opus 4.8.
- **Gotcha**: org admin must enable web search in the Claude Console or the call
  errors (200 response, `web_search_tool_result_error`). Must verify before relying.

## Cost (calm, friends pool, per memory)

Per generation on Sonnet 4.6 with the dossier (~5-6k input) + ~4k output + 3 searches:
~ (6k*$3 + 4k*$15)/1e6 + $0.03 ~= $0.018 + $0.03 = ~$0.05/gen. ~104 matches * a few
regens = low single-digit dollars for the whole tournament. On Opus, ~3-4x. Not a
business concern; named for completeness per rule 8.

## Approach (phased; each phase ships independently)

### Phase 1 - Context + prompt + Hebrew + anti-repetition (biggest win, lowest risk)
- New `src/lib/bets/suggest/dossier.ts`: given a matchId, assemble a compact match
  dossier from the existing wrappers (both teams' stats+form, injuries for both,
  top scorers/assists/cards filtered to these two squads, recent head-to-head via
  `fetchTeamFixtures`, both standings rows, `fetchPrediction`, and the key players
  with `api_football_id`). Degrades gracefully: any wrapper returning null is simply
  omitted (the page-level pattern already in the repo). Needs the match's
  `apiFootballFixtureId` and both teams' `apiFootballTeamId` (extend the
  `loadFixtureContext` query to select them).
- Rewrite `buildSystemPrompt` / `buildUserPrompt` in `generate.ts` to render the
  dossier, demand match-specific and varied markets, and explicitly invite player
  props keyed by `api_football_id`.
- Hebrew register block: tone (casual friends-pool Hebrew, not sportscaster), a short
  glossary of betting terms, and 2-3 few-shot examples of natural vs translated
  phrasing. No em dashes (already enforced).
- Anti-repetition: pass the questions of existing open/draft bets for this fixture so
  the model does not re-propose them. New light query in the action.

### Phase 2 - Focused web search + background execution + latency
- Add `web_search_20250305` (max_uses 3, `user_location` Israel) alongside the emit
  tool; switch from forced `tool_choice` to an agentic loop: let the model search,
  handle `pause_turn` continuations, then capture the emit tool call. Fallback: if the
  model ends its turn without emitting, do one final forced-emit call with the
  accumulated context so structured output is guaranteed. (Implemented as
  `callWithSearch` in generate.ts; the no-search path stays the simple forced shot.)
- **Execution model = background + notify (the user's choice).** Built on Next 16
  `after()`: the admin action does the cheap validation synchronously, schedules the
  dossier+LLM+insert work via `after()`, and returns `{ started: true }` immediately.
  When the run finishes (or fails) it sends an in-app + push notification to the
  triggering admin via `notifyUsers` (kind 'custom', deep-links to /admin/bets). The
  page route `maxDuration` is raised to 300s (Vercel Pro ceiling) so the after() work
  outlives the response. The generator's own loop deadline is 110s with a per-call
  abort. The autogen cron keeps web search OFF (max_uses 0) to stay inside its 60s
  budget.
- System prompt steers searches to: late team news, confirmed/probable lineups,
  fresh injuries/suspensions, momentum, manager quotes.
- **External dependency to verify:** web search must be enabled in the org's Claude
  Console (Settings > Privacy). If it's off the API returns a search-error block and
  generation silently falls back to dossier-only — it never breaks, but the web-search
  value is lost until enabled.

### Phase 3 - Player-prop auto-grading (money-touching, most careful)
- Verify the live `/fixtures/events` payload includes `player.id` + `assist.id`
  before building (probe a finished WC fixture). MUST pass before wiring grading.
- Carry `player:{id,name}|null` and `assist:{id,name}|null` through
  `parseEventsResponse` + `ApiFootballEvent`.
- Extend `EventGradeSpec` with optional `playerApiId` and a `scorerAssist` flag
  (assist vs goal). `countEvents` filters by player id when present.
- Extend the suggestion JSON Schema + `transform.ts` so the model can emit a player
  id on an events grading spec. Validate the id against the fixture's two squads so a
  hallucinated id can never reach the grader (it degrades to manual instead).
- Wire settlement in `sync.ts` exactly as the existing events path; never mutate a
  placed pick except by the documented owner-explicit path (memory: user bets sacred).

## Security
- Admin instructions remain fenced/untrusted text; they steer wording only, never
  bypass schema validation (unchanged from today).
- Web search results are model context, not executed; citations retained.
- Player ids the model emits are validated against the actual fixture squads before
  grading trusts them. Fail closed to manual.
- No secrets in prompts; ANTHROPIC_API_KEY + API_FOOTBALL_KEY stay server-only.

## Observability
- `[live-gen dossier]` log: which sections were populated vs missing per fixture.
- `[live-gen search]` log: number of web_search_requests from `usage.server_tool_use`.
- Keep `[live-gen ok]` with returned/valid/dropped/usage; add search count + model.
- `[events-grade player]` log when a spec resolves via a player-id filter.

## Settings audit
- No new user-facing setting required; the existing model picker + autogen toggle on
  the AI model card cover it. Update the card's cost math/copy to include web search
  and the larger input so the projection stays honest. (Optional future knob: a
  per-generation "search depth" 0/1/3 - intentionally not adding now to avoid clutter.)

## Testing
- Unit: dossier assembly with mocked wrappers (full, partial, all-null).
- Unit: prompt builder renders dossier sections + anti-repetition list.
- Unit: events grader player-id filter (matches one player, ignores others, assist
  vs goal, missing id -> skip to manual).
- Unit: transform accepts/rejects player-id grading specs; id-not-in-squad -> manual.
- Run the full `src/lib/bets` suite + the suggest suite before calling done.

## Alternatives considered and rejected
- **Two-call pipeline (search call, then generate call).** Cleaner separation but two
  sequential model calls risk blowing the 60s function ceiling and double the input
  cost. Rejected for the single agentic loop with a forced-emit fallback.
- **Keep player props manual.** Simpler, but it dumps grading work on the admin for
  exactly the markets the user wants most, when the data to auto-grade already exists.
  Rejected.
- **Raise temperature / "be more creative" prompt only.** Treats the symptom. Without
  data the model still has nothing match-specific to say. Rejected as the primary fix
  (we still tune wording, but data is the lever).

## Open questions
- Is web search enabled on the org's Claude Console? (Verify before Phase 2 ships.)
- Squad freshness: `fetchSquad` caches 24h; fine pre-tournament, revisit if late call-ups.
