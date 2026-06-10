import "server-only";
import { sql } from "drizzle-orm";
import { execRows } from "@/db/helpers";
import { TEAM_RANK } from "@/lib/players/curation";
import type { MarketOdds } from "@/lib/odds";
import type { OddsInput, ScoreModelInput } from "./score-model";

// Server-side resolver that feeds the pure score model. For a set of match ids
// it batch-loads the stored bookmaker odds (live_odds_snapshot) plus the two
// team codes, and builds one ScoreModelInput per match. One query, not N.
//
// The model walks its own fallback chain (odds -> rank -> default); this layer
// only decides whether the stored odds are usable. We deliberately keep the
// parsing surface small — just the 1X2 and the main Over/Under line — because
// every extra parsed field is another place stale or oddly-shaped data could
// quietly reintroduce nonsense. Supremacy is derived from the 1X2 split inside
// the model, so we don't parse the Asian handicap here in v1.

// Snapshots older than this are treated as missing — a fixture priced before a
// late injury/lineup change is worse than the team-strength fallback. The
// odds-sync cron refreshes daily, so a healthy snapshot is always well inside.
const ODDS_MAX_AGE_MS = 72 * 60 * 60 * 1000;

// Market ids mirror The Odds API wrapper (src/lib/the-odds-api.ts).
const MARKET_H2H = 1; // Match Winner (1X2)
const MARKET_TOTALS = 5; // Goals Over/Under

type Row = {
  id: string;
  home_team: string;
  away_team: string;
  markets: MarketOdds[] | null;
  fetched_at: string | null;
};

export async function loadScoreInputs(
  matchIds: string[],
): Promise<Map<string, ScoreModelInput>> {
  const out = new Map<string, ScoreModelInput>();
  if (matchIds.length === 0) return out;

  const idList = sql.join(
    matchIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const rows = await execRows<Row>(sql`
    select m.id::text   as "id",
           m.home_team   as "home_team",
           m.away_team   as "away_team",
           los.markets   as "markets",
           los.fetched_at::text as "fetched_at"
    from public.matches m
    left join public.live_odds_snapshot los on los.match_id = m.id
    where m.id in (${idList})
  `);

  const now = Date.now();
  for (const r of rows) {
    out.set(r.id, {
      odds: buildOddsInput(r.markets, r.fetched_at, now),
      rankHome: TEAM_RANK.get(r.home_team) ?? null,
      rankAway: TEAM_RANK.get(r.away_team) ?? null,
    });
  }
  return out;
}

function buildOddsInput(
  markets: MarketOdds[] | null,
  fetchedAt: string | null,
  now: number,
): OddsInput | null {
  if (!Array.isArray(markets) || markets.length === 0) return null;
  if (!fetchedAt) return null;
  const age = now - new Date(fetchedAt).getTime();
  if (!Number.isFinite(age) || age > ODDS_MAX_AGE_MS) return null; // stale

  const win = extractWin(markets);
  if (!win) return null; // 1X2 is the one market the odds path cannot do without
  return { win, total: extractTotal(markets) };
}

function extractWin(markets: MarketOdds[]): OddsInput["win"] | null {
  const m = markets.find((x) => x.marketId === MARKET_H2H);
  if (!m) return null;
  const odds = (label: string) =>
    m.selections.find((s) => s.label === label)?.decimalOdds;
  const home = odds("Home");
  const draw = odds("Draw");
  const away = odds("Away");
  if (![home, draw, away].every((v) => typeof v === "number" && v > 1)) {
    return null;
  }
  return { home: home!, draw: draw!, away: away! };
}

// Pick the Over/Under line closest to 2.5 (the most liquid one) and pull its
// paired prices. Labels are "Over X.X" / "Under X.X" (src/lib/the-odds-api.ts).
function extractTotal(markets: MarketOdds[]): OddsInput["total"] | null {
  let best: { line: number; over: number; under: number } | null = null;
  for (const m of markets) {
    if (m.marketId !== MARKET_TOTALS) continue;
    const over = m.selections.find((s) => s.label.startsWith("Over "));
    const under = m.selections.find((s) => s.label.startsWith("Under "));
    if (!over || !under) continue;
    if (!(over.decimalOdds > 1) || !(under.decimalOdds > 1)) continue;
    const line = Number.parseFloat(over.label.slice("Over ".length));
    if (!Number.isFinite(line)) continue;
    if (best === null || Math.abs(line - 2.5) < Math.abs(best.line - 2.5)) {
      best = { line, over: over.decimalOdds, under: under.decimalOdds };
    }
  }
  return best;
}
