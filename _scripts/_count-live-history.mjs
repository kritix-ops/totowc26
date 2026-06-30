import postgres from "postgres";
import { readFileSync } from "node:fs";

// read DATABASE_URL from .env.local without printing it
const env = readFileSync(".env.local", "utf8");
const m = env.match(/^DATABASE_URL=(.*)$/m);
const url = m[1].trim().replace(/^["']|["']$/g, "");
const sql = postgres(url, { max: 1 });

const byScopeStatus = await sql`
  select scope, status, count(*)::int as n
  from custom_bets
  group by scope, status
  order by scope, status`;

const liveGraded = await sql`
  select count(*)::int as n
  from custom_bets
  where scope in ('match','day') and status = 'graded'`;

const picks = await sql`
  select count(*)::int as n, count(*) filter (where was_correct) ::int as correct
  from user_custom_bet_picks p
  join custom_bets b on b.id = p.custom_bet_id
  where b.scope in ('match','day') and b.status = 'graded'`;

console.log("=== custom_bets by scope/status ===");
console.table(byScopeStatus);
console.log("=== live (match/day) graded bets ===", liveGraded[0].n);
console.log("=== picks on graded live bets ===", picks[0], "hit-rate:",
  picks[0].n ? (picks[0].correct / picks[0].n * 100).toFixed(1) + "%" : "n/a");

await sql.end();
