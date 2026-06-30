import postgres from "postgres";
import { readFileSync } from "node:fs";
const env = readFileSync(".env.local", "utf8");
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g, "");
const sql = postgres(url, { max: 1 });

const cats = [
  ["offside/נבדל", "(נבדל|offside)"],
  ["red card/אדום", "(אדום|red card)"],
  ["yellow/צהוב", "(צהוב|yellow)"],
  ["corner/קרן", "(קרן|קרנות|corner)"],
  ["penalty/פנדל", "(פנדל|penalty)"],
  ["goals/שער", "(שער|גול|goal)"],
  ["BTTS/שתי", "(שתי הקבוצות|both teams)"],
];

console.log("cat                 picks  staked  returned   net   EV%   avgOdds");
for (const [name, rx] of cats) {
  const r = await sql`
    select count(*)::int picks,
           coalesce(sum(p.stake_paid),0)::int staked,
           coalesce(sum(p.points_earned),0)::int returned,
           avg(b.decimal_odds)::float avg_odds
    from user_custom_bet_picks p
    join custom_bets b on b.id = p.custom_bet_id
    where b.scope in ('match','day') and b.status='graded'
      and (b.question_he ~* ${rx} or b.question_en ~* ${rx})`;
  const x = r[0];
  const net = x.returned - x.staked;
  const ev = x.staked ? (net / x.staked * 100).toFixed(1) : "n/a";
  const odds = x.avg_odds ? x.avg_odds.toFixed(2) : "n/a";
  console.log(`${name.padEnd(18)} ${String(x.picks).padStart(5)} ${String(x.staked).padStart(7)} ${String(x.returned).padStart(9)} ${String(net).padStart(6)} ${String(ev).padStart(6)} ${String(odds).padStart(8)}`);
}

const all = await sql`
  select count(*)::int picks, coalesce(sum(stake_paid),0)::int staked,
         coalesce(sum(points_earned),0)::int returned
  from user_custom_bet_picks p join custom_bets b on b.id=p.custom_bet_id
  where b.scope in ('match','day') and b.status='graded'`;
const a = all[0];
console.log(`\nALL LIVE           ${String(a.picks).padStart(5)} ${String(a.staked).padStart(7)} ${String(a.returned).padStart(9)} ${String(a.returned-a.staked).padStart(6)} ${String((( a.returned-a.staked)/a.staked*100).toFixed(1)).padStart(6)}`);
await sql.end();
