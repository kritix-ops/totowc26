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
  // Look at bet_grading_audit history
  const audits = (await rest(
    "bet_grading_audit?order=created_at.desc&limit=30&select=*",
  ).catch((e) => { console.error(e); return []; })) as any[];
  console.log(`bet_grading_audit rows: ${audits.length}`);
  for (const a of audits) {
    console.log(JSON.stringify(a, null, 2));
  }

  // Check user_custom_bet_picks created at exact same time across multiple users -
  // a sign of a bulk re-write
  const recent = (await rest(
    "user_custom_bet_picks?updated_at=gte.2026-06-11T18:00:00&select=user_id,custom_bet_id,answer,created_at,updated_at&order=updated_at.asc&limit=200",
  )) as any[];
  console.log(`\nRecent picks since 18:00 UTC: ${recent.length}`);

  // Group by custom_bet_id and count
  const groups = new Map<string, any[]>();
  for (const p of recent) {
    const arr = groups.get(p.custom_bet_id) ?? [];
    arr.push(p);
    groups.set(p.custom_bet_id, arr);
  }
  console.log("\nPer-bet recent activity:");
  for (const [id, arr] of groups) {
    console.log(`  ${id}: ${arr.length} picks`);
  }

  // Check sync_runs that updated 'updated' value
  console.log("\nLooking at picks with updated_at != created_at...");
  const editPattern = recent.filter((p) => p.created_at !== p.updated_at);
  console.log(`  ${editPattern.length} picks have updated_at != created_at`);
  for (const p of editPattern.slice(0, 20)) {
    console.log(`    user=${p.user_id.slice(0, 8)} bet=${p.custom_bet_id.slice(0, 8)} answer=${JSON.stringify(p.answer)} created=${p.created_at} updated=${p.updated_at}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
