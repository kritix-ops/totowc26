# Outright bet payout system — per-option longshot premium pricing

**Date:** 2026-05-30
**Owner:** Yoav, executed by Claude
**Status:** approved, ready to execute

## 1. Goal

Stop showing every tournament-outright option at the same flat payout. A multi-choice bet like "Top scorer" or "Tournament winner" currently pays the same 14/18 points whether the user picks Mbappé (real-world ~14% chance) or a random Saudi defender (~0.2% chance). The result is that everyone bets the favourite, the bet becomes a coin-flip on whether the public is right, and there is no incentive for unconventional picks.

The fix: every option carries its **own** payout derived from real-world bookmaker decimal odds, using the longshot-premium math already implemented in `src/lib/odds-normalize.ts`. Mbappé pays ~7 if he wins the Golden Boot. A random Saudi defender pays the cap (25). Picking the underdog **and being right** is properly rewarded.

This applies to every tournament-outright bet, not just top scorer:

1. Top scorer (1,357 players)
2. Golden Ball / best player (1,357 players)
3. Tournament winner (48 teams)
4. Runner-up (48 teams)
5. Third place (48 teams)
6. Group winner ×12 (4 teams per group)

Same engine, same admin UI, same data flow for all six. Live-bet markets (1X2, totals, BTTS per match) are a separate concern handled in §6 of this plan via The Odds API.

## 2. Constraints

1. **Picks freeze the payout.** Once a user picks an option, `bet_picks.payout_snapshot` already stores the payout at pick time. We extend this so it stores the **per-option** payout, not the bet-level default. Future odds movement does not retroactively affect anyone's lockedin pick. The points-bank memory ([[project_points_model]]) requires this — once a stake leaves the bank, the eventual payout must already be known.
2. **One snapshot, not a live feed.** Outright odds are fetched **once**, ~1–2 days before the global pick lock (2026-06-10 23:59 IL per [[project_betting_deadlines]]). After the snapshot, everyone sees the same payouts until the bet locks. Daily-shifting odds would mean Sunday bettors get different prices than Tuesday bettors — unfair for a friends pool.
3. **Admin must be able to override every number.** Snapshot is the starting point, not the final word. If Mbappé tears a hamstring on June 9, admin opens the editor and lifts his payout from 7 to 20 before lock.
4. **The longshot-premium math must use the existing `normalizeOdds`.** No new pricing engine. The engine works; the missing piece is feeding it per-option decimal odds.
5. **Outright bookmaker data is not exposed by any wholesale odds API.** Verified across The Odds API, OddsPapi, Sportmonks, TheStatsAPI, SportsGameOdds, OpticOdds. Tournament-winner outright (champion) is the one exception — `soccer_fifa_world_cup_winner` exists at The Odds API. Everything else (Golden Boot, Golden Ball, 2nd/3rd, group winners) must come from a one-time fetch of public board pages.
6. **Mobile-first admin UI.** Per the project rules in `CLAUDE.md`, every screen must work flawlessly at 360px. Tournament odds editor will be a table-as-stacked-cards under `md`, with 48px+ inputs.
7. **Settings layer must surface the longshot knobs.** `liveOddsBaseStake`, `liveOddsMaxPayout`, `liveOddsHouseEdgePct` already exist in `settings` and feed `normalizeOdds`. Re-use them — these are the right knobs and there is no reason to fork.
8. **No new external service before this PR ships.** Live-bet API integration (The Odds API, $30/mo) is a separate PR after this lands. This PR is zero-cost.

## 3. Approach

### 3.1 Data flow at a glance

```
[Oddschecker / Bet365 public pages]
    │   (one-time fetch script)
    ▼
[outright_odds_snapshot table]    ── admin reviews & edits ──┐
    │                                                        │
    │  admin clicks "publish"                                 │
    ▼                                                        │
[custom_bets.answer_config →                                 │
   MultiChoiceConfig.options[].payoutOverride]               │
    │                                                        │
    │  user picks an option                                   │
    ▼                                                        │
[bet_picks.payout_snapshot ← chosen option's payoutOverride] │
                                                             │
[The Odds API every 5 min during tournament]  (separate PR, §6)
```

### 3.2 One-time outright fetcher

New script: `scripts/fetch-outright-odds.mjs`.

