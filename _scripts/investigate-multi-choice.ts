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
  console.log("=== Multi-choice custom bets ===");
  const cbs = (await rest(
    "custom_bets?answer_type=eq.multi_choice&select=*&order=created_at.desc&limit=30",
  )) as any[];
  for (const cb of cbs) {
    console.log(`\n--- ${cb.id} (${cb.scope}/${cb.status}) ${cb.match_id ? "match=" + cb.match_id.slice(0, 8) : ""} ---`);
    console.log(`  q_he:  ${cb.question_he}`);
    console.log(`  q_en:  ${cb.question_en}`);
    console.log(`  config: ${JSON.stringify(cb.answer_config)}`);
    console.log(`  canonical: ${JSON.stringify(cb.answer_canonical)}`);
    console.log(`  created: ${cb.created_at}`);
  }

  console.log("\n\n=== Recent user_custom_bet_picks - look at multi_choice answers ===");
  const picks = (await rest(
    "user_custom_bet_picks?select=id,user_id,custom_bet_id,answer,stake_paid,created_at,updated_at&order=updated_at.desc&limit=50",
  )) as any[];
  for (const p of picks) {
    const a = p.answer;
    if (a && a.type === "multi_choice") {
      console.log(`  user=${p.user_id.slice(0, 8)} bet=${p.custom_bet_id.slice(0, 8)} answer=${JSON.stringify(a)} created=${p.created_at} updated=${p.updated_at}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
