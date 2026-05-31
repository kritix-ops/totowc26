import { readFile } from "node:fs/promises";
import postgres from "postgres";
const sql = postgres(process.env.DIRECT_URL, { max: 1, prepare: false });
// Parse the dry-run log for insert IDs and their target team_codes.
const log = await readFile("_plans/dry-run-v8.log", "utf8");
const lines = log.split("\n");
let currentTeam = null;
const inserts = []; // { team, id }
for (const line of lines) {
  const teamMatch = line.match(/^=== (\w{3}) /);
  if (teamMatch) currentTeam = teamMatch[1];
  const insMatch = line.match(/^  \+ insert\s+(\d+)/);
  if (insMatch && currentTeam) inserts.push({ team: currentTeam, id: Number(insMatch[1]) });
}
console.log(`Total inserts: ${inserts.length}`);
const conflicts = [];
for (const ins of inserts) {
  const r = (await sql`select team_code, name_en from public.players where api_football_id = ${ins.id}`)[0];
  if (r && r.team_code !== ins.team) {
    conflicts.push({ id: ins.id, dbTeam: r.team_code, targetTeam: ins.team, name: r.name_en });
  }
}
console.log(`Cross-team conflicts: ${conflicts.length}`);
for (const c of conflicts) {
  console.log(`  ${c.id} currently ${c.dbTeam} '${c.name}' → being moved to ${c.targetTeam}`);
}
await sql.end();