- Runs locally or via `vercel dev` shell. Not a cron — explicitly one-shot, invoked by admin before publishing.
- For each of the nine surfaces (Top scorer, Golden Ball, Champion, Runner-up, Third, Group A–L), it fetches the relevant Oddschecker page over HTTPS, parses the team/player rows with their best-available decimal odds (median across the listed bookmakers — ignores outliers), and upserts into `outright_odds_snapshot`.
- Idempotent: running it twice the same day overwrites in place; admin's manual edits are preserved separately (§3.4).
- No headless browser. Plain `fetch` + a small parser. Oddschecker server-renders the board; we only need static HTML.
- Logs (rule 14): `[outright fetch] surface=top_scorer rows=82 median_used=true source=oddschecker.com ms=412`.
- Robots.txt: Oddschecker permits `/football/`. We respect a 2 s delay between page fetches. Single-shot run.

If a surface's page format ever changes and the parser fails for that surface, the script logs `[outright fetch error] surface=… reason=parse_failed first_chars=…` and skips it. The other eight surfaces still succeed. Admin sees missing rows in the editor and can either re-run after we patch, or paste manually.

### 3.3 Schema

Two surgical additions. Migration `0NNN_outright_odds.sql` (next available number).

**A. New table `outright_odds_snapshot`.**

```sql
create table outright_odds_snapshot (
  id              uuid primary key default gen_random_uuid(),
  surface         text not null,        -- 'top_scorer' | 'golden_ball' | 'champion' | 'runner_up' | 'third' | 'group_A' | … | 'group_L'
  option_kind     text not null,        -- 'player' | 'team'
  option_id       integer not null,     -- api_football_id (player) or api_football_team_id (team)
  display_name    text not null,        -- copy-friendly cache, e.g. 'Kylian Mbappé'
  decimal_odds    numeric(10,3) not null check (decimal_odds > 1.0 and decimal_odds <= 1000.0),
  source          text not null,        -- 'oddschecker' | 'admin_manual' | 'the_odds_api'
  fetched_at      timestamptz not null default now(),
  admin_override  boolean not null default false,
  notes           text,
  unique (surface, option_kind, option_id)
);

create index outright_odds_snapshot_surface_idx on outright_odds_snapshot (surface);
```

This is the staging area. It is not what users bet on — admin reviews this, then "publishes" into the active bet's `answer_config`.

**B. Extend `MultiChoiceOption` type.**

```ts
// src/lib/bets/types.ts
export type MultiChoiceOption = {
  value: string;
  labelHe: string;
  labelEn: string;
  groupHe?: string;
  groupEn?: string;
  subtitleHe?: string;
  subtitleEn?: string;
  icon?: string;
  /**
   * Per-option payout override in tournament points. When set, this
   * supersedes the bet-level `payoutSnapshot` for users picking *this*
   * option. Snapshotted into `bet_picks.payout_snapshot` at pick time
   * and never changes after lock.
   *
   * Range: 1..settings.liveOddsMaxPayout (default 25). Computed by
   * normalizeOdds(decimalOdds, oddsConfig). Optional for backwards
   * compatibility — bets without overrides keep the flat behavior.
   */
  payoutOverride?: number;
};
```

No DB migration here — `custom_bets.answer_config` is JSONB and unbounded.

**C. No change** to `bet_picks.payout_snapshot`. The column already stores a single integer per pick; we just write a different number into it.

### 3.4 Publish flow (admin)

`/admin/tournament-odds` is the new editor. One page, one table, mobile-first.

Top of page: dropdown to pick which surface to edit (defaults to Top scorer). Each surface is a table:

```
┌────────────────────────────────────────────────────────────────────┐
│ Top scorer · 82 rows · last fetched 2026-06-08 14:02               │
│ [↻ Re-fetch from Oddschecker]  [+ Add player]                      │
├────────────────────────────────────────────────────────────────────┤
│ Player                  decimal_odds   →   computed payout   │ ⚙   │
│ Kylian Mbappé              7.0          →   7                │ ⋮   │
│ Harry Kane                 8.0          →   8                │ ⋮   │
│ Erling Haaland            15.0          →   13               │ ⋮   │
│ Lionel Messi              15.0          →   13               │ ⋮   │
│ … (78 more)                                                  │     │
├────────────────────────────────────────────────────────────────────┤
│ Players not in board: 1,275 → default decimal_odds=250, payout=25  │
└────────────────────────────────────────────────────────────────────┘
[                 Publish to live bet "Top scorer 2026"                 ]
```

Admin edits a row → `outright_odds_snapshot.admin_override = true` for that row. The Re-fetch button leaves overrides alone (only updates rows where `admin_override = false`).

