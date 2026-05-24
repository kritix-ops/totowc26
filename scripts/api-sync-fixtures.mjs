#!/usr/bin/env node
// Pulls FIFA World Cup 2026 fixtures from football-data.org and upserts them
// into the matches table. Also refreshes team localisations from the
// canonical data/team-names.json file.
// Usage: pnpm api:fixtures [season]   (defaults to 2026)

import postgres from "postgres";
import { readFile } from "node:fs/promises";

const BASE = "https://api.football-data.org/v4";
const season = Number(process.argv[2] ?? 2026);

const token = process.env.FOOTBALL_DATA_TOKEN;
const dbUrl = process.env.DIRECT_URL;
if (!token || !dbUrl) {
  console.error("Missing env. Need FOOTBALL_DATA_TOKEN and DIRECT_URL in .env.local");
  process.exit(1);
}

const TEAM_NAMES = JSON.parse(
  await readFile(new URL("../data/team-names.json", import.meta.url), "utf-8"),
);

const sql = postgres(dbUrl, { max: 1, prepare: false });

async function ensureTeam(tla, apiName) {
  const localized = TEAM_NAMES[tla];
  const nameHe = localized?.he ?? apiName;
  const nameEn = localized?.en ?? apiName;
  const flag = localized?.flag ?? "🏳️";
  await sql`
    insert into public.teams (code, name_he, name_en, flag)
    values (${tla}, ${nameHe}, ${nameEn}, ${flag})
    on conflict (code) do update set
      name_he = excluded.name_he,
      name_en = excluded.name_en,
      flag = excluded.flag
  `;
}

function mapStage(stage, group) {
  switch (stage) {
    case "GROUP_STAGE":
      return { stage: "group", groupId: group ? group.replace("GROUP_", "") : null };
    case "LAST_32":
    case "ROUND_OF_32":
      return { stage: "r32", groupId: null };
    case "LAST_16":
    case "ROUND_OF_16":
      return { stage: "r16", groupId: null };
    case "QUARTER_FINALS":
      return { stage: "qf", groupId: null };
    case "SEMI_FINALS":
      return { stage: "sf", groupId: null };
    case "THIRD_PLACE_FINAL":
      return { stage: "third_place", groupId: null };
    case "FINAL":
      return { stage: "final", groupId: null };
    default:
      return { stage: "group", groupId: null };
  }
}

function mapStatus(s) {
  if (s === "FINISHED" || s === "AWARDED") return "final";
  if (s === "IN_PLAY" || s === "PAUSED") return "live";
  return "scheduled";
}

async function fetchMatches() {
  const url = `${BASE}/competitions/WC/matches?season=${season}`;
  console.log("Fetching", url);
  const res = await fetch(url, { headers: { "X-Auth-Token": token } });
  if (res.status === 429) throw new Error("rate limit (10/min). Wait a minute.");
  if (!res.ok) throw new Error(`football-data ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.matches ?? [];
}

try {
  const fixtures = await fetchMatches();
  console.log(`Got ${fixtures.length} fixtures.`);
  let inserted = 0, updated = 0, skipped = 0;
  const unknown = new Set();
  const missingLocalization = new Set();

  for (const f of fixtures) {
    const home = f.homeTeam?.tla?.toUpperCase();
    const away = f.awayTeam?.tla?.toUpperCase();
    if (!home) { unknown.add(f.homeTeam?.name ?? "?"); skipped += 1; continue; }
    if (!away) { unknown.add(f.awayTeam?.name ?? "?"); skipped += 1; continue; }
    if (!TEAM_NAMES[home]) missingLocalization.add(`${home} (${f.homeTeam?.name})`);
    if (!TEAM_NAMES[away]) missingLocalization.add(`${away} (${f.awayTeam?.name})`);

    await ensureTeam(home, f.homeTeam?.name ?? home);
    await ensureTeam(away, f.awayTeam?.name ?? away);

    const { stage, groupId } = mapStage(f.stage, f.group);
    const status = mapStatus(f.status);
    const homeScore = f.score?.fullTime?.home ?? null;
    const awayScore = f.score?.fullTime?.away ?? null;
    const htHome = f.score?.halfTime?.home ?? null;
    const htAway = f.score?.halfTime?.away ?? null;
    const wentToPen = f.status === "PEN";

    const result = await sql`
      insert into public.matches
        (home_team, away_team, kickoff_at, stage, group_id, venue, status,
         home_score, away_score, ht_home_score, ht_away_score,
         went_to_penalties, finalized_at, api_fixture_id)
      values
        (${home}, ${away}, ${f.utcDate}, ${stage}, ${groupId}, ${f.venue ?? null},
         ${status}, ${homeScore}, ${awayScore}, ${htHome}, ${htAway},
         ${wentToPen}, ${status === "final" ? f.utcDate : null}, ${f.id})
      on conflict (api_fixture_id) do update set
        home_team = excluded.home_team,
        away_team = excluded.away_team,
        kickoff_at = excluded.kickoff_at,
        stage = excluded.stage,
        group_id = excluded.group_id,
        venue = excluded.venue,
        status = excluded.status,
        home_score = excluded.home_score,
        away_score = excluded.away_score,
        ht_home_score = excluded.ht_home_score,
        ht_away_score = excluded.ht_away_score,
        went_to_penalties = excluded.went_to_penalties,
        finalized_at = case when excluded.status = 'final' and matches.finalized_at is null then now() else matches.finalized_at end
      returning (xmax = 0) as inserted
    `;
    if (result[0]?.inserted) inserted += 1;
    else updated += 1;
  }

  console.log("");
  console.log(`Inserted: ${inserted}`);
  console.log(`Updated:  ${updated}`);
  console.log(`Skipped:  ${skipped}`);

  // Sync team → group assignments from the actual group-stage matches.
  // First make sure all letters that appear in the match data exist as
  // groups rows, then derive each team's group from any group-stage match
  // it plays in.
  console.log("");
  console.log("Syncing team→group assignments...");
  await sql`
    insert into public.groups (id, display_order)
    select distinct m.group_id, ascii(m.group_id) - ascii('A') + 1
    from public.matches m
    where m.stage = 'group' and m.group_id is not null
    on conflict (id) do nothing
  `;
  const assigned = await sql`
    update public.teams t
    set group_id = sub.gid
    from (
      select distinct on (code) code, group_id as gid from (
        select m.home_team as code, m.group_id from public.matches m
        where m.stage = 'group' and m.group_id is not null
        union all
        select m.away_team as code, m.group_id from public.matches m
        where m.stage = 'group' and m.group_id is not null
      ) all_pairs
      order by code, gid
    ) sub
    where t.code = sub.code and (t.group_id is distinct from sub.gid)
    returning t.code, t.group_id
  `;
  console.log(`Updated group_id for ${assigned.length} teams.`);
  // Clear group_id from teams that are NOT in any group-stage match
  // (cleans up stale assignments from the old seed).
  const cleared = await sql`
    update public.teams t
    set group_id = null
    where t.group_id is not null
      and not exists (
        select 1 from public.matches m
        where m.stage = 'group'
          and m.group_id = t.group_id
          and (m.home_team = t.code or m.away_team = t.code)
      )
    returning t.code
  `;
  console.log(`Cleared stale group_id from ${cleared.length} teams.`);

  if (missingLocalization.size > 0) {
    console.log("");
    console.log("Teams missing Hebrew name in data/team-names.json (add them there):");
    for (const m of missingLocalization) console.log("  -", m);
  }
} catch (e) {
  console.error("FAILED:", e?.message ?? e);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 3 });
}
