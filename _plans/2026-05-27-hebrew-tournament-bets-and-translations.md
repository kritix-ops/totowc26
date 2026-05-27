# Hebrew tournament bets, player roster, and full-system Hebrew coverage

**Date:** 2026-05-27
**Status:** approved, ready to execute
**Owner conversation:** /loop initiated 2026-05-27 by user; this plan replaces ad-hoc work.

## 1. Goals

1. Admin can author tournament-wide bets (champion, runner-up, top scorer, golden ball) from the admin UI without manually wiring options each time.
2. Users see those bets on the tournament-bets surface and pick from dropdowns of real, live data (teams, players) — not free-text.
3. Everything the user sees in Hebrew locale is in Hebrew. Team names, player names, event types (red card / yellow card / offside / corner / penalty / VAR / substitution / free kick / throw-in / header), match statistics labels (xG, key passes, dribbles, possession, shots on target, etc.).
4. The same data structures support the English locale for non-Hebrew users.
5. No regressions on existing screens (rules page, dashboard, leaderboard, /live, /match/[id], /tournament tabs).

## 2. Constraints

1. Data quality bar is high — a Hebrew name that is wrong is worse than no name. Famous players (Messi, Ronaldo, Mbappe, Haaland) must be perfect. Bench / late call-ups can be best-effort with admin override.
2. API-Football is the source of truth for squads and live event data. Hebrew is a translation layer on top, not a parallel data model.
3. Translation pipeline cannot block player roster availability. If translation fails for a name, the English name is shown as a fallback and the row is flagged for admin review.
4. Schema changes ship behind migrations (`drizzle-kit` style) and remain runtime-safe (no destructive operations without admin opt-in).
5. RTL / bidi correctness across every component that now renders a player name or stat label.
6. No new paid services without explicit approval — translation pipeline must run on Wikidata + Israeli sports sites + LLM fallback (Claude API access we already have).

## 3. Requirements

Functional:
- F1: `players` table with `id`, `api_football_id`, `team_code`, `name_en`, `name_he`, `position`, `jersey_number`, `photo_url`, `birth_date`, `country_code`.
- F2: Sync command that pulls full WC squads from API-Football and inserts/updates `players` rows.
- F3: Translation pipeline that, given a player row, fills `name_he` from multi-source consensus (Wikidata + Israeli sites + LLM fallback) with a confidence score.
- F4: Admin UI to review low-confidence translations, override any translation, trigger re-sync.
- F5: Tournament-bet templates (4 in this season): champion, runner-up, top scorer, golden ball. Each template renders the right picker (team vs player) and grades automatically when the final result lands.
- F6: User-facing tournament-bet surface that uses templates instead of free-text answers where applicable.
- F7: Football term glossary table covering ~100-150 terms. Every component that surfaces an API event type or stat label routes through the glossary in the user's locale.
- F8: Live event coverage — wherever `/live`, `/match/[id]`, or `/tournament` consume API event data, the event type, stat names, and player names render in the active locale.

Non-functional:
- N1: Mobile-first. New admin player-review UI works at 360px width per project rule.
- N2: Sync jobs idempotent. Re-running the squad sync does not duplicate rows.
- N3: Logging — every translation decision is logged with the source it came from (`wikidata` / `walla` / `one` / `sport5` / `llm_claude` / `manual`) for auditability.
- N4: Failure isolation — one source going down (Walla 500s) does not break the pipeline.

## 4. Chosen approach: 7 parallel PRs

The user picked "parallel, top-to-bottom by the table." PRs ship independently when their dependencies are met. The graph is:

```
PR-1 (admin UX) ─┐
                 ├─→ PR-4 (translated dropdowns) ─┐
PR-2 (roster) ───┼─→ PR-3 (translations) ─────────┘
                 │
PR-5 (glossary) ─┼─→ PR-6 (apply glossary to UI surfaces)
                 │
PR-7 (live)  ────┘  (depends on PR-5, partially on PR-2)
```

