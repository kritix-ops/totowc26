import postgres from "postgres";
import { readFileSync } from "node:fs";
const env = readFileSync(".env.local", "utf8"); // PROD (read-only) — has the data
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g, "");
const sql = postgres(url, { max: 1 });

// EXACT projection from getLiveBetCategoryHistory
const rows = await sql`
  select null as category, b.question_he as "questionHe", b.question_en as "questionEn",
         b.grading_config as grading,
         count(p.id)::int as picks,
         count(p.id) filter (where p.was_correct)::int as correct,
         coalesce(sum(p.stake_paid),0)::int as staked,
         coalesce(sum(p.points_earned),0)::int as returned
  from public.custom_bets b
  left join public.user_custom_bet_picks p on p.custom_bet_id = b.id
  where b.scope in ('match','day') and b.status='graded'
  group by b.id`;

// mirror classifyLiveBetCategory
function fromGrading(g){ if(!g) return null;
  const m=(g.events&&g.events.metric)||(g.firstEventWindow&&g.firstEventWindow.metric)||null;
  if(m==='red_card')return'red'; if(m==='yellow_card')return'yellow'; if(m==='goal')return'goals'; if(m==='penalty')return'penalty';
  if(g.stat==='offsides')return'offside'; if(g.stat==='corners')return'corner'; if(g.stat==='yellow_cards')return'yellow'; if(g.stat==='red_cards')return'red';
  if(g.field==='btts')return'btts'; if(g.field&&(g.field.includes('goal')||g.field==='total_goals'))return'goals'; return null; }
const RULES=[['offside',['נבדל','offside']],['var',['var']],['btts',['שתי הקבוצות','both teams']],['penalty',['פנדל','penalty']],['red',['אדום','red card']],['yellow',['צהוב','yellow']],['corner',['קרן','קרנות','corner']],['goals',['שער','גול','goal','יבקיע','כובש','כיבוש']]];
function classify(r){ if(r.category)return r.category; const fg=fromGrading(r.grading); if(fg)return fg;
  const h=`${r.questionHe||''} ${r.questionEn||''}`.toLowerCase(); for(const[c,t]of RULES)if(t.some(x=>h.includes(x)))return c; return 'other'; }

const acc={};
for(const r of rows){ const c=classify(r); (acc[c]??=(acc[c]={bets:0,picks:0,correct:0,staked:0,returned:0})); const a=acc[c];
  a.bets++; a.picks+=r.picks; a.correct+=r.correct; a.staked+=r.staked; a.returned+=r.returned; }

console.log("cat        bets picks   EV%   hit%");
for(const[c,a]of Object.entries(acc).sort((x,y)=>y[1].picks-x[1].picks)){
  const ev=a.staked?((a.returned-a.staked)/a.staked*100).toFixed(1):'n/a';
  const hit=a.picks?(a.correct/a.picks*100).toFixed(0):'n/a';
  console.log(`${c.padEnd(10)} ${String(a.bets).padStart(3)} ${String(a.picks).padStart(5)} ${String(ev).padStart(6)} ${String(hit).padStart(5)}`);
}
await sql.end();
