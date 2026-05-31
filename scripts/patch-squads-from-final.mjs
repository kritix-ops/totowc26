#!/usr/bin/env node
// Patch the players table to match the announced final 26-man squads
// per `data/wc2026-final-squads.json`.
//
// Strategy per team (status === "announced"):
//   1. Load the official squad name list from the JSON.
//   2. Pull the current DB rows for this team_code (with api_football_id,
//      name_en).
//   3. For each official name, try to match it to a DB row by normalised
//      lastname fuzzy contains. Matches stay (they keep their existing
//      api_football_id, name_he, and audit fields). Unmatched official
//      names go to a "needs lookup" list.
//   4. For each "needs lookup" name, hit API-Football
//      /players?team=<api_id>&season=2026&search=<lastname>, pick the
//      best match (full-name token-overlap score), and stage it for
//      INSERT with the official name_en. If API-Football returns
//      nothing, the player is logged as `UNRESOLVED` and skipped (we
//      can't insert without an api_football_id since that's our PK).
//   5. DB rows in this team that didn't match an official name go to
//      the DELETE list (they were preliminary call-ups not in the
//      final 26).
//
// Teams with status === "pending" are left untouched.
//
// Usage:
//   # Preview every diff, no DB writes:
//   node --env-file=.env.local scripts/patch-squads-from-final.mjs --dry-run
//
//   # Apply changes:
//   node --env-file=.env.local scripts/patch-squads-from-final.mjs --apply
//
//   # Limit to one team (useful for iterating):
//   node --env-file=.env.local scripts/patch-squads-from-final.mjs --dry-run --team=ENG

import { readFile } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import postgres from "postgres";

const url = process.env.DIRECT_URL;
const apiKey = process.env.API_FOOTBALL_KEY;
if (!url) { console.error("DIRECT_URL missing"); process.exit(1); }
if (!apiKey) { console.error("API_FOOTBALL_KEY missing"); process.exit(1); }

const args = new Set(process.argv.slice(2));
const isDry = args.has("--dry-run");
const isApply = args.has("--apply");
const teamArg = [...args].find((a) => a.startsWith("--team="))?.slice(7)?.toUpperCase();
if (!isDry && !isApply) {
  console.error("Pass --dry-run or --apply.");
  process.exit(1);
}

const SEASON = 2026;
const SLEEP_MS = 250;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sql = postgres(url, { max: 1, prepare: false });

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

