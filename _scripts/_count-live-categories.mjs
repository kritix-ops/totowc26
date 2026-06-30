import postgres from "postgres";
import { readFileSync } from "node:fs";
const env = readFileSync(".env.local", "utf8");
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g, "");
const sql = postgres(url, { max: 1 });

const cats = [
  ["offside/נבדל", "(נבדל|offside)"],
  ["red card/אדום", "(אדום|red card)"],
  ["yellow/צהוב", "(צהוב|yellow|card)"],
  ["VAR", "(VAR|var)"],
  ["corner/קרן", "(קרן|קרנות|corner)"],
  ["penalty/פנדל", "(פנדל|penalty|נקודת)"],
  ["goal/שער", "(שער|גול|goal)"],
  ["both score/שתי", "(שתי הקבוצות|both teams)"],
];

for (const [name, rx] of cats) {
  const r = await sql`
    select count(*)::int as bets,
           coalesce(sum(pc.n),0)::int as picks,
           coalesce(sum(pc.correct),0)::int as correct
    from custom_bets b
    left join lateral (
      select count(*)::int as n, count(*) filter (where was_correct)::int as correct
      from user_custom_bet_picks where custom_bet_id = b.id
    ) pc on true
    where b.scope in ('match','day') and b.status='graded'
      and (b.question_he ~* ${rx} or b.question_en ~* ${rx})`;
  const row = r[0];
  const hr = row.picks ? (row.correct/row.picks*100).toFixed(0)+"%" : "n/a";
  console.log(`${name.padEnd(18)} bets=${String(row.bets).padStart(3)}  picks=${String(row.picks).padStart(4)}  hit=${hr}`);
}

const byType = await sql`
  select answer_type, count(*)::int as n
  from custom_bets where scope in ('match','day') and status='graded'
  group by answer_type order by n desc`;
console.log("\nby answer_type:", byType);
await sql.end();
