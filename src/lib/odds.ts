import "server-only";

// API-Football /odds wrapper.
//
// Pulls the betting markets a bookmaker has published for a single
// fixture and normalises them into MarketOdds[] for the admin
// suggestions surface. Pricing the user sees is computed downstream in
// src/lib/odds-normalize.ts using the settings.liveOdds* knobs.
//
// This sibling-file pattern matches src/lib/api-football.ts: a single
// server-only integration point for the /odds endpoint, with a stub
// mode when API_FOOTBALL_KEY is unset so the rest of the pipeline can
// be developed and tested without burning API quota.
//
// Rate budget: Pro tier = 7,500 requests/day. Each call here is one
// request. The admin suggestions page fetches odds on demand and
// caches the response for 60s. A matchday with 10 fixtures + a single
// admin session = ~10 requests. Well within budget.
//
// Bookmaker: hardcoded to Bet365 (id=8). API-Football's bookmaker IDs
// are stable; we picked Bet365 because it covers every WC market and
// publishes 1-2 weeks before kickoff. If a fixture has no Bet365 row,
// the wrapper returns an empty markets array (rather than null) so the
// admin UI can show "no odds yet" instead of an error toast.

const BASE = "https://v3.football.api-sports.io";

// Bet365 — chosen as the default odds source per the plan §6.2.
// Stable across seasons. Documented at api-football.com/documentation-v3
// under the bookmakers endpoint.
export const DEFAULT_BOOKMAKER_ID = 8;

// Normalised market shape consumed by the admin suggestions page and
// the odds-normalize pricing helper. Decimal odds are preserved as
// floats; the normaliser rounds to integers when converting to our
// point-system stake/payout.
export type MarketOdds = {
  // API-Football's stable market ID. Documented at
  // api-football.com/documentation-v3 under /odds/mapping.
  marketId: number;
  // Display label exactly as API-Football returned it (e.g.
  // "Match Winner", "Both Teams Score", "Goals Over/Under").
  name: string;
  selections: Array<{
    label: string;
    decimalOdds: number;
  }>;
};

// Fetch all markets a bookmaker (default Bet365) has published for a
// fixture, normalised into MarketOdds[].
//
// Returns:
//   • null   — API_FOOTBALL_KEY unset, network error, or 4xx/5xx response.
//              Caller should treat it as "try again later" and show the
//              admin a non-blocking warning.
//   • []     — request succeeded but the bookmaker has no markets for
//              this fixture yet (typical for fixtures > 14 days out).
//              Caller should render an empty state, not an error.
//   • MarketOdds[] — markets ready to display.
export async function fetchOddsForFixture(
  apiFootballFixtureId: number,
  bookmakerId: number = DEFAULT_BOOKMAKER_ID,
): Promise<MarketOdds[] | null> {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) {
    console.warn("[odds stubbed]", {
      reason: "API_FOOTBALL_KEY not set",
      apiFootballFixtureId,
    });
    return null;
  }

  try {
    const url = `${BASE}/odds?fixture=${apiFootballFixtureId}&bookmaker=${bookmakerId}`;
    const startedAt = Date.now();
    const res = await fetch(url, {
      headers: {
        "x-rapidapi-key": key,
        "x-rapidapi-host": "v3.football.api-sports.io",
      },
      // 60s cache. Odds shift over time, but not within a single admin
      // session, so a minute of cache saves API calls when the admin
      // toggles publish on several markets for the same fixture.
      next: { revalidate: 60 },
    });
    const ms = Date.now() - startedAt;
    if (!res.ok) {
      console.warn("[odds error]", {
        apiFootballFixtureId,
        bookmakerId,
        status: res.status,
        ms,
      });
      return null;
    }
    const json = (await res.json()) as ApiFootballOddsResponse;
    const markets = parseOddsResponse(json, bookmakerId);
    console.info("[odds pull]", {
      apiFootballFixtureId,
      bookmakerId,
      marketsReturned: markets.length,
      ms,
      rateRemaining: res.headers.get("x-ratelimit-requests-remaining"),
    });
    return markets;
  } catch (err) {
    console.error("[odds fetch failed]", {
      apiFootballFixtureId,
      bookmakerId,
      err,
    });
    return null;
  }
}

// ---------- response shape + parser ----------

type ApiFootballOddsResponse = {
  response?: Array<{
    fixture: { id: number };
    bookmakers: Array<{
      id: number;
      name: string;
      bets: Array<{
        id: number;
        name: string;
        values: Array<{
          value: string;
          odd: string;
        }>;
      }>;
    }>;
  }>;
};

function parseOddsResponse(
  json: ApiFootballOddsResponse,
  bookmakerId: number,
): MarketOdds[] {
  const fixtures = json.response ?? [];
  if (fixtures.length === 0) return [];
  // We requested a single fixture; API-Football still wraps it in an
  // array. Grab the first match.
  const fixture = fixtures[0];
  const bookmaker =
    fixture.bookmakers.find((b) => b.id === bookmakerId) ??
    fixture.bookmakers[0];
  if (!bookmaker) return [];

  const out: MarketOdds[] = [];
  for (const market of bookmaker.bets) {
    const selections: MarketOdds["selections"] = [];
    for (const value of market.values) {
      const decimalOdds = Number(value.odd);
      if (!Number.isFinite(decimalOdds) || decimalOdds <= 1) continue;
      selections.push({
        label: value.value,
        decimalOdds,
      });
    }
    if (selections.length === 0) continue;
    out.push({
      marketId: market.id,
      name: market.name,
      selections,
    });
  }
  return out;
}
