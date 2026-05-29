#!/usr/bin/env node
// Bulk-ingest outright bookmaker odds into outright_odds_snapshot.
//
// What it does:
//   1. Reads a JSON file (path passed as the only positional arg) with
//      shape:
//        [
//          {
//            "surface": "top_scorer",          // see SURFACES below
//            "rows": [
//              { "name": "Kylian Mbappé",  "decimal_odds": 7.0,  "notes": "" },
//              { "name": "Harry Kane",      "decimal_odds": 8.0 },
//              ...
//            ]
//          },
//          { "surface": "group_A", "rows": [ ... ] },
//          ...
//        ]
//   2. Resolves each row's `name` to an api_football_id by querying the
//      local `players` table (for top_scorer / golden_ball) or `teams`
//      table (everything else). Match is case- and accent-insensitive.
//   3. Upserts into `outright_odds_snapshot` keyed by (surface,
//      option_kind, option_id). Rows where `admin_override = true` are
//      preserved — they keep their existing decimal_odds and notes.
//   4. Prints a summary of matched/unmatched rows per surface so the
//      operator can fix the JSON for any unmatched name (typically a
//      spelling variant Oddschecker uses vs API-Football).
//
// Why JSON-in rather than a Playwright scraper of Oddschecker:
//   Oddschecker is a JS-heavy page; selectors break the moment they
//   tweak their UI. The JSON contract here is stable — the admin can
//   feed it from whichever source they trust (manual paste, their own
//   scraper, the admin UI we ship next). One reliable ingestion path,
//   many possible input paths.
//
// Idempotent: re-running with the same JSON is a no-op. Re-running with
// updated odds overwrites the non-admin-override rows.
//
// Usage:
//   node --env-file=.env.local scripts/ingest-outright-odds.mjs path/to/odds.json
//
// Required env:
//   DIRECT_URL   - Supabase direct connection string

import { readFile } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import postgres from "postgres";

const SURFACES = new Set([
  "top_scorer",
  "golden_ball",
  "champion",
  "runner_up",
  "third",
  "group_A",
  "group_B",
  "group_C",
  "group_D",
  "group_E",
  "group_F",
  "group_G",
  "group_H",
  "group_I",
  "group_J",
  "group_K",
  "group_L",
]);

const PLAYER_SURFACES = new Set(["top_scorer", "golden_ball"]);

const url = process.env.DIRECT_URL;
if (!url) {
  console.error("DIRECT_URL is not set. Pass --env-file=.env.local.");
  process.exit(1);
}

const inputPath = process.argv[2];
if (!inputPath) {
  console.error(
    "Usage: node scripts/ingest-outright-odds.mjs <path-to-odds.json>",
  );
  process.exit(1);
}

const absPath = resolvePath(process.cwd(), inputPath);
const raw = await readFile(absPath, "utf8");
let payload;
try {
  payload = JSON.parse(raw);
} catch (err) {
  console.error(`[ingest] failed to parse JSON: ${err.message}`);
  process.exit(1);
}

if (!Array.isArray(payload)) {
  console.error("[ingest] top-level JSON must be an array of surfaces.");
  process.exit(1);
}

const sql = postgres(url, { prepare: false });

