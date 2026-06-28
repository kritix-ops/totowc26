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
  const ids = [
    "79f8211b-faf0-4b44-a8f5-d2e58c11bf20",
    "3ba57e2b-dec8-47a9-b410-27b2a7403208",
    "63d40c1f-0e37-43f1-99c3-7af5906ec553",
    "dc8743cc-e4ca-49e6-8963-73139b403aae",
    "3c98c798-e4e7-4f48-a563-1856611be974",
    "b9736943-e96e-4906-a248-5dc090af9fbc",
    "39d25281-1934-448e-a203-de052b0ce93b",
    "31b16249-cb56-45fc-8b5c-7bf3b20fa914",
    "f5c27caf-d2c3-4386-b416-825d1bf6a07a",
  ];
  const cbs = (await rest(
    `custom_bets?id=in.(${ids.join(",")})&select=id,question_he,question_en,scope,status,lock_at,match_id,matchday_id`,
  )) as any[];
  console.log("Custom bets details:");
  for (const cb of cbs) {
    console.log(
      `  id=${cb.id.slice(0, 8)} scope=${cb.scope} status=${cb.status} lock_at=${cb.lock_at}\n    Q: ${cb.question_he}`,
    );
  }

  // Also look at picks history grouped by bet and user
  console.log("\n\nUser ca739ad5 picks today:");
  const ca = (await rest(
    `user_custom_bet_picks?user_id=eq.ca739ad5-0817-4b7f-bccc-5b3ec1c4f7ee&select=*&order=created_at.desc&limit=30`,
  ).catch(() => [])) as any[];
  for (const p of ca) {
    console.log(`  bet=${p.custom_bet_id.slice(0, 8)} answer=${JSON.stringify(p.answer)} created=${p.created_at} updated=${p.updated_at}`);
  }

  console.log("\n\nUser be48f302 picks today:");
  // be48f302 partial id... let's look up full id
  const matches = (await rest(
    `user_custom_bet_picks?user_id=like.be48f302*&select=*&order=created_at.desc&limit=30`,
  ).catch(() => [])) as any[];
  for (const p of matches) {
    console.log(`  bet=${p.custom_bet_id.slice(0, 8)} answer=${JSON.stringify(p.answer)} created=${p.created_at} updated=${p.updated_at}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