### PR-1 — Tournament-bet admin discoverability + templates
**Scope:** New admin surface at `/admin/tournament-bets` (or absorb into existing `/admin/bets`) that lists tournament-scope bets and offers template buttons: "Create champion bet", "Create runner-up bet", "Create top scorer bet", "Create golden ball bet". Each template prefills the right `answer_type`, `bet_scope=tournament`, locks the option list to the right source (teams table for team picks, players table for player picks), and tells the auto-grader how to resolve.

**Files:**
- `src/app/[lang]/admin/bets/page.tsx` — add a "Tournament Bets" section above match-day bets.
- `src/app/[lang]/admin/bets/new/page.tsx` — new template chooser at the top, separate from the existing "blank custom bet" path.
- `src/app/[lang]/admin/bets/templates.ts` — registry of the 4 templates with their metadata.
- `src/app/[lang]/admin/bets/actions.ts` — new action `createFromTemplate(templateId)`.
- Schema: nothing new in this PR. `custom_bets` already has the scope + answer_type fields.

**Depends on:** nothing for champion/runner-up (uses existing `teams` table). Player templates light up only after PR-2 lands.

**QA gates:** Admin can create a champion bet in 3 clicks; the resulting row is visible in `/admin/bets` and on the user-facing tournament page.

---

### PR-2 — Player roster (data layer)
**Scope:** New `players` table + sync command pulling all WC squads from API-Football.

**Migration `0017_players.sql`:**
```sql
CREATE TABLE "players" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_football_id integer NOT NULL UNIQUE,
  team_code varchar(3) NOT NULL REFERENCES teams(code),
  name_en text NOT NULL,
  name_he text,  -- nullable until translation lands
  position varchar(20),
  jersey_number smallint,
  photo_url text,
  birth_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX players_team_idx ON players(team_code);
```

**Files:**
- `src/db/migrations/0017_players.sql`
- `src/db/schema.ts` — add `players` table.
- `src/db/queries.ts` — `getSquadByTeam(teamCode)`, `getAllPlayers()`, `getPlayerById(id)`.
- `scripts/api-football-sync-squads.mjs` — pulls `/players/squads?team=<id>` for every team in the tournament, upserts.
- `package.json` — `"api-football:squads": "node --env-file=.env.local scripts/api-football-sync-squads.mjs"`.

**Depends on:** API-Football mapping for teams (already done in `0013`).

**QA gates:** Running the sync command populates ~1,200 rows; rerunning is a no-op; `name_he` is null for every row at this stage.

---

### PR-3 — Hebrew translation pipeline (deep multi-source + LLM expert reviewer)
**Scope:** Fill `name_he` for every `players` row using a tiered cascade, then run every result through an LLM Hebrew-expert reviewer that produces a verdict the admin queue sorts by.

**Tier 1 — Wikidata (high confidence, free):**
- For each player, query Wikidata SPARQL: search by `name_en` plus team / nationality.
- Use the `wdt:P54` (member of sports team) constraint to disambiguate.
- Pull `labels[he]` from the matched entity.
- Coverage: ~60-80% of famous players, maybe 30-40% of bench.

**Tier 2 — Israeli sports sites (medium-high confidence):**
- Targets: Walla (sports.walla.co.il), One (one.co.il), Sport5 (sport5.co.il), Sport1 (sport1.co.il), YNET Sport (sport.ynet.co.il).
- Strategy: ahead of the tournament these sites publish full-squad articles per country. Fetch the article, parse the player list, build a fuzzy English-to-Hebrew name map.
- Use `name_en` (and a few transliteration variants) plus the team code to find the row.
- Confidence: high if ≥2 sites agree on the same Hebrew form.

**Tier 3 — LLM fallback (Claude API):**
- For any player still missing `name_he` after tiers 1-2, ask Claude to transliterate using Hebrew sports-media conventions (we already have Anthropic SDK access via the `@anthropic-ai/sdk` family — no new paid service).
- Lowest confidence; flagged for admin review.

