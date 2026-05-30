#!/usr/bin/env node
// Derives runner_up + third + 12 group_winner surfaces from the
// champion outright that's already in outright_odds_snapshot.
//
// runner_up and third use historical multipliers on the champion's
// decimal odds:
//   D_runner = D_champion × 1.67  (P(2nd) ≈ P(1st) × 0.6)
//   D_third  = D_champion × 2.5   (P(3rd) ≈ P(1st) × 0.4)
// These are coarse heuristics that mirror what bookmakers price when
// they offer "to finish 2nd" / "to finish 3rd" outright. Admin can
// override per row in /admin/tournament-odds after the run.
//
// For each of the 12 groups we take the four teams in that group,
// read each team's CHAMPION decimal_odds (or fall back to a baseline
// 200.0 if the team is too weak to have appeared on the champion
// board), convert to implied probability, normalise across the group
// to get each team's chance of WINNING THE GROUP, and emit a
// decimal_odds back with a 5% house edge.
//
// admin_override = true rows are PRESERVED — they keep whatever the
// admin manually entered.
//
// Idempotent: re-running overwrites only the rows we wrote previously.
//
// Usage:
//   node --env-file=.env.local scripts/derive-outright-odds.mjs

import postgres from "postgres";

const url = process.env.DIRECT_URL;
if (!url) {
  console.error("DIRECT_URL is not set. Pass --env-file=.env.local.");
  process.exit(1);
}

const RUNNER_UP_MULT = 1.67;
const THIRD_MULT = 2.5;
const GROUP_HOUSE_EDGE = 0.05;
const BASELINE_DECIMAL = 200.0;

const sql = postgres(url, { prepare: false });

try {
  // ---------- Champion → runner_up + third ----------

  const championRows = await sql`
    select option_id, display_name, decimal_odds, admin_override
    from outright_odds_snapshot
    where surface = 'champion' and option_kind = 'team'
  `;
  console.info(`[derive] champion source rows: ${championRows.length}`);

  let runnerUpWritten = 0;
  let runnerUpPreserved = 0;
  let thirdWritten = 0;
  let thirdPreserved = 0;

  for (const row of championRows) {
    const champDec = Number(row.decimal_odds);
    if (!Number.isFinite(champDec) || champDec <= 1) continue;
    const runnerDec = Math.min(900, champDec * RUNNER_UP_MULT);
    const thirdDec = Math.min(900, champDec * THIRD_MULT);
    runnerUpWritten += await upsertDerived(
      "runner_up",
      row.option_id,
      row.display_name,
      runnerDec,
    );
    thirdWritten += await upsertDerived(
      "third",
      row.option_id,
      row.display_name,
      thirdDec,
    );
  }
  console.info(`[derive] runner_up: ${runnerUpWritten} written`);
  console.info(`[derive] third: ${thirdWritten} written`);

  // ---------- 12 group_winner surfaces ----------

  const teams = await sql`
    select api_football_team_id as id, name_en, group_id
    from teams
    where group_id is not null and api_football_team_id is not null
    order by group_id, name_en
  `;

  // Build a quick lookup: team_id → champion decimal_odds (or null).
  const champByTeam = new Map();
  for (const row of championRows) {
    champByTeam.set(Number(row.option_id), Number(row.decimal_odds));
  }

  const byGroup = new Map();
  for (const t of teams) {
    if (!byGroup.has(t.group_id)) byGroup.set(t.group_id, []);
    byGroup.get(t.group_id).push(t);
  }

  let groupWritten = 0;
  for (const [groupId, members] of byGroup) {
    if (members.length !== 4) {
      console.warn(
        `[derive] group ${groupId} has ${members.length} teams, expected 4 — skipping`,
      );
      continue;
    }
    // implied probability per team = 1 / champion_odds, fallback baseline
    const probs = members.map((t) => {
      const d = champByTeam.get(Number(t.id)) ?? BASELINE_DECIMAL;
      return 1 / d;
    });
    const total = probs.reduce((a, b) => a + b, 0);
    const groupKey = `group_${groupId}`;
    for (let i = 0; i < members.length; i++) {
      const t = members[i];
      const winChance = probs[i] / total;
      // Apply house edge: fair odds = 1/p, then multiply by (1 - edge).
      const fairDec = 1 / winChance;
      const adjustedDec = Math.max(1.05, fairDec * (1 - GROUP_HOUSE_EDGE));
      groupWritten += await upsertDerived(
        groupKey,
        Number(t.id),
        t.name_en,
        adjustedDec,
      );
    }
  }
  console.info(`[derive] group_winners: ${groupWritten} written (across 12 groups)`);

  console.info("[derive done]", {
    runner_up: runnerUpWritten,
    third: thirdWritten,
    groups: groupWritten,
  });
} finally {
  await sql.end({ timeout: 5 });
}

// Upsert one derived row; preserves admin_override=true rows.
async function upsertDerived(surface, optionId, displayName, decimal) {
  const decStr = decimal.toFixed(3);
  const existing = await sql`
    select id, admin_override
    from outright_odds_snapshot
    where surface = ${surface} and option_kind = 'team' and option_id = ${optionId}
    limit 1
  `;
  const existingRow = existing[0];
  if (existingRow?.admin_override) {
    return 0;
  }
  if (existingRow) {
    await sql`
      update outright_odds_snapshot
      set decimal_odds = ${decStr},
          display_name = ${displayName},
          source = 'admin_manual',
          fetched_at = now(),
          notes = 'derived from champion outright'
      where id = ${existingRow.id}
    `;
  } else {
    await sql`
      insert into outright_odds_snapshot
        (surface, option_kind, option_id, display_name,
         decimal_odds, source, notes)
      values
        (${surface}, 'team', ${optionId}, ${displayName},
         ${decStr}, 'admin_manual',
         'derived from champion outright')
    `;
  }
  return 1;
}
