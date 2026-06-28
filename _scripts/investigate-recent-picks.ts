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
  // Get the "Who wins Group A?" bet id - has MEX/RSA as options
  const grouA = (await rest(
    "custom_bets?question_en=ilike.*Group A*&select=*",
  )) as any[];
  console.log("Group A bets:");
  for (const cb of grouA) {
    console.log(`  ${cb.id} (${cb.scope}/${cb.status}) ${cb.question_en}`);
  }

  // For each, list user picks
  for (const cb of grouA) {
    console.log(`\n=== Picks on ${cb.question_he} (${cb.id}) ===`);
    const picks = (await rest(
      `user_custom_bet_picks?custom_bet_id=eq.${cb.id}&select=user_id,answer,stake_paid,payout_snapshot,created_at,updated_at&order=updated_at.desc`,
    )) as any[];
    for (const p of picks.slice(0, 60)) {
      console.log(
        `  user=${p.user_id.slice(0, 8)} answer=${JSON.stringify(p.answer)} stake=${p.stake_paid} payout=${p.payout_snapshot} created=${p.created_at} updated=${p.updated_at}`,
      );
    }
  }

  // Also: recent custom-bet picks for MEX vs RSA bets
  const matchId = "75ed52a9-d3c7-4e12-bdd4-f9b18e2b54df";
  const mexCbs = (await rest(
    `custom_bets?match_id=eq.${matchId}&select=id,question_he,question_en,answer_type`,
  )) as any[];
  for (const cb of mexCbs) {
    const picks = (await rest(
      `user_custom_bet_picks?custom_bet_id=eq.${cb.id}&select=user_id,answer,created_at,updated_at&order=updated_at.desc`,
    )) as any[];
    console.log(`\n=== ${cb.question_he} (${cb.id}) — ${picks.length} picks ===`);
    for (const p of picks.slice(0, 50)) {
      console.log(
        `  user=${p.user_id.slice(0, 8)} answer=${JSON.stringify(p.answer)} updated=${p.updated_at}`,
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