**Stage 4 — LLM Hebrew-expert reviewer (runs on EVERY row, including ones that came from Wikidata or scrapers):**
- After tiers 1-3 produce a candidate `name_he`, a second Claude call validates it against Hebrew sports-media conventions.
- Prompt: "You are an Israeli sports-media editor. Player: `<name_en>`, plays for `<team>` as `<position>`. Proposed Hebrew name: `<name_he>`. Is this how Hebrew sports media (Walla / Sport5 / One) typically write this name? Return JSON: `{ verdict: 'approved' | 'flag' | 'reject', suggestion?: string, reason: string }`."
- The reviewer can override the picked name — its `suggestion` becomes the new candidate, recorded with `source = 'llm_reviewer'`.
- Verdict feeds into the admin review queue:
  - `approved` → no admin attention needed (still editable on demand).
  - `flag` → admin queue, sorted before approved rows.
  - `reject` → admin queue priority; UI falls back to `name_en` until admin resolves.
- The reviewer is the safety net for transliteration errors that survive consensus (e.g. all 5 Israeli sites agree on a typo).

**Files:**
- `src/lib/translations/wikidata.ts` — SPARQL client, query builder, response parser.
- `src/lib/translations/scrapers/walla.ts`, `one.ts`, `sport5.ts`, `sport1.ts`, `ynet.ts` — one file per source, each exports `fetchHebrewSquad(teamCode): Promise<Map<string,string>>`.
- `src/lib/translations/consensus.ts` — given N candidate translations with sources, pick the winner (≥2 agreement OR Wikidata) and emit `{ name_he, source, confidence }`.
- `src/lib/translations/llm-fallback.ts` — Claude call for stragglers.
- `scripts/translate-players.mjs` — orchestrator. For each player without `name_he`, run tiers 1-3, write back with confidence + source.
- Migration `0018_player_translation_audit.sql`:
  ```sql
  ALTER TABLE players ADD COLUMN name_he_source text;          -- 'wikidata' / 'walla' / ... / 'llm_claude' / 'llm_reviewer' / 'manual'
  ALTER TABLE players ADD COLUMN name_he_confidence smallint;  -- 0-100
  ALTER TABLE players ADD COLUMN name_he_review_verdict text;  -- 'approved' / 'flag' / 'reject' / NULL (unreviewed)
  ALTER TABLE players ADD COLUMN name_he_review_reason text;   -- explanation from the LLM reviewer
  ALTER TABLE players ADD COLUMN name_he_reviewed_at timestamptz;
  ALTER TABLE players ADD COLUMN name_he_admin_locked boolean NOT NULL DEFAULT false;  -- true after manual admin edit, blocks future automatic overwrites
  ```

**Admin review UI (lives in this PR):**
- New route `/admin/players` lists every player with `name_en`, current `name_he`, source badge, confidence bar, review verdict (color-coded green/yellow/red).
- Sorted: `reject` first, then `flag`, then `approved` ascending by confidence.
- Per row: Approve / Edit Hebrew / Reject / Re-run pipeline buttons.
- Manual edits set `name_he_admin_locked = true` so a future re-sync from API-Football does not stomp the admin's correction.

**Risks:**
- Scraping is fragile (HTML changes; sites may rate-limit or block by IP). Mitigation: each scraper is independent and isolated in try/catch; pipeline runs to completion even if 1-2 sources fail.
- Israeli sports sites may not have published WC squads yet. Mitigation: tier 3 LLM fallback covers the gap; admin can manually correct later.
- Wikidata coverage of bench players is sparse. Already accounted for in the tier cascade.
- Name matching: API has "Vinicius Junior", scraper page has "ויניסיוס ז׳וניור" with prefix. Need fuzzy normalisation (drop accents, drop suffixes like "Jr", "Junior", "Filho").

