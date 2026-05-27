#!/usr/bin/env node
// One-shot script that backfills matches.api_football_fixture_id by
// matching API-Football's World Cup fixtures against our local matches
// table. Run once after subscribing to API-Football Pro and dropping
// the API_FOOTBALL_KEY in env.
//
// Usage:
//   node --env-file=.env.local scripts/api-football-map-fixtures.mjs
//
// Matching strategy:
//   1. Compare team 3-letter codes (their `team.code` ↔ our teams.code).
//      Some federations may report null codes - fall back to name match
//      against teams.name_en.
//   2. Same Asia/Jerusalem calendar date (kickoff within the same TZ day).
//
// Idempotent: only updates rows where api_football_fixture_id IS NULL,
// so re-running after a partial map continues from where it stopped.

import postgres from "postgres";

const url = process.env.DIRECT_URL;
const apiKey = process.env.API_FOOTBALL_KEY;
const SEASON = Number(process.env.API_FOOTBALL_SEASON ?? 2026);
const LEAGUE = 1; // FIFA World Cup (national teams). id 15 is the Club World Cup.

// Explicit aliases bridge the cases where the normalization function alone
// is not enough. Each entry maps our canonical form to a variant we know
// API-Football uses. Hoisted to the top of the file so teamNamesEqual()
// can read it during the main matching loop (const has TDZ).
const TEAM_NAME_ALIASES = [
  ["czechia",            "czech republic"],
  ["bosnia herzegovina", "bosnia and herzegovina"],
  ["turkiye",            "turkey"],
  ["cape verde",         "cape verde islands"],
  ["cape verde",         "cabo verde"],
  ["dr congo",           "congo dr"],
  ["dr congo",           "congo democratic republic"],
  ["dr congo",           "democratic republic of congo"],
  ["south korea",        "korea republic"],
  ["ivory coast",        "cote d ivoire"],
];

if (!url) {
  console.error(
    "DIRECT_URL is not set. Run with: node --env-file=.env.local scripts/api-football-map-fixtures.mjs",
  );
  process.exit(1);
}
if (!apiKey) {
  console.error(
    "API_FOOTBALL_KEY is not set. Add it to .env.local before running this script.",
  );
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false });