// Normalise a name for matching: strip diacritics, drop apostrophes,
// lowercase, collapse whitespace. Used for both lastname-contains
// and full-name token comparison.
function norm(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[‘’']/g, "")
    .replace(/[^a-z0-9 -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// East-Asian convention: "Family Given". We treat the LAST token of
// the official name as the primary surname, but for KOR/JPN we also
// allow the first token (their family name) as a fallback match.
const FAMILY_FIRST_TEAMS = new Set(["KOR", "JPN"]);

// Manual `<team_code>:<official squad name>` → api_football_id overrides
// for stars whose lastname is too generic to match safely via the global
// /players/profiles search (Williams, Ronaldo, etc.) or who appear under
// a stage name that doesn't fuzzy-match their DB row. Verified
// player-by-player against API-Football's /players/profiles?player=<id>.
// Tomorrow's re-run after FIFA's June 1 deadline should catch most of
// these via the refreshed team-season roster; the override is a
// belt-and-braces for today.
const PLAYER_ID_OVERRIDES = {
  "POR:Cristiano Ronaldo": 874,
  "POR:Vitinha":           128384,
  "POR:Diogo Costa":       369,
  "POR:Bernardo Silva":    636,
  "POR:Rúben Dias":        567,
  "ESP:Gavi":              296667,
  "ESP:Nico Williams":     183799,
  "GER:Alexander Pavlović": 328033,
  "GER:Pascal Gross":      18970,
  "NED:Guus Til":          36905,
};

// Common English nicknames → canonical given name. Used by the global
// /players/profiles lookup so "Ollie Watkins" matches "Oliver George
// Arthur Watkins" (id=19366). Both directions are checked. Add entries
// as we hit them; the map is small on purpose so collisions stay rare.
const NICKNAMES = {
  ollie:   ["oliver"],
  oliver:  ["ollie"],
  harry:   ["harold", "henry"],
  jack:    ["john"],
  tom:     ["thomas"],
  tommy:   ["thomas"],
  mike:    ["michael"],
  bobby:   ["robert"],
  will:    ["william"],
  billy:   ["william"],
  dan:     ["daniel"],
  danny:   ["daniel"],
  alex:    ["alexander", "alessandro", "aleksandar", "alejandro", "aleksey"],
  álex:    ["alexander", "alessandro", "aleksandar", "alejandro"],
  ben:     ["benjamin"],
  joe:     ["joseph"],
  joey:    ["joseph"],
  nick:    ["nicholas", "nicolas"],
  rob:     ["robert"],
  matt:    ["matthew"],
  jamie:   ["james"],
  chris:   ["christopher", "christian"],
  tony:    ["anthony", "antonio"],
  jim:     ["james"],
  tino:    ["valentino", "agostino"],
  noni:    ["chukwunonso"],
  manu:    ["emmanuel", "manuel"],
  denis:   ["deniz"],
  deniz:   ["denis"],
  andy:    ["andrew", "andreas"],
  kenny:   ["kenneth"],
  taha:    ["mohamed taha"],
  kosta:   ["konstantinos"],
  duke:    ["jeanluc", "jean luc", "jeanlluc"],
  johnny:  ["johny", "jonathan", "john"],
  alé:     ["alex", "alejandro"],
  álex:    ["alexander"],
};

function familyToken(officialName, teamCode) {
  const tokens = norm(officialName).split(" ").filter(Boolean);
  if (tokens.length === 0) return "";
  if (FAMILY_FIRST_TEAMS.has(teamCode)) return tokens[0];
  // Strip common patronymic / suffix particles.
  const STRIP = new Set(["jr", "junior", "ii", "iii"]);
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (!STRIP.has(tokens[i])) return tokens[i];
  }
  return tokens[tokens.length - 1];
}

function tokenSet(name) {
  return new Set(norm(name).split(" ").filter((t) => t.length >= 2));
}

function jaccard(a, b) {
  const A = tokenSet(a);
  const B = tokenSet(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / new Set([...A, ...B]).size;
}

// Damerau-Levenshtein distance, capped at 2 (we never need more). Small
// implementation tailored for matching e/i swaps and accent fallback
// in player surnames (e.g., "Casemiro" vs "Casimiro").
function editDist(a, b) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 3;
  const m = a.length, n = b.length;
  const prev2 = new Array(n + 1);
  const prev  = new Array(n + 1);
  const curr  = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,         // deletion
        curr[j - 1] + 1,     // insertion
        prev[j - 1] + cost,  // substitution
      );
      if (i >= 2 && j >= 2 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        curr[j] = Math.min(curr[j], prev2[j - 2] + 1); // transposition
      }
    }
    for (let j = 0; j <= n; j++) { prev2[j] = prev[j]; prev[j] = curr[j]; }
  }
  return prev[n];
}

function lastnameFuzzyMatch(officialFam, candidateLastTokens, candidateName) {
  if (officialFam.length < 3) return false;
  for (const t of candidateLastTokens) {
    if (t.length < 4) continue; // skip particles ("de", "el", "ben", "da")
    if (t === officialFam) return true;
    // Require the shorter token to be at least 4 chars before allowing
    // a contains match — without this floor "zendejas".includes("de") is
    // true and we false-match Cardoso → Zendejas.
    if (t.includes(officialFam) || officialFam.includes(t)) return true;
    if (officialFam.length >= 4 && editDist(t, officialFam) <= 1) return true;
  }
  // Word-boundary contains on the full name, so an abbreviated API name
  // ("C. Casimiro" → lastTokens=["casimiro"]) still falls through cleanly.
  if (candidateName) {
    const nameNorm = norm(candidateName);
    const re = new RegExp(`(^|\\s)${officialFam}(\\s|$)`);
    if (re.test(nameNorm)) return true;
  }
  return false;
}