**Depends on:** PR-2 (the players table must exist).

**QA gates:** After running, ≥95% of `name_he` filled. Famous players' Hebrew names are correct (manual spot check of Messi, Mbappe, Haaland, Vinicius Jr, Bellingham, Kane, Ronaldo). Every row has a `source` and `confidence` value for audit.

---

### PR-4 — Translated dropdowns for tournament-bet templates
**Scope:** Build the two picker components used by PR-1's templates: `<TeamPicker>` and `<PlayerPicker>`. Wire them into the user-facing tournament-bets surface.

**Files:**
- `src/components/pickers/TeamPicker.tsx` — searchable dropdown sourced from `teams`, shows flag + locale-appropriate name.
- `src/components/pickers/PlayerPicker.tsx` — searchable dropdown sourced from `players`, optional team filter, shows photo + locale name + team.
- `src/app/[lang]/bets/tournament/page.tsx` — replace any free-text answer rendering for template-backed bets with the right picker.
- Searchable in both Hebrew and English — the search input matches against `name_he` and `name_en` regardless of locale, so a Hebrew user can type latin or Hebrew letters.

**Depends on:** PR-2 lands first (otherwise PlayerPicker has nothing). PR-3 can lag — the picker will render `name_en` as fallback until `name_he` is populated.

**QA gates:** User picks "Messi" from the PlayerPicker, sees "ליאו מסי" in Hebrew, "Lionel Messi" in English. The bet submits with the correct `player_id` reference.

---

### PR-5 — Football term glossary (extended scope: ~100-150 terms)
**Scope:** New `term_translations` table (or static dict file — see Alternatives) covering event types, stat labels, match-state labels.

**Coverage targets (user picked extended):**
- Events: goal, own goal, penalty (kick + scored + missed), penalty shootout, free kick, throw-in, corner, offside, foul, yellow card, red card, second yellow, substitution, VAR review, VAR overturn, kickoff, halftime, full time, extra time, golden goal.
- Shot types: header, volley, bicycle kick, tap-in, long-range, dipping.
- Positions: GK / DEF / MID / FWD plus specific (CB, LB, RB, CM, AM, DM, LW, RW, ST, CF).
- Stats: xG (expected goals), xA (expected assists), shots, shots on target, shots off target, blocked shots, key passes, completed passes, pass accuracy, dribbles, dribbles past, tackles, interceptions, clearances, blocks, fouls won, fouls committed, aerials won, duels won, distance covered, sprints, top speed, possession %, possession lost, possession won, touches, touches in box.
- Match phases: opening goal, equalizer, comeback, clean sheet, hat-trick, brace, golden boot, golden ball, golden glove, best young player.
- ~120 terms total.

**Approach:** static TypeScript dict (no DB) — these terms are stable, version-controlled, easy to audit. A DB table makes sense only if admin needs to edit them at runtime, which we do not need for this fixed vocabulary.

**Files:**
- `src/lib/translations/glossary.ts` — `export const TERMS: Record<TermKey, { he: string; en: string }>`.
- `src/lib/translations/index.ts` — `t(key, locale): string` helper.

**Depends on:** nothing.

**QA gates:** Every term defined has both `he` and `en`; type system enforces exhaustiveness; spot-check by a Hebrew speaker before merge.

---

### PR-6 — Apply glossary to every UI surface that consumes API event/stat data
**Scope:** Audit and fix.

**Audit targets:**
- `/live` page — event-by-event commentary, if any.
- `/match/[id]` — events list, lineup, stats panel.
- `/tournament` tabs (Summary, News, Teams, Players, Tables) — any English labels.
- Admin pages where API data leaks raw to admin.

**Files (estimated, finalise during the audit):**
- `src/app/[lang]/live/page.tsx`
- `src/app/[lang]/match/[matchId]/page.tsx`
- `src/app/[lang]/tournament/*Tab.tsx`

**Depends on:** PR-5 ships first.

