import postgres from "postgres";
import { readFileSync } from "node:fs";
const env = readFileSync(".env.local", "utf8");
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g, "");
const sql = postgres(url, { max: 1 });

function fromGrading(g) {
  if (!g) return null;
  const metric = (g.events && g.events.metric) || (g.firstEventWindow && g.firstEventWindow.metric) || null;
  if (metric === "red_card") return "red";
  if (metric === "yellow_card") return "yellow";
  if (metric === "goal") return "goals";
  if (metric === "penalty") return "penalty";
  if (g.stat === "offsides") return "offside";
  if (g.stat === "corners") return "corner";
  if (g.stat === "yellow_cards") return "yellow";
  if (g.stat === "red_cards") return "red";
  if (g.field === "btts") return "btts";
  if (g.field && (g.field.includes("goal") || g.field === "total_goals")) return "goals";
  return null;
}
const RULES = [
  ["offside", ["נבדל","offside"]], ["var", ["var"]],
  ["btts", ["שתי הקבוצות","both teams"]], ["penalty", ["פנדל","penalty"]],
  ["red", ["אדום","red card"]], ["yellow", ["צהוב","yellow"]],
  ["corner", ["קרן","קרנות","corner"]],
  ["goals", ["שער","גול","goal","יבקיע","כובש","כיבוש"]],
];
function classify(he, en, g) {
  const fg = fromGrading(g); if (fg) return fg;
  const h = `${he||""} ${en||""}`.toLowerCase();
  for (const [cat, terms] of RULES) if (terms.some(t => h.includes(t))) return cat;
  return "other";
}

const rows = await sql`
  select question_he, question_en, grading_config
  from custom_bets where scope in ('match','day') and status='graded'`;
const dist = {};
let viaGrading = 0;
for (const r of rows) {
  const c = classify(r.question_he, r.question_en, r.grading_config);
  dist[c] = (dist[c]||0)+1;
  if (fromGrading(r.grading_config)) viaGrading++;
}
console.log("total graded live:", rows.length);
console.log("classified via grading spec:", viaGrading, `(${(viaGrading/rows.length*100).toFixed(0)}%)`);
console.log("distribution:", Object.fromEntries(Object.entries(dist).sort((a,b)=>b[1]-a[1])));
console.log("other rate:", ((dist.other||0)/rows.length*100).toFixed(1)+"%");
await sql.end();