function teamNamesEqual(a, b) {
  const na = norm(a);
  const nb = norm(b);
  if (na === nb) return true;
  for (const [canon, variant] of TEAM_NAME_ALIASES) {
    if ((na === canon && nb === variant) || (na === variant && nb === canon)) return true;
  }
  return false;
}

async function apiGet(path) {
  const res = await fetch(`https://v3.football.api-sports.io${path}`, {
    headers: { "x-rapidapi-key": apiKey, "x-rapidapi-host": "v3.football.api-sports.io" },
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// API-Football's `search` parameter on /players is unreliable on the
// Pro tier (returns 0 even for known names). The paginated team-season
// listing is the dependable surface. We fetch the full /players list
// for the team once and use it as a local lookup map.
async function fetchTeamPlayerRoster(apiTeamId) {
  // Returns Array<{ id, name, firstname, lastname }>. The roster
  // includes every player who has any 2026-season record for the
  // team — bigger than the official 26, which is exactly what we
  // need for the "find a name we don't yet have in DB" step.
  const all = [];
  let page = 1;
  while (page <= 10) {
    await sleep(SLEEP_MS);
    const json = await apiGet(`/players?team=${apiTeamId}&season=${SEASON}&page=${page}`);
    for (const row of json.response ?? []) {
      const p = row.player;
      if (!p?.id) continue;
      all.push({
        id: p.id,
        name: p.name,
        firstname: p.firstname ?? "",
        lastname: p.lastname ?? "",
      });
    }
    const total = json.paging?.total ?? 1;
    if (page >= total) break;
    page += 1;
  }
  return all;
}

function lookupInRoster(roster, officialName, teamCode) {
  const fam = familyToken(officialName, teamCode);
  const officialTokens = norm(officialName).split(" ").filter((t) => t.length >= 2);
  const officialFirst = FAMILY_FIRST_TEAMS.has(teamCode)
    ? (officialTokens[officialTokens.length - 1] ?? "")
    : (officialTokens[0] ?? "");
  const isMonotoken = officialTokens.length === 1;
  let best = null;
  for (const p of roster) {
    const full = [p.firstname, p.lastname].filter(Boolean).join(" ") || p.name;
    const lastTokens = norm(p.lastname ?? "").split(" ").filter((t) => t.length >= 2);
    const famMatches = lastnameFuzzyMatch(fam, lastTokens, p.name);
    if (!famMatches) continue;
    const firstTokens = norm(p.firstname ?? "").split(" ").filter((t) => t.length >= 2);
    const exploded = firstTokens.flatMap((t) => t.split("-").filter((s) => s.length >= 2));
    const firstnameOverlap =
      isMonotoken ||
      exploded.includes(officialFirst) ||
      exploded.some((t) => officialFirst.length >= 3 && t.startsWith(officialFirst)) ||
      exploded.some((t) => t.length >= 3 && officialFirst.startsWith(t)) ||
      (NICKNAMES[officialFirst] ?? []).some((n) => exploded.includes(n)) ||
      (officialFirst.length >= 4 && exploded.some((t) => t.length >= 4 && editDist(t, officialFirst) <= 1));
    if (!firstnameOverlap) continue;
    const score = jaccard(officialName, full);
    const composite = score + 0.5 + 0.3;
    if (!best || composite > best.composite) {
      best = { id: p.id, name: full, score, composite, famMatches };
    }
  }
  if (best) return best;
  return null;
}

// Global /players/profiles search — works for players the team-season
// roster doesn't surface (frequent for Premier-League stars whose
// 2026 national-team appearances haven't been registered yet). We
// score every returned profile against the official name and require
// the player's firstname tokens to actually match the official name's
// firstname tokens — otherwise "Ivan Toney" picks up "Daniel Stoney"
// or "S. Toney" with the same token-overlap as the real Ivan Toney
// (id=19974), because they all share the surname token.
async function lookupInGlobalProfiles(officialName, teamCode) {
  const fam = familyToken(officialName, teamCode);
  if (fam.length < 3) return null;
  const stripped = fam.replace(/[^a-z]/g, "");
  if (stripped.length < 3) return null;
  const officialTokens = norm(officialName).split(" ").filter((t) => t.length >= 2);
  const officialFirst = officialTokens[0] ?? "";
  let best = null;
  // /players/profiles paginates 250 per page. We walk up to 3 pages
  // (750 hits) which covers every common surname seen in the WC roster.
  for (let page = 1; page <= 3; page++) {
    await sleep(SLEEP_MS);
    let json;
    try {
      json = await apiGet(`/players/profiles?search=${encodeURIComponent(stripped)}&page=${page}`);
    } catch (err) {
      console.warn(`    profiles search failed (${stripped} p${page}): ${err.message}`);
      break;
    }
    for (const row of json.response ?? []) {
      const p = row.player;
      if (!p?.id) continue;
      const firstTokens = norm(p.firstname ?? "").split(" ").filter((t) => t.length >= 2);
      const lastTokens  = norm(p.lastname  ?? "").split(" ").filter((t) => t.length >= 2);
      // Require lastname to contain the family token.
      const lastnameMatch = lastTokens.some((t) => t.includes(fam) || fam.includes(t));
      if (!lastnameMatch) continue;
      // Require firstname to share at least one token with the official
      // firstname OR have firstname-exact identical first token.
      const apiFirst = firstTokens[0] ?? "";
      const firstnameMatch =
        firstTokens.includes(officialFirst) ||
        (apiFirst && apiFirst.startsWith(officialFirst)) ||
        (apiFirst && officialFirst.startsWith(apiFirst)) ||
        (NICKNAMES[officialFirst] ?? []).some((n) => firstTokens.includes(n)) ||
        (NICKNAMES[apiFirst]      ?? []).some((n) => n === officialFirst);
      if (!firstnameMatch) continue;
      const full = [p.firstname, p.lastname].filter(Boolean).join(" ");
      const score = jaccard(officialName, full);
      if (!best || score > best.score) {
        best = { id: p.id, name: full, score };
      }
    }
    const total = json.paging?.total ?? 1;
    if (page >= total) break;
  }
  return best;
}

const dataPath = resolvePath("data/wc2026-final-squads.json");
const raw = JSON.parse(await readFile(dataPath, "utf8"));

try {
  // ── Build apiTeamId map (once) ──────────────────────────────────────
  console.log(`Fetching API-Football team list for season ${SEASON}…`);
  const teamsJson = await apiGet(`/teams?league=1&season=${SEASON}`);
  const apiTeams = (teamsJson.response ?? []).map((r) => ({ apiId: r.team.id, name: r.team.name }));

  const localTeams = await sql`select code, name_en from public.teams order by code`;
  const apiIdByCode = new Map();
  for (const lt of localTeams) {
    const hit = apiTeams.find((t) => teamNamesEqual(t.name, lt.name_en));
    if (hit) apiIdByCode.set(lt.code, hit.apiId);
  }

  // ── Per-team patch loop ─────────────────────────────────────────────
  const summary = [];
  const teamCodes = Object.keys(raw).filter((k) => !k.startsWith("_"));
  for (const code of teamCodes) {
    if (teamArg && teamArg !== code) continue;
    const teamEntry = raw[code];
    if (teamEntry.status !== "announced") {
      summary.push({ code, status: "skip-pending", kept: 0, added: 0, removed: 0 });
      continue;
    }
    const apiTeamId = apiIdByCode.get(code);
    if (!apiTeamId) {
      console.warn(`! ${code}: no API-Football team id mapping, skipping new-player lookup`);
    }

    const currentRows = await sql`
      select api_football_id, name_en
      from public.players
      where team_code = ${code}
    `;

    const matched = []; // { officialName, position, apiFootballId, source: "db"|"api" }
    const dbRowsUsed = new Set();

    // Pass 1: match each official name against existing DB rows. We
    // require family-token match AND firstname overlap. Firstname
    // overlap is broad: officialFirst is treated as overlapping if
    // ANY DB token starts with it (length ≥ 3) — catches "Marc" vs
    // "Marc-Israel", "Sam" vs "Samuel", and the nickname map. Without
    // this guard "Diogo Costa" wrongly grabs "Samuel de Almeida Costa"
    // and Samu Costa ends up orphaned.
    for (const off of teamEntry.players) {
      const fam = familyToken(off.name, code);
      const officialNorm = norm(off.name);
      const officialTokens = officialNorm.split(" ").filter((t) => t.length >= 2);
      const officialFirst = FAMILY_FIRST_TEAMS.has(code)
        ? (officialTokens[officialTokens.length - 1] ?? "")
        : (officialTokens[0] ?? "");
      const isMonotoken = officialTokens.length === 1;
      let bestRow = null;
      for (const r of currentRows) {
        if (dbRowsUsed.has(r.api_football_id)) continue;
        const dbNorm = norm(r.name_en);
        const dbAllTokens = dbNorm.split(" ").filter((t) => t.length >= 2);
        const dbBigTokens = dbAllTokens.filter((t) => t.length >= 4);
        const famExactInDb = new RegExp(`(^|\\s|-)${fam}(\\s|$|-)`).test(dbNorm);
        const famByLev = fam.length >= 4 && dbBigTokens.some((t) => editDist(t, fam) <= 1);
        const famMatches = famExactInDb || famByLev;
        if (!famMatches) continue;
        // Firstname overlap: officialFirst must appear as a prefix of
        // some DB token (or its hyphen-split sub-token), or via the
        // nickname map. For single-token stage names ("Casemiro") the
        // family-token Lev match is enough — skip the firstname check.
        const splitOnHyphen = (t) => t.split("-").filter((s) => s.length >= 2);
        const dbExplodedTokens = dbAllTokens.flatMap(splitOnHyphen);
        const firstnameOverlap =
          isMonotoken ||
          dbExplodedTokens.some((t) => t === officialFirst) ||
          dbExplodedTokens.some((t) => officialFirst.length >= 3 && t.startsWith(officialFirst)) ||
          dbExplodedTokens.some((t) => t.length >= 3 && officialFirst.startsWith(t)) ||
          (NICKNAMES[officialFirst] ?? []).some((n) => dbExplodedTokens.includes(n)) ||
          (officialFirst.length >= 4 && dbExplodedTokens.some((t) => t.length >= 4 && editDist(t, officialFirst) <= 1));
        if (!firstnameOverlap) continue;
        const score = jaccard(officialNorm, dbNorm);
        const composite = score + 0.5 + 0.3;
        if (!bestRow || composite > bestRow.composite) {
          bestRow = { row: r, composite };
        }
      }
      if (bestRow) {
        dbRowsUsed.add(bestRow.row.api_football_id);
        matched.push({
          officialName: off.name,
          position: off.position,
          apiFootballId: bestRow.row.api_football_id,
          source: "db",
          dbNameEn: bestRow.row.name_en,
        });
      }
    }
    // Pass 2: for unmatched official names, lookup via API-Football.
    const needsLookup = teamEntry.players.filter(
      (off) => !matched.find((m) => m.officialName === off.name),
    );
    const insertRows = []; // for new players not yet in DB
    const unresolved = [];
    let roster = null;
    if (needsLookup.length > 0 && apiTeamId) {
      console.log(`    fetching API-Football season roster for ${code}…`);
      roster = await fetchTeamPlayerRoster(apiTeamId);
      console.log(`    season roster: ${roster.length} players`);
    }
    for (const off of needsLookup) {
      const overrideKey = `${code}:${off.name}`;
      const overrideId = PLAYER_ID_OVERRIDES[overrideKey];
      if (overrideId) {
        const already = matched.find((m) => m.apiFootballId === overrideId);
        if (already) continue;
        insertRows.push({
          officialName: off.name,
          position: off.position,
          apiFootballId: overrideId,
          source: "override",
          dbNameEn: `(manual override)`,
        });
        continue;
      }
      if (!apiTeamId) {
        unresolved.push(off);
        continue;
      }
      let found = lookupInRoster(roster, off.name, code);
      if (!found) {
        console.log(`    global lookup ${code} ${off.name}…`);
        found = await lookupInGlobalProfiles(off.name, code);
      }
      if (found) {
        // If we already kept a DB row for that api_football_id (e.g.,
        // the player transferred from another national team, or pass 1
        // matched a wrong official name to this DB row), skip the
        // insert and log it — usually it means pass 1 false-matched.
        const already = matched.find((m) => m.apiFootballId === found.id);
        if (already) {
          console.log(`  ! ${code} ${off.name} resolves to id=${found.id} (${found.name}) — already claimed by official "${already.officialName}". Likely pass-1 false-match. Treating as unresolved so the real player gets surfaced.`);
          unresolved.push(off);
          continue;
        }
        // If the row exists in DB but under another team_code, we'll
        // upsert it onto this team in the apply step.
        insertRows.push({
          officialName: off.name,
          position: off.position,
          apiFootballId: found.id,
          source: "api",
          dbNameEn: found.name,
        });
      } else {
        unresolved.push(off);
      }
    }

    const keepIds = new Set([
      ...matched.map((m) => m.apiFootballId),
      ...insertRows.map((m) => m.apiFootballId),
    ]);
    const deleteRows = currentRows.filter((r) => !keepIds.has(r.api_football_id));

    // ── Report ────────────────────────────────────────────────────────
    console.log(`\n=== ${code} (${matched.length}+${insertRows.length} keep, ${deleteRows.length} delete, ${unresolved.length} unresolved) ===`);
    for (const r of deleteRows) {
      console.log(`  - delete  ${String(r.api_football_id).padEnd(7)}  ${r.name_en}`);
    }
    for (const m of insertRows) {
      console.log(`  + insert  ${String(m.apiFootballId).padEnd(7)}  ${m.officialName.padEnd(34)} (api: ${m.dbNameEn})`);
    }
    if (unresolved.length > 0) {
      for (const u of unresolved) {
        console.log(`  ? UNRESOLVED ${u.position}  ${u.name}`);
      }
    }

    summary.push({
      code,
      status: "patched",
      kept: matched.length,
      added: insertRows.length,
      removed: deleteRows.length,
      unresolved: unresolved.length,
    });

    // ── Apply ─────────────────────────────────────────────────────────
    if (isApply) {
      await sql.begin(async (tx) => {
        for (const ins of insertRows) {
          await tx`
            insert into public.players (api_football_id, team_code, name_en, position)
            values (${ins.apiFootballId}, ${code}, ${ins.officialName}, ${ins.position})
            on conflict (api_football_id) do update set
              team_code = excluded.team_code,
              name_en   = excluded.name_en,
              position  = excluded.position,
              updated_at = now()
          `;
        }
        if (deleteRows.length > 0) {
          const ids = deleteRows.map((r) => r.api_football_id);
          await tx`
            delete from public.players
            where team_code = ${code}
              and api_football_id = any(${ids})
          `;
        }
      });
      console.log(`  ✓ applied`);
    }
  }

  console.log("\n=== SUMMARY ===");
  for (const s of summary) {
    if (s.status === "skip-pending") {
      console.log(`  ${s.code}  (pending — not yet announced)`);
    } else {
      const flag = s.unresolved > 0 ? `  ? ${s.unresolved} unresolved` : "";
      console.log(`  ${s.code}  keep=${s.kept}+${s.added}  delete=${s.removed}${flag}`);
    }
  }
  console.log(isDry ? "\nDRY RUN — no DB writes made." : "\nApplied to DB.");
} finally {
  await sql.end();
}
