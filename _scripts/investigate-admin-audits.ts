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
  // All admin audits
  console.log("=== All bet_admin_audit rows ===");
  const audits = (await rest(
    "bet_admin_audit?select=*&order=created_at.desc&limit=200",
  ).catch((e) => { console.error(e); return []; })) as any[];
  console.log(`Total: ${audits.length}`);
  for (const a of audits.slice(0, 30)) {
    console.log(`  ${a.created_at} admin=${a.admin_id?.slice(0, 8)} target=${a.target_user_id?.slice(0, 8)} action=${a.action} surface=${a.surface} bet=${a.custom_bet_id?.slice(0, 8) ?? a.match_id?.slice(0, 8)} bypass=${a.lock_bypassed}`);
    console.log(`     before=${JSON.stringify(a.before)}  after=${JSON.stringify(a.after)}`);
    console.log(`     reason=${a.reason}`);
  }

  // Look at all profiles to see if be48f302 / ca739ad5 are admins
  console.log("\n=== Profiles of those users ===");
  const profiles = (await rest(
    "profiles?display_name=not.is.null&select=id,display_name,role,is_bot&limit=200",
  )) as any[];
  const adminLike = profiles.filter((p) => p.role !== "player");
  console.log(`Found ${adminLike.length} non-player profiles:`);
  for (const p of adminLike) {
    console.log(`  ${p.id.slice(0, 8)} ${p.display_name} role=${p.role} bot=${p.is_bot}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