try {
  console.log(`Fetching API-Football fixtures for league=${LEAGUE}, season=${SEASON}…`);
  const res = await fetch(
    `https://v3.football.api-sports.io/fixtures?league=${LEAGUE}&season=${SEASON}`,
    {
      headers: {
        "x-rapidapi-key": apiKey,
        "x-rapidapi-host": "v3.football.api-sports.io",
      },
    },
  );
  if (!res.ok) {
    console.error(`API-Football returned ${res.status} ${res.statusText}`);
    const body = await res.text();
    console.error(body.slice(0, 500));
    process.exit(1);
  }
  const json = await res.json();
  const fixtures = (json.response ?? []).map((row) => ({
    fixtureId: row.fixture.id,
    kickoffAt: row.fixture.date,
    homeTla: (row.teams.home.code ?? "").toUpperCase() || null,
    awayTla: (row.teams.away.code ?? "").toUpperCase() || null,
    homeName: row.teams.home.name,
    awayName: row.teams.away.name,
  }));
  console.log(`Received ${fixtures.length} fixtures from API-Football.`);

  const localMatches = await sql`
    select
      m.id::text                                        as id,
      m.home_team                                       as home_tla,
      m.away_team                                       as away_tla,
      ht.name_en                                        as home_name_en,
      at.name_en                                        as away_name_en,
      to_char((m.kickoff_at at time zone 'Asia/Jerusalem')::date,
              'YYYY-MM-DD')                              as ji_date,
      m.api_football_fixture_id                         as already
    from public.matches m
    join public.teams ht on ht.code = m.home_team
    join public.teams at on at.code = m.away_team
  `;
  console.log(`Local matches: ${localMatches.length}.`);

  // Pre-bucket API fixtures by Asia/Jerusalem date so the inner loop is
  // O(matches × bucketSize) instead of O(matches × totalFixtures).
  const buckets = new Map();
  for (const fx of fixtures) {
    const jiDate = isoToJerusalemDate(fx.kickoffAt);
    const arr = buckets.get(jiDate) ?? [];
    arr.push(fx);
    buckets.set(jiDate, arr);
  }

  let mapped = 0;
  let alreadyMapped = 0;
  const unmatched = [];

  for (const m of localMatches) {
    if (m.already !== null) {
      alreadyMapped += 1;
      continue;
    }
    const candidates = buckets.get(m.ji_date) ?? [];
    // Three-tier match: strict TLA → exact name → normalized-name. API-Football
    // names countries differently from us in 5+ cases (e.g. "Czech Republic"
    // vs our "Czechia", "Turkey" vs "Türkiye") and their `code` field is null
    // for those teams. Normalization strips accents, punctuation, and common
    // qualifier words so "DR Congo" matches "Congo DR", etc.
    const match =
      candidates.find(
        (fx) => fx.homeTla === m.home_tla && fx.awayTla === m.away_tla,
      ) ??
      candidates.find(
        (fx) =>
          fx.homeName.toLowerCase() === m.home_name_en.toLowerCase() &&
          fx.awayName.toLowerCase() === m.away_name_en.toLowerCase(),
      ) ??
      candidates.find(
        (fx) =>
          teamNamesEqual(fx.homeName, m.home_name_en) &&
          teamNamesEqual(fx.awayName, m.away_name_en),
      );

    if (!match) {
      unmatched.push({
        matchId: m.id,
        date: m.ji_date,
        home: `${m.home_tla} (${m.home_name_en})`,
        away: `${m.away_tla} (${m.away_name_en})`,
        candidatesSample: candidates.slice(0, 3).map(
          (fx) => `${fx.homeName}(${fx.homeTla ?? "-"}) vs ${fx.awayName}(${fx.awayTla ?? "-"})`,
        ),
      });
      continue;
    }

    await sql`
      update public.matches
      set api_football_fixture_id = ${match.fixtureId}
      where id = ${m.id}::uuid
    `;
    mapped += 1;
  }

  console.log("");
  console.log(`Done. Newly mapped: ${mapped}. Already mapped: ${alreadyMapped}.`);
  if (unmatched.length > 0) {
    console.warn(`Unmatched (${unmatched.length}):`);
    for (const u of unmatched) {
      console.warn(`  ${u.date}  ${u.home} vs ${u.away}  (match_id=${u.matchId})`);
      if (u.candidatesSample.length > 0) {
        console.warn(`    api candidates on this date: ${u.candidatesSample.join(" | ")}`);
      }
    }
    console.warn(
      "These will fall back to manual grading. Common cause: API-Football's `code` field is null and our `name_en` doesn't match their team name after normalization. Add an explicit alias in TEAM_NAME_ALIASES below, or hand-update the api_football_fixture_id column directly.",
    );
  }
} finally {
  await sql.end({ timeout: 5 });
}

// Convert an ISO timestamp (UTC) to the YYYY-MM-DD it falls under in
// Asia/Jerusalem. Mirrors the SQL `at time zone 'Asia/Jerusalem'::date`
// the rest of the codebase uses to bucket matchdays.
function isoToJerusalemDate(iso) {
  const dt = new Date(iso);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(dt); // en-CA gives YYYY-MM-DD
}

// Normalize a team name for matching: lowercase, strip diacritics, replace
// punctuation with spaces, collapse multiple spaces, trim. Then drop a few
// connective words ("and", "the") that vary between styles. Two names match
// if their normalized forms are equal, one contains the other, or they
// share an entry in TEAM_NAME_ALIASES.
function teamNamesEqual(a, b) {
  const na = normalizeTeamName(a);
  const nb = normalizeTeamName(b);
  if (na === nb) return true;
  if (na.length > 3 && nb.length > 3 && (na.includes(nb) || nb.includes(na))) {
    return true;
  }
  for (const [canonical, variant] of TEAM_NAME_ALIASES) {
    const c = normalizeTeamName(canonical);
    const v = normalizeTeamName(variant);
    if ((na === c && nb === v) || (na === v && nb === c)) return true;
  }
  return false;
}

function normalizeTeamName(s) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")        // strip combining diacritical marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")            // punctuation/hyphens to spaces
    .replace(/\b(and|the|of|republic|islands)\b/g, " ") // drop noise words
    .replace(/\s+/g, " ")
    .trim();
}
