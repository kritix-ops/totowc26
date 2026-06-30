import postgres from "postgres";
import { readFileSync } from "node:fs";
const env = readFileSync(".env.local", "utf8");
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g, "");
const sql = postgres(url, { max: 1 });

const cats = [
  ["offside", "(נבדל|offside)"],
  ["red card", "(אדום|red card)"],
  ["yellow", "(צהוב|yellow)"],
  ["corner", "(קרן|קרנות|corner)"],
  ["penalty", "(פנדל|penalty)"],
  ["goals", "(שער|גול|goal)"],
  ["BTTS", "(שתי הקבוצות|both teams)"],
];

console.log("yes_no calibration: priced P(yes) vs realized P(yes)");
console.log("cat        n   pricedYes  realYes   gap");
for (const [name, rx] of cats) {
  const rows = await sql`
    select (answer_config->>'decimalOddsYes')::float yo,
           (answer_config->>'decimalOddsNo')::float no,
           (resolved_value->>'value')::boolean actual
    from custom_bets
    where scope in ('match','day') and status='graded' and answer_type='yes_no'
      and answer_config ? 'decimalOddsYes' and answer_config ? 'decimalOddsNo'
      and resolved_value->>'value' is not null
      and (question_he ~* ${rx} or question_en ~* ${rx})`;
  if (!rows.length) { console.log(`${name.padEnd(10)} 0`); continue; }
  let sumPriced=0, real=0;
  for (const r of rows) {
    const iy = 1/r.yo, ino = 1/r.no;
    sumPriced += iy/(iy+ino);
    if (r.actual) real++;
  }
  const n=rows.length;
  const priced=sumPriced/n, realP=real/n;
  console.log(`${name.padEnd(10)} ${String(n).padStart(2)}   ${(priced*100).toFixed(0).padStart(6)}%   ${(realP*100).toFixed(0).padStart(5)}%  ${((realP-priced)*100>=0?'+':'')}${((realP-priced)*100).toFixed(0)}pt`);
}
await sql.end();
