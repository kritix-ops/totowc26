import "server-only";

// Live-odds wrapper for the suggestions surface.
//
// Source of truth: The Odds API v4 — see src/lib/the-odds-api.ts.
// Before 2026-05-30 this file talked to API-Football, but its
// /odds endpoint reports `coverage.odds = false` for the WC across
// every season we checked (verified live against league=1 / season=2026
// and 2022). The Odds API covers 21+ bookmakers per fixture (Pinnacle,
// Betfair, William Hill, 888sport, 1xBet, Marathon, …) and returns the
// entire WC board in one call. Median across bookmakers gives a stable
// price.
//
// This file remains the surface the rest of the app (suggestions page,
// future cron) imports from. Swapping providers only edits the
// fetchWcMatchOdds call inside fetchOddsForMatch — every caller keeps
// using MarketOdds.

import { fetchWcMatchOdds } from "./the-odds-api";

// Normalised market shape consumed by the admin suggestions page and
// the odds-normalize pricing helper. Decimal odds are preserved as
// floats; the normaliser rounds to integers when converting to our
// point-system stake/payout.
export type MarketOdds = {
  // Stable market ID. Mirrors API-Football's numbering so existing
  // skip-lists and grading hooks keep working unchanged.
  marketId: number;
  // Display label exactly as returned by the upstream wrapper (e.g.
  // "Match Winner", "Goals Over/Under").
  name: string;
  selections: Array<{
    label: string;
    decimalOdds: number;
  }>;
};

// Fetch all WC markets for one fixture, median-aggregated across
// every bookmaker that priced the event.
//
// Returns:
//   • null   - THE_ODDS_API_KEY unset, network error, or HTTP error.
//              Suggestions page renders the "couldn't pull odds" hint.
//   • []     - request succeeded but no event matched this fixture
//              (team-name mismatch — add an alias to the-odds-api.ts —
//              OR the bookmaker has not priced this fixture yet).
//   • rows   - markets ready to display.
export async function fetchOddsForMatch(args: {
  homeTeamEn: string;
  awayTeamEn: string;
  kickoffAt: Date;
}): Promise<MarketOdds[] | null> {
  return fetchWcMatchOdds(args);
}
