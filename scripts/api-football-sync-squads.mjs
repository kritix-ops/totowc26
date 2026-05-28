#!/usr/bin/env node
// Syncs WC 2026 squads from API-Football into our local players table.
//
// What it does:
//   1. Fetches the tournament team list (league=1, season=API_FOOTBALL_SEASON)
//      to learn each team's API-Football numeric id.
//   2. Matches each API team to our local teams.code (3-letter code or
//      case-insensitive name). Teams that do not match are skipped with
//      a printed warning so the operator can patch the alias map.
//   3. For each matched team:
//      a. Fetches /players/squads?team=<api_id> — the AUTHORITATIVE
//         roster (the actual ~26-player squad). Each entry has the
//         id, jersey number, position, photo, and an ABBREVIATED name
//         like "R. Mahrez".
//      b. Fetches /players?team=<api_id>&season=<S> across all pages
//         to build an enrichment map of api_football_id ->
//         { firstname, lastname, birth_date }. /players has full
//         names but ALSO returns non-squad appearance players (youth
//         caps, friendly call-ups), so we never use it as the roster.
//      c. For each squad member, upserts with the full name
//         `${firstname} ${lastname}` when the enrichment map has the
//         id, otherwise falls back to the abbreviated /players/squads
//         name (the rare bench / late call-up case).
//      d. Deletes any DB row for this team_code whose api_football_id
//         is NOT in the freshly-fetched squad — undoes prior bloat
//         from buggy sync attempts and removes late-cut players.
//         name_he is preserved on every row that survives the cleanup.
//   4. name_he is NEVER overwritten by this script. name_he on rows
//      that get deleted in step 3d is lost, but those rows are by
//      definition non-squad and not relevant to the tournament.
//
// Idempotent: re-running is safe and will pick up late call-ups /
// jersey-number changes. name_he is preserved across re-runs.
//
// Usage:
//   node --env-file=.env.local scripts/api-football-sync-squads.mjs
//
// Required env:
//   DIRECT_URL          - Supabase direct connection string
//   API_FOOTBALL_KEY    - api-sports.io key
//
// Optional env:
//   API_FOOTBALL_SEASON - tournament season (default: 2026)
//   SLEEP_MS_BETWEEN    - throttle between API calls (default: 250)

import postgres from "postgres";

const url = process.env.DIRECT_URL;
const apiKey = process.env.API_FOOTBALL_KEY;
const SEASON = Number(process.env.API_FOOTBALL_SEASON ?? 2026);
const SLEEP_MS = Number(process.env.SLEEP_MS_BETWEEN ?? 250);
const LEAGUE = 1; // FIFA World Cup (national teams). id 15 is the Club World Cup.

// Mirrors the alias list in api-football-map-fixtures.mjs so the
// squad sync uses the same team-name normalisation rules. Keep in
// sync if you add a new alias there.
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
    "DIRECT_URL is not set. Run with: node --env-file=.env.local scripts/api-football-sync-squads.mjs",
  );
  process.exit(1);
}
if (!apiKey) {
  console.error(
    "API_FOOTBALL_KEY is not set. Add it to .env.local before running.",
  );
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false });