"Publish" reads the snapshot, builds a `MultiChoiceOption[]` with `payoutOverride` filled per row, and writes it to the chosen `custom_bets.answer_config.options`. For player-typed surfaces, players not in the snapshot get `payoutOverride = settings.liveOddsMaxPayout` (the default longshot cap). For team-typed surfaces, all 48 teams must be present — missing teams are a publish-blocking error.

On mobile (`< md`), the table collapses into stacked cards: option name + decimal_odds input + computed payout below it, all in a single column. Inputs are 48px tall, `inputMode="decimal"`, `font-size: 16px` to avoid iOS Safari zoom.

### 3.5 The longshot-premium math (no new code)

```ts
import { normalizeOdds } from "@/lib/odds-normalize";

const { payout } = normalizeOdds(decimalOdds, {
  baseStake: settings.liveOddsBaseStake,      // default 3
  maxPayout: settings.liveOddsMaxPayout,      // default 25
  houseEdgePct: settings.liveOddsHouseEdgePct,// default 5
});
```

That is the whole engine. Decimal odds in, payout out. The "longshot premium" everyone has been asking about is already implemented in this function — it just was not getting per-option inputs until now.

Worked examples with default knobs:

| Option           | decimal_odds | implied % | payout |
| ---------------- | ------------ | --------- | ------ |
| Mbappé           | 7.0          | 14.3%     | 7      |
| Kane             | 8.0          | 12.5%     | 8      |
| Haaland          | 15.0         | 6.7%      | 13     |
| Messi            | 15.0         | 6.7%      | 13     |
| Mid-tier striker | 50.0         | 2.0%      | 25 (capped) |
| Saudi defender   | 250.0        | 0.4%      | 25 (capped) |

The cap is the project's friendliness brake — if it were uncapped, picking a backup goalkeeper would pay 1000+ points and trivially exploit the longshot premium. The 25-point cap means there are ~30–40 distinct outcomes between "obvious favorite" and "max longshot," which is the spread we want for an interesting pool.

### 3.6 Pick-time flow

In `src/db/queries.ts` and the bet-pick server action:

```ts
function resolvePickPayout(
  cfg: AnswerConfig,
  pickValue: string,
  betLevelPayout: number,
): number {
  if (cfg.kind !== "multi_choice") return betLevelPayout;
  const opt = cfg.options.find((o) => o.value === pickValue);
  return opt?.payoutOverride ?? betLevelPayout;
}

// inside the action:
const payoutSnapshot = resolvePickPayout(bet.answerConfig, pickValue, bet.payoutSnapshot);
```

This is the only place the per-option payout takes effect on the bet flow. Everything downstream (grading, point credit, leaderboards) reads `bet_picks.payout_snapshot` and is unchanged.

### 3.7 Group bets — already locked correctly

Confirmed in `src/lib/deadlines.ts:60`: `custom_group: 60`. Group bets lock 60 minutes before the earliest kickoff in that group. No deadline-logic changes needed. The only delta for group bets is that admin populates 12 surfaces (one per group) with 4 rows each, before the relevant group kicks off.

## 4. Schema migration details

`src/db/migrations/0NNN_outright_odds.sql`:

```sql
create table outright_odds_snapshot (
  id              uuid primary key default gen_random_uuid(),
  surface         text not null,
  option_kind     text not null check (option_kind in ('player', 'team')),
  option_id       integer not null,
  display_name    text not null,
  decimal_odds    numeric(10,3) not null check (decimal_odds > 1.0 and decimal_odds <= 1000.0),
  source          text not null check (source in ('oddschecker', 'admin_manual', 'the_odds_api')),
  fetched_at      timestamptz not null default now(),
  admin_override  boolean not null default false,
  notes           text,
  unique (surface, option_kind, option_id)
);

create index outright_odds_snapshot_surface_idx on outright_odds_snapshot (surface);

comment on table outright_odds_snapshot is
  'Staging area for per-option payout pricing on tournament-outright bets. Admin reviews and publishes into custom_bets.answer_config.';
comment on column outright_odds_snapshot.admin_override is
  'When true, the Re-fetch script leaves this row alone. Lets admin lock in a manual price the fetcher would otherwise overwrite.';
```

Drizzle model added to `src/db/schema.ts` alongside `customBets`. Naming: `outrightOddsSnapshot`.

## 5. The Odds API integration — separate PR (live bets)

This plan does **not** implement The Odds API. That is a follow-up PR.

For context — when we do tackle live-bet markets (1X2, totals, BTTS for the 104 WC matches), the recommendation is:

