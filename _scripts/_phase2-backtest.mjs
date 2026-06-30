// Phase 2 gate: does conditioning on CATEGORY improve outcome prediction over
// the bet's own priced probability? Read-only against prod. yes_no bets only
// (category realized P(yes) is well-defined there). Leave-one-out so a bet
// never sees its own outcome in its category prior. See
// _plans/2026-06-30-data-driven-live-bet-odds.md "Backtest gate".
import postgres from "postgres";
import { readFileSync } from "node:fs";
const env = readFileSync(".env.local", "utf8");
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g, "");
const sql = postgres(url, { max: 1 });

// classifier (mirror of classifyLiveBetCategory: grading first, then keywords)
function fromGrading(g){ if(!g) return null;
  const m=(g.events&&g.events.metric)||(g.firstEventWindow&&g.firstEventWindow.metric)||null;
  if(m==='red_card')return'red'; if(m==='yellow_card')return'yellow'; if(m==='goal')return'goals'; if(m==='penalty')return'penalty';
  if(g.stat==='offsides')return'offside'; if(g.stat==='corners')return'corner'; if(g.stat==='yellow_cards')return'yellow'; if(g.stat==='red_cards')return'red';
  if(g.field==='btts')return'btts'; if(g.field&&(g.field.includes('goal')||g.field==='total_goals'))return'goals'; return null; }
const RULES=[['offside',['נבדל','offside']],['var',['var']],['btts',['שתי הקבוצות','both teams']],['penalty',['פנדל','penalty']],['red',['אדום','red card']],['yellow',['צהוב','yellow']],['corner',['קרן','קרנות','corner']],['goals',['שער','גול','goal','יבקיע','כובש','כיבוש']]];
function classify(he,en,g){ const fg=fromGrading(g); if(fg)return fg; const h=`${he||''} ${en||''}`.toLowerCase(); for(const[c,t]of RULES)if(t.some(x=>h.includes(x)))return c; return 'other'; }

const rows = await sql`
  select question_he qh, question_en qe, grading_config g,
         (answer_config->>'decimalOddsYes')::float yo,
         (answer_config->>'decimalOddsNo')::float no,
         (resolved_value->>'value')::boolean actual
  from custom_bets
  where scope in ('match','day') and status='graded' and answer_type='yes_no'
    and answer_config ? 'decimalOddsYes' and answer_config ? 'decimalOddsNo'
    and resolved_value->>'value' is not null`;

const data = rows.map(r => {
  const iy=1/r.yo, ino=1/r.no;
  return { cat: classify(r.qh,r.qe,r.g), pPriced: iy/(iy+ino), actual: r.actual?1:0 };
}).filter(d => Number.isFinite(d.pPriced));

// category totals for leave-one-out prior
const tot = {};
for(const d of data){ (tot[d.cat]??=(tot[d.cat]={n:0,yes:0})); tot[d.cat].n++; tot[d.cat].yes+=d.actual; }

const brier = (f) => data.reduce((s,d)=>{const p=f(d); return s+(p-d.actual)**2;},0)/data.length;

const baseline = brier(d=>d.pPriced);
console.log(`n(yes_no graded) = ${data.length}`);
console.log(`baseline Brier (priced prob)      = ${baseline.toFixed(5)}`);
console.log(`\nshrinkage k | gate | candidate Brier | Δ vs baseline`);
for(const G of [12]){
  for(const k of [0,5,10,25,50,100]){
    const cand = brier(d=>{
      const t=tot[d.cat]; const nEx=t.n-1; const yesEx=t.yes-d.actual;
      if(nEx < G) return d.pPriced;                 // gate: too thin → no adjust
      const prior = yesEx/nEx;
      const w = k/(k+nEx);
      return w*d.pPriced + (1-w)*prior;
    });
    const delta = ((cand-baseline)/baseline*100);
    const mark = cand<baseline ? '  ✓ better' : '  ✗ worse';
    console.log(`${String(k).padStart(11)} | ${String(G).padStart(4)} | ${cand.toFixed(5).padStart(15)} | ${(delta>=0?'+':'')}${delta.toFixed(2)}%${mark}`);
  }
}
console.log(`\nper-category yes_no counts (n / P(yes)):`);
for(const[c,t]of Object.entries(tot).sort((a,b)=>b[1].n-a[1].n))
  console.log(`  ${c.padEnd(9)} n=${String(t.n).padStart(3)}  P(yes)=${(t.yes/t.n*100).toFixed(0)}%`);
await sql.end();
