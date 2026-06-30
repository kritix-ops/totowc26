import postgres from "postgres";
import { readFileSync } from "node:fs";
const env = readFileSync(".env.local", "utf8");
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g, "");
const sql = postgres(url, { max: 1 });

const r = await sql`
  select
    count(*)::int total,
    count(*) filter (where resolved_value is not null)::int has_resolved,
    count(*) filter (where decimal_odds is not null)::int has_top_odds,
    count(*) filter (where answer_config ? 'decimalOddsByValue')::int has_mc_odds,
    count(*) filter (where answer_config ? 'decimalOddsYes' or answer_config ? 'decimalOddsNo')::int has_yn_odds,
    count(*) filter (where answer_type='yes_no')::int yn,
    count(*) filter (where answer_type='multi_choice')::int mc
  from custom_bets
  where scope in ('match','day') and status='graded'`;
console.log("graded live bets:", r[0]);

// sample a few to see shape of resolved_value + odds
const sample = await sql`
  select answer_type,
         decimal_odds,
         answer_config->'decimalOddsYes' as yes_odds,
         answer_config->'decimalOddsNo' as no_odds,
         answer_config->'decimalOddsByValue' as mc_odds,
         resolved_value
  from custom_bets
  where scope in ('match','day') and status='graded' and resolved_value is not null
  limit 6`;
console.log("\nsamples:");
for (const s of sample) console.log(JSON.stringify(s));
await sql.end();
