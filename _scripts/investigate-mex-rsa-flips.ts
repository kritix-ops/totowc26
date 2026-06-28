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
  // ALL audits ever
  const audits = (await rest(
    "bet_admin_audit?select=*&order=created_at.desc&limit=5000",
  )) as any[];
  console.log(`Total audits: ${audits.length}`);

  // Find any where before or after contains MEX or RSA
  const mexRsaFlips = audits.filter((a) => {
    const beforeJson = JSON.stringify(a.before ?? {});
    const afterJson = JSON.stringify(a.after ?? {});
    return /MEX|RSA|SAF/.test(beforeJson + afterJson);
  });
  console.log(`\nAudits touching MEX/RSA/SAF: ${mexRsaFlips.length}`);
  for (const a of mexRsaFlips) {
    console.log(`  ${a.created_at} admin=${a.admin_id?.slice(0, 8)} target=${a.target_user_id?.slice(0, 8)} bet=${a.custom_bet_id?.slice(0, 8)}`);
    console.log(`    before=${JSON.stringify(a.before)}`);
    console.log(`    after=${JSON.stringify(a.after)}`);
    console.log(`    reason=${a.reason}`);
  }

  // Bonus: any match-pick audits
  const matchAudits = audits.filter((a) => a.surface === "match");
  console.log(`\nMatch-pick audits: ${matchAudits.length}`);
  for (const a of matchAudits) {
    console.log(`  ${a.created_at} admin=${a.admin_id?.slice(0, 8)} target=${a.target_user_id?.slice(0, 8)} match=${a.match_id?.slice(0, 8)}`);
    console.log(`    before=${JSON.stringify(a.before)} after=${JSON.stringify(a.after)} reason=${a.reason}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