- **Provider:** The Odds API, $30/mo (`20K` plan = 20,000 credits/month).
- **Sport keys:** `soccer_fifa_world_cup` (per-match markets) + `soccer_fifa_world_cup_winner` (tournament outright; replaces or augments the Oddschecker fetch for the Champion surface).
- **Budget math:** 104 matches × 3 markets × 1 region × 1 fetch/hour during tournament window (38 days) = 104 × 3 × 24 × 38 = 285k credits — over budget. Realistic shape: snapshot once when match is published + refresh every 6h until lock = 104 × 3 × ~6 = ~1.9k credits. Comfortable inside the 20k tier.
- **Historical odds:** snapshot endpoint costs 10× per call (5 min intervals back to 2020). Use sparingly — only to populate a "how the line moved" chart on the user-facing bet card, not as a live data feed.
- **Open question for follow-up PR:** whether the existing `fetchOddsForFixture` wrapper switches to The Odds API or we keep API-Football as a fallback. Recommend full switch — API-Football's `coverage.odds = false` for the World Cup, verified, so leaving it as fallback would only confuse the admin surface.

This deferral is intentional: outright payouts are the bigger user-experience win and have zero recurring cost. Live-bet API can ship later without blocking the outright system.

## 6. Security & safety (rule 13)

1. `/admin/tournament-odds` is gated behind the existing admin session check. No new auth surface.
2. `scripts/fetch-outright-odds.mjs` runs only locally or in an admin-triggered Vercel function. Never exposed as a public endpoint. The Oddschecker page is fetched server-side with a polite UA string; no user data leaves our system.
3. CSV upload (admin) parses with a hard size limit (256 KB) and per-row schema check before any DB write. Malformed rows are rejected with a line number, not silently dropped.
4. `decimal_odds` is constrained at the DB level (`> 1.0 and <= 1000.0`) — no injection of zero/negative numbers that would corrupt `normalizeOdds`.
5. `payoutOverride` in `MultiChoiceOption` is validated against `settings.liveOddsMaxPayout` server-side before being written. Even if an admin edits the JSON manually, the server clamps.
6. No PII in `outright_odds_snapshot`. Player display names are public.
7. Logs (next section) redact nothing — there is nothing sensitive to redact.

## 7. Observability (rule 14)

Namespaced, greppable, value-bearing logs at every meaningful step.

- **Fetcher script:**
  - `[outright fetch] surface=top_scorer rows=82 median_used=true ms=412`
  - `[outright fetch error] surface=group_C reason=parse_failed status=200 first_chars="<!DOCTYPE…"`
  - `[outright fetch summary] surfaces_ok=8 surfaces_failed=1 total_rows=420 ms=4321`
- **Admin publish action:**
  - `[outright publish] surface=top_scorer bet_id=… options=1357 with_override=82 longshot_default=25`
  - `[outright publish blocked] surface=champion bet_id=… reason=missing_teams missing=[CHI,KOR,3 more]`
- **Pick flow (per pick):**
  - `[bet pick] bet_id=… user=… option=mbappe payout_used=7 source=option_override`
  - `[bet pick] bet_id=… user=… option=midfield_X payout_used=14 source=bet_default` (when no override on that option)
- **Editor UI (client):**
  - `[tournament-odds editor] surface=top_scorer initial_rows=82 admin_overrides=3`
  - `[tournament-odds editor save] surface=top_scorer rows_changed=5 ms=124`

These are the lines I want to see in production console when a user reports "my Mbappé pick paid the wrong amount" — log shows the exact `payout_used` and `source`.

## 8. Settings audit (rule 15)

The three live-odds knobs already in `settings` are sufficient and are surfaced in `/admin/settings`:

- `liveOddsBaseStake` (default 3) — the cost to enter any outright bet.
- `liveOddsMaxPayout` (default 25) — the longshot cap. **This is the most important knob for outright bets.** Document in the admin settings UI what it controls.
- `liveOddsHouseEdgePct` (default 5) — the implied tax that makes the pool sub-100% EV.

No new settings introduced. The plan is to update the admin settings page copy to make clear that these three knobs also drive outright payouts, not just per-match live bets.

## 9. Testing (rule 18)

