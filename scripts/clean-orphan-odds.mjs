#!/usr/bin/env node
// Delete outright_odds_snapshot rows whose option_id no longer exists in
// the players table (orphaned by the squad patch). Same for team rows
// that don't exist as a team — though that case is rare.
//
// Usage:
//   node --env-file=.env.local scripts/clean-orphan-odds.mjs --dry-run
//   node --env-file=.env.local scripts/clean-orphan-odds.mjs --apply
import postgres from "postgres";

const url = process.env.DIRECT_URL;
if (!url) { console.error("DIRECT_URL missing"); process.exit(1); }
const isDry = process.argv.includes("--dry-run");
const isApply = process.argv.includes("--apply");
if (!isDry && !isApply) { console.error("--dry-run or --apply"); process.exit(1); }

const sql = postgres(url, { max: 1, prepare: false });
try {
  // Players: option_id refers to api_football_id
  const orphanPlayers = await sql`
    select s.surface, s.option_id, s.display_name, s.decimal_odds
    from public.outright_odds_snapshot s
    where s.option_kind = 'player'
      and not exists (
        select 1 from public.players p where p.api_football_id = s.option_id
      )
    order by s.surface, s.decimal_odds
  `;
  console.log(`Orphan player rows: ${orphanPlayers.length}`);
  for (const r of orphanPlayers) {
    console.log(`  ${r.surface.padEnd(12)}  ${r.option_id}  ${r.display_name}  odds=${r.decimal_odds}`);
  }
  // Teams: option_id refers to api_football_team_id
  const orphanTeams = await sql`
    select s.surface, s.option_id, s.display_name, s.decimal_odds
    from public.outright_odds_snapshot s
    where s.option_kind = 'team'
      and not exists (
        select 1 from public.teams t where t.api_football_team_id = s.option_id
      )
    order by s.surface, s.decimal_odds
  `;
  console.log(`\nOrphan team rows: ${orphanTeams.length}`);
  for (const r of orphanTeams) {
    console.log(`  ${r.surface.padEnd(12)}  ${r.option_id}  ${r.display_name}  odds=${r.decimal_odds}`);
  }

  if (isApply) {
    const a = await sql`
      delete from public.outright_odds_snapshot s
      where s.option_kind = 'player'
        and not exists (select 1 from public.players p where p.api_football_id = s.option_id)
    `;
    const b = await sql`
      delete from public.outright_odds_snapshot s
      where s.option_kind = 'team'
        and not exists (select 1 from public.teams t where t.api_football_team_id = s.option_id)
    `;
    console.log(`\nDeleted ${a.count ?? 0} orphan player rows, ${b.count ?? 0} orphan team rows.`);
  } else {
    console.log("\nDry-run only — no rows deleted.");
  }
} finally {
  await sql.end();
}