**QA gates:** Switching from `/he/` to `/en/` flips every event/stat label, no English text leaks on `/he/`, no Hebrew leaks on `/en/`.

---

### PR-7 — Live commentary deep dive (audit before sizing)
**Scope:** Reserved. Sized after the PR-6 audit reveals what `/live` actually shows. If it is only scores + scorers, this PR may collapse into PR-6. If there is event-by-event commentary text, this PR builds a translator that maps API event payloads to Hebrew sentences.

**Depends on:** PR-6 audit.

## 5. Alternatives considered and rejected

1. **LLM-only bulk translation.** Rejected per user choice — Hebrew sports-media has specific naming conventions (e.g. "מסי" not "מסשי", "רונאלדו" not "רונלדו") that an LLM gets right for famous names but is inconsistent on for less common ones. Multi-source is the user's preference.
2. **Wikidata-only.** Rejected — Wikidata coverage of bench / late-call-up players is poor.
3. **DeepL paid tier.** Rejected — costs money for a one-shot task we can do for free.
4. **DB table for the football term glossary instead of a static dict.** Rejected — terms do not need admin runtime editing, and a code-reviewed dict is easier to QC. Reconsider if you ever want non-developers to add terms.
5. **Make duels_winner a hidden category permanently.** Out of scope for this plan; the previous prize-strip change already addressed it.

## 6. Security and safety section (rule 13)

1. Scraping Israeli news sites: respect `robots.txt`, throttle to ≤1 request per second per site, set a clear User-Agent identifying the app. No login, no paywalled content.
2. Wikidata SPARQL endpoint has public rate limits — batch queries, do not exceed published limits.
3. LLM fallback calls: no PII in prompts. Player names plus team plus position is the input; output is a Hebrew transliteration. No prompt-injection risk because we control the input shape.
4. Admin manual-override UI must enforce admin role server-side (already covered by existing `requireAdmin`).
5. No raw HTML from scraped pages stored in the DB — only the parsed Hebrew name.
6. All new migrations are non-destructive (ADD COLUMN with defaults / new tables only). Roll-forward only.

## 7. Cost analysis (rule 8)

1. Wikidata: free.
2. Israeli sports sites: free (within fair-use rate limits).
3. Anthropic Claude API for tier-3 fallback: covered by existing access. Expected volume ~200-400 player names × ~50 tokens each ≈ 20K tokens one-shot. Negligible.
4. API-Football: already paid; squads endpoint is included in the existing plan.
5. Storage: trivial, well under existing Supabase plan limits.
6. **Maintenance cost** is the real ongoing concern: every late call-up needs a re-translation pass. Admin UI to override manually mitigates this.

## 8. Open questions

1. Should team flag-emoji in the `teams.flag` column be replaced with proper SVG flags for parity with player photos? Out of scope for this plan but flagging now.
2. The `/live` page is referenced in PR-6 / PR-7 but I have not opened the file yet. The PR-6 audit will surface whether commentary even exists today.
3. **Resolved 2026-05-27:** Player photos use `next/image` with API-Football CDN added as a `remotePatterns` entry in `next.config.ts`. No mirror to Supabase Storage in this pass — revisit only if API-Football breaks hot-linking.
4. RTL handling of player names containing Latin letters / digits inside Hebrew strings (e.g. "כיליאן מבאפה (10)") — needs a quick BiDi review on the PlayerPicker.

## 9. Execution order recap

User picked "parallel by row in the table". Order I will work in:
- PR-1 (admin UX) and PR-5 (glossary) can start in parallel — no dependencies.
- PR-2 (roster) starts in parallel — no dependencies.
- PR-3 (translations) starts as soon as PR-2's table exists.
- PR-4 (dropdowns) starts as soon as PR-2 is on master.
- PR-6 (glossary application) starts after PR-5 ships.
- PR-7 (live) is sized only after PR-6 audit.

Each PR ships its own commit + push + working preview.
