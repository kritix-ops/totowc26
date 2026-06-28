import { config } from "dotenv";
config({ path: ".env.local" });

const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function rest(path: string) {
  const r = await fetch(`${supaUrl}/rest/v1/${path}`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} on ${path}: ${await r.text()}`);
  return r.json();
}

async function main() {
  // 1. Find all public tables
  console.log("=== Public tables ===");
  const tables = await rest(
    "?select=*&limit=1",
  ).catch(() => null);

  // 2. Look at sync_runs for anything that might have swapped home/away
  console.log("\n=== Recent sync_runs ===");
  const syncRuns = (await rest(
    "sync_runs?order=started_at.desc&limit=10&select=*",
  ).catch((e) => { console.error("sync_runs err:", e.message); return []; })) as any[];
  for (const r of syncRuns) {
    console.log(`  ${r.started_at} src=${r.source} status=${r.status} fetched=${r.fetched} inserted=${r.inserted} updated=${r.updated}`);
  }

  // 3. Look at bet_admin_audit for any clearing/setting around MEX-RSA
  const matchId = "75ed52a9-d3c7-4e12-bdd4-f9b18e2b54df";
  console.log("\n=== Admin audits for MEX-RSA ===");
  const audits = (await rest(
    `bet_admin_audit?match_id=eq.${matchId}&select=*&order=created_at.desc`,
  ).catch((e) => { console.error("bet_admin_audit err:", e.message); return []; })) as any[];
  for (const a of audits) {
    console.log(JSON.stringify(a, null, 2));
  }

  // 4. Look at the recent bets — sort by updated_at desc for clues
  console.log("\n=== Match bets on MEX-RSA, recently updated ===");
  const bets = (await rest(
    `match_bets?match_id=eq.${matchId}&select=user_id,home_score,away_score,created_at,updated_at&order=updated_at.desc&limit=50`,
  )) as any[];
  for (const b of bets) {
    const dirty = b.created_at !== b.updated_at;
    console.log(`  user=${b.user_id.slice(0, 8)} ${b.home_score}-${b.away_score} created=${b.created_at} updated=${b.updated_at} ${dirty ? "*EDITED" : ""}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