function normaliseName(s) {
  // NFD + combining-mark strip so accents collapse to plain
  // ASCII (Türkiye → turkiye, Curaçao → curacao). Without this,
  // diacritics get replaced with a space by the [^a-z0-9 ]+
  // pass below and the alias table never matches.
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function teamNamesEqual(a, b) {
  const na = normaliseName(a);
  const nb = normaliseName(b);
  if (na === nb) return true;
  for (const [canon, variant] of TEAM_NAME_ALIASES) {
    if ((na === canon && nb === variant) || (na === variant && nb === canon)) {
      return true;
    }
  }
  return false;
}

async function apiGet(path) {
  const res = await fetch(`https://v3.football.api-sports.io${path}`, {
    headers: {
      "x-rapidapi-key": apiKey,
      "x-rapidapi-host": "v3.football.api-sports.io",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${path} → ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

try {
  // ── Step 1: fetch tournament teams from API-Football ───────────────
  console.log(`Fetching API-Football teams for league=${LEAGUE}, season=${SEASON}…`);
  const teamsJson = await apiGet(`/teams?league=${LEAGUE}&season=${SEASON}`);
  const apiTeams = (teamsJson.response ?? []).map((row) => ({
    apiId: row.team.id,
    name: row.team.name,
    code: (row.team.code ?? "").toUpperCase() || null,
  }));
  console.log(`  Got ${apiTeams.length} teams from API.\n`);

  // ── Step 2: match against our local teams table ────────────────────
  const localTeams = await sql`
    select code, name_en
    from public.teams
    order by code asc
  `;
  console.log(`Local teams in DB: ${localTeams.length}.`);

  // Name-only match against API teams. We deliberately do NOT
  // match on API-Football's `code` field: two distinct teams share
  // code="AUS" (Australia / Austria) and two share code="IRA"
  // (Iran / Iraq), and many other codes disagree with ours (BOS,
  // JAP, ZEA, SOU, CAP, …). See map-teams script for the same fix.
  const matched = []; // { localCode, localName, apiId, apiName }
  const unmatched = [];

  for (const lt of localTeams) {
    const byName = apiTeams.find((t) => teamNamesEqual(t.name, lt.name_en));
    if (byName) {
      matched.push({ localCode: lt.code, localName: lt.name_en, apiId: byName.apiId, apiName: byName.name });
      continue;
    }
    unmatched.push(lt);
  }

  console.log(`  Matched: ${matched.length}.`);
  if (unmatched.length > 0) {
    console.log(`  Unmatched (squads will not be fetched for these teams):`);
    for (const u of unmatched) {
      console.log(`    - ${u.code} ${u.name_en}`);
    }
  }
  console.log();

  // ── Step 3 & 4: fetch each squad and upsert ────────────────────────
  let totalUpserted = 0;
  let totalSeen = 0;
  let totalDeleted = 0;
  for (const m of matched) {
    process.stdout.write(`  ${m.localCode.padEnd(4)} ${m.localName.padEnd(28)} → `);
    try {
      // a) Roster — source of truth for who is in the squad.
      const squadJson = await apiGet(`/players/squads?team=${m.apiId}`);
      const squad = (squadJson.response?.[0]?.players ?? []);
      totalSeen += squad.length;

      // b) Enrichment — full firstname/lastname keyed by api_football_id.
      //    Paginated; 20 per page. Stop at paging.total or a 5-page
      //    safety cap (no team should ever exceed that).
      const fullNames = new Map();
      let page = 1;
      while (page <= 5) {
        await sleep(SLEEP_MS);
        const json = await apiGet(`/players?team=${m.apiId}&season=${SEASON}&page=${page}`);
        for (const r of (json.response ?? [])) {
          const p = r.player;
          if (!p?.id) continue;
          if (p.firstname && p.lastname) {
            fullNames.set(p.id, {
              firstname: p.firstname,
              lastname:  p.lastname,
              birth:     p.birth?.date ?? null,
            });
          }
        }
        const totalPages = json.paging?.total ?? 1;
        if (page >= totalPages) break;
        page += 1;
      }

      // c) Upsert each squad member with the best name we have.
      const seenIds = [];
      let enrichedCount = 0;
      for (const p of squad) {
        if (!p.id || !p.name) continue;
        const enriched = fullNames.get(p.id);
        const nameEn = enriched
          ? `${enriched.firstname} ${enriched.lastname}`.trim()
          : p.name;
        if (enriched) enrichedCount += 1;
        seenIds.push(p.id);
        await sql`
          insert into public.players (
            api_football_id, team_code, name_en, position, jersey_number, photo_url, birth_date
          ) values (
            ${p.id},
            ${m.localCode},
            ${nameEn},
            ${p.position ?? null},
            ${p.number ?? null},
            ${p.photo ?? null},
            ${enriched?.birth ?? null}
          )
          on conflict (api_football_id) do update set
            team_code     = excluded.team_code,
            name_en       = excluded.name_en,
            position      = excluded.position,
            jersey_number = excluded.jersey_number,
            photo_url     = coalesce(excluded.photo_url, public.players.photo_url),
            birth_date    = coalesce(excluded.birth_date, public.players.birth_date),
            updated_at    = now()
        `;
        totalUpserted += 1;
      }

      // d) Cleanup: drop rows in this team that aren't in the fresh
      //    squad. Undoes earlier sync bloat and removes late-cut
      //    players. Guarded by squad.length > 0 — if the API returns
      //    an empty squad (transient outage), we keep existing data.
      let deletedCount = 0;
      if (seenIds.length > 0) {
        const deleted = await sql`
          delete from public.players
          where team_code = ${m.localCode}
            and api_football_id != all(${seenIds})
        `;
        deletedCount = deleted.count ?? 0;
        totalDeleted += deletedCount;
      }

      const dropTag = deletedCount > 0 ? ` -${deletedCount} stale` : "";
      process.stdout.write(`${squad.length} squad, ${enrichedCount} with full names${dropTag}\n`);
    } catch (err) {
      process.stdout.write(`FAILED: ${err.message}\n`);
    }
    await sleep(SLEEP_MS);
  }

  console.log();
  console.log(`Done. Saw ${totalSeen} squad members across ${matched.length} teams;`);
  console.log(`  upserted ${totalUpserted} rows, deleted ${totalDeleted} non-squad rows.`);
  console.log(`Translations (name_he) are preserved on every surviving row.`);
  console.log(`Run the translation pipeline next to fill Hebrew names:`);
  console.log(`  pnpm translate:players -- --force-retranslate`);
} finally {
  await sql.end();
}