try {
  // Pre-load the option indices once. ~1,400 rows total - cheap.
  const players = await sql`
    select api_football_id, name_en, name_he
    from players
    where api_football_id is not null
  `;
  const teams = await sql`
    select api_football_team_id, name_en, name_he
    from teams
    where api_football_team_id is not null
  `;

  const playerIndex = buildIndex(
    players.map((p) => ({
      id: Number(p.api_football_id),
      names: [p.name_en, p.name_he].filter(Boolean),
    })),
  );
  const teamIndex = buildIndex(
    teams.map((t) => ({
      id: Number(t.api_football_team_id),
      names: [t.name_en, t.name_he].filter(Boolean),
    })),
  );

  const summary = {
    surfaces_ok: 0,
    surfaces_failed: 0,
    rows_upserted: 0,
    rows_preserved_due_to_override: 0,
    rows_unmatched: 0,
  };

  for (const block of payload) {
    const { surface, rows } = block ?? {};
    if (!SURFACES.has(surface)) {
      console.warn(`[ingest skip] surface=${surface} not recognised`);
      summary.surfaces_failed += 1;
      continue;
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      console.warn(`[ingest skip] surface=${surface} has no rows`);
      summary.surfaces_failed += 1;
      continue;
    }
    const optionKind = PLAYER_SURFACES.has(surface) ? "player" : "team";
    const index = optionKind === "player" ? playerIndex : teamIndex;

    let matched = 0;
    let unmatched = 0;
    let upserted = 0;
    let preserved = 0;

    for (const row of rows) {
      const name = String(row?.name ?? "").trim();
      const dec = Number(row?.decimal_odds);
      const notes = row?.notes ? String(row.notes) : null;

      if (!name || !Number.isFinite(dec) || dec <= 1.0 || dec > 1000.0) {
        console.warn(
          `[ingest invalid row] surface=${surface} name=${name} odds=${dec}`,
        );
        unmatched += 1;
        continue;
      }

      const match = lookup(index, name);
      if (!match) {
        console.warn(
          `[ingest unmatched] surface=${surface} name="${name}" — no ${optionKind} found`,
        );
        unmatched += 1;
        continue;
      }
      matched += 1;

      const existing = await sql`
        select id, admin_override
        from outright_odds_snapshot
        where surface = ${surface}
          and option_kind = ${optionKind}
          and option_id = ${match.id}
        limit 1
      `;
      const existingRow = existing[0];

      if (existingRow?.admin_override) {
        preserved += 1;
        continue;
      }

      if (existingRow) {
        await sql`
          update outright_odds_snapshot
          set decimal_odds = ${dec},
              display_name = ${match.canonical},
              source = 'oddschecker',
              fetched_at = now(),
              notes = ${notes}
          where id = ${existingRow.id}
        `;
      } else {
        await sql`
          insert into outright_odds_snapshot
            (surface, option_kind, option_id, display_name,
             decimal_odds, source, notes)
          values
            (${surface}, ${optionKind}, ${match.id}, ${match.canonical},
             ${dec}, 'oddschecker', ${notes})
        `;
      }
      upserted += 1;
    }

    console.info("[ingest summary]", {
      surface,
      matched,
      unmatched,
      upserted,
      preserved,
    });
    summary.surfaces_ok += 1;
    summary.rows_upserted += upserted;
    summary.rows_preserved_due_to_override += preserved;
    summary.rows_unmatched += unmatched;
  }

  console.info("[ingest done]", summary);
} finally {
  await sql.end({ timeout: 5 });
}

// ---------- name matching helpers ----------

function buildIndex(entities) {
  // key = normalised name → { id, canonical }. Multiple normalised
  // forms can point at the same option (e.g. "Mbappé" and "Mbappe"
  // both index to Kylian Mbappé). canonical is the first non-empty
  // display name we saw — used as the display_name on the snapshot row.
  const m = new Map();
  for (const e of entities) {
    const canonical = e.names[0];
    if (!canonical) continue;
    for (const n of e.names) {
      const k = normaliseName(n);
      if (!k) continue;
      if (!m.has(k)) m.set(k, { id: e.id, canonical });
    }
  }
  return m;
}

function lookup(index, raw) {
  const direct = index.get(normaliseName(raw));
  if (direct) return direct;
  // Lastname-only fallback: Oddschecker frequently shows just the
  // surname for well-known players ("Mbappé" rather than "Kylian
  // Mbappé"). Try the last whitespace-delimited token if direct lookup
  // failed.
  const parts = normaliseName(raw).split(" ").filter(Boolean);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    const hit = index.get(last);
    if (hit) return hit;
  }
  return null;
}

function normaliseName(s) {
  return String(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics
    .replace(/[‘’'`´]/g, "") // straight/curly apostrophes, accents
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}