1. **Unit:** `resolvePickPayout` — option with `payoutOverride` returns the override; option without falls back to bet-level; missing option falls back to bet-level.
2. **Unit:** `normalizeOdds` already has tests; add cases for the new boundary `decimalOdds = 250` → expect cap.
3. **Unit:** Oddschecker parser — a recorded HTML fixture for each surface kind (player board vs team board). Parser must extract ≥ 20 rows for the player fixture and ≥ 4 rows for a group fixture. Bug fixture: malformed row → skipped with warning, not crash.
4. **Unit:** Admin publish action — building `MultiChoiceOption[]` from snapshot fills `payoutOverride` correctly and defaults missing players to `liveOddsMaxPayout`.
5. **Integration:** A real bet through the existing pick flow — pick Mbappé → `bet_picks.payout_snapshot = 7`. Pick a long-tail player → `bet_picks.payout_snapshot = 25`.
6. **Integration:** Publish into a team surface with one team missing → returns 400, no DB write.
7. **Manual QA:** `/admin/tournament-odds` at 360px width — table collapses to cards, inputs are 48px, no horizontal scroll. Edit a row, save, re-open — value persists.
8. **Manual QA:** As a real user on `/he/bets`, open the top-scorer bet → picker still works → see the per-option payout displayed next to each player.

Run the whole vitest suite green before merging.

## 10. Rollout phases

**Phase 1 — this PR (zero recurring cost):**

1. Schema migration (`outright_odds_snapshot` + drizzle model).
2. `MultiChoiceOption.payoutOverride` field + `resolvePickPayout` helper wired through the pick action.
3. Oddschecker fetcher script.
4. `/admin/tournament-odds` editor (mobile-first).
5. Live-bet-suggestions page text fix (the original bug — `src/app/[lang]/admin/live-bets/suggestions/page.tsx:169-171` and the misleading comment in `src/lib/odds.ts:24`). Now says: "API-Football does not publish odds for the World Cup. Use Tournament odds editor for outright bets, and The Odds API integration (coming soon) for per-match markets."
6. Tests, observability, security checks per §7/§8/§9.

**Phase 2 — follow-up PR (+$30/mo if approved):**

1. The Odds API integration (`soccer_fifa_world_cup` + `soccer_fifa_world_cup_winner`).
2. Per-match live-bet suggestions wired through the same `normalizeOdds` engine, displayed on the live-bet-suggestions page.
3. Optional: line-movement chart on the user-facing bet card using the 5-min historical snapshots.

Phase 2 is intentionally deferred. Phase 1 already solves the original "everyone bets Mbappé" problem and the misleading message.

## 11. Alternatives considered

1. **Pull Golden Boot from a paid odds API.** Rejected — verified across 6 providers that no consumer odds API surfaces the per-player tournament top-scorer market. Even paid tiers don't fix this.
2. **Algorithm-only (no bookmaker board).** Rejected as primary path because the algorithm gives ~70% of the accuracy of a real bookmaker board on the top 30 players, which are the players most users will pick. Kept as the **fallback** for the long-tail (any player not in the board defaults to the cap).
3. **Live daily-updating outright odds.** Rejected — unfair across bettors who pick on different days, and adds infrastructure cost for no real benefit when picks lock days before the tournament starts.
4. **Live ongoing scraper.** Rejected — fragile, possible terms-of-service issue if run repeatedly. The plan does a single fetch, treats it as a one-time data import, not a feed.
5. **Per-bet new pricing engine.** Rejected — `normalizeOdds` already implements longshot premium correctly. New engine = more code, more bugs, no advantage.

## 12. Open questions

1. **Champion surface — Oddschecker or The Odds API?** The Odds API has `soccer_fifa_world_cup_winner` and would auto-refresh, but it adds the $30/mo dependency. For Phase 1 I'll use Oddschecker (consistent with the other 8 surfaces, zero cost). When Phase 2 ships, we can switch the Champion source to The Odds API for a cleaner live feed.
2. **Auto-derived 2nd/3rd from Champion probability?** I sketched a math formula earlier. Will not implement in Phase 1 unless Oddschecker fails to provide those boards. If it does — fall back to the formula `P(2nd) ≈ P(1st) × 1.6 − P(1st)` and `P(3rd) ≈ P(1st) × 2.2 − P(2nd) − P(1st)`. Admin can still override.
3. **Should the picker UI show the payout next to each player?** Yes for clarity — but this is a small follow-up after the publish flow works. Will add to `SearchableChoicePicker` as a `subtitleAddon` prop in a follow-up commit.

## 13. Memory links

- Builds on the points-bank model: [[project_points_model]] — payout pulled from picker row, deducted at lock, returned on grade.
- Honors the deadline rules: [[project_betting_deadlines]] — outright bets lock at 2026-06-10 23:59 IL globally.
- Replaces the misleading suggestions-page copy I verified in the parent conversation. The fix lands in Phase 1 of this plan, not as a separate one-line tweak.
