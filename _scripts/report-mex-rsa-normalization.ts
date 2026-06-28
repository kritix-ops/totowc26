// Generates a clean Hebrew PDF report of the MEX–RSA live-bet normalisation:
// yesterday's points vs today's, per bet and per player, with the why.
//
// Data is recomputed deterministically: "yesterday" = old shared odds under
// the 100 ceiling; "today" = corrected per-side odds, no ceiling. Both use
// the same normalizeOdds the live engine uses (validated to reproduce the
// originally-stored points). Renders via Playwright + system Chrome.

import { config } from "dotenv";
config({ path: ".env.local" });
import { writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { normalizeOdds, liveStakeCap } from "../src/lib/odds-normalize";

const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const MATCH_ID = "75ed52a9-d3c7-4e12-bdd4-f9b18e2b54df";
const HOUSE_EDGE = 5;
const RATIO = 8;
const OLD_CEILING = 100;

// Old shared odds + corrected per-side odds, keyed by bet id prefix.
const BETS: Record<string, { oldOdds: number; newYes: number; newNo: number }> = {
  ac7774f0: { oldOdds: 2.1, newYes: 3, newNo: 2 }, // BTTS
  afdc73d2: { oldOdds: 2.05, newYes: 2, newNo: 2 }, // 3+ goals
  "626077a8": { oldOdds: 2.0, newYes: 2, newNo: 2 }, // 10+ corners
  a838874e: { oldOdds: 3.5, newYes: 5, newNo: 2 }, // goal before 15'
  "2f3cdf49": { oldOdds: 6.0, newYes: 6, newNo: 2 }, // VAR 1H red
  "5d6b53f1": { oldOdds: 4.0, newYes: 6, newNo: 2 }, // VAR 2H pen
  "4793c4a1": { oldOdds: 3.5, newYes: 6, newNo: 2 }, // sub scores
};

async function rest(path: string) {
  const r = await fetch(`${supaUrl}/rest/v1/${path}`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} on ${path}: ${await r.text()}`);
  return r.json();
}

const priceOld = (odds: number, stake: number) =>
  normalizeOdds(odds, {
    baseStake: stake,
    maxPayout: liveStakeCap(stake, { maxPayoutRatio: RATIO, maxPayoutCeiling: OLD_CEILING }),
    houseEdgePct: HOUSE_EDGE,
  }).payout;

const priceNew = (odds: number, stake: number) =>
  normalizeOdds(odds, {
    baseStake: stake,
    maxPayout: liveStakeCap(stake, { maxPayoutRatio: RATIO, maxPayoutCeiling: 0 }),
    houseEdgePct: HOUSE_EDGE,
  }).payout;

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function main() {
  const bets = (await rest(
    `custom_bets?match_id=eq.${MATCH_ID}&scope=eq.match&select=id,question_he,resolved_value&order=created_at.asc`,
  )) as any[];

  type Pick = {
    userId: string;
    name: string;
    isBot: boolean;
    side: "כן" | "לא";
    stake: number;
    correct: boolean;
    oldPts: number;
    newPts: number;
  };
  type BetView = {
    q: string;
    winnerSide: "כן" | "לא";
    oldOdds: number;
    newYes: number;
    newNo: number;
    winners: Pick[];
    losers: number;
    oldTotal: number;
    newTotal: number;
  };

  const betViews: BetView[] = [];
  const userOld = new Map<string, number>();
  const userNew = new Map<string, number>();
  const userMeta = new Map<string, { name: string; isBot: boolean }>();

  for (const b of bets) {
    const key = b.id.slice(0, 8);
    const conf = BETS[key];
    if (!conf) continue;
    const winnerYes = !!(b.resolved_value && b.resolved_value.value === true);

    const picks = (await rest(
      `user_custom_bet_picks?custom_bet_id=eq.${b.id}&select=user_id,answer,stake_paid,was_correct`,
    )) as any[];
    const userIds = Array.from(new Set(picks.map((p) => p.user_id)));
    const profs = (await rest(
      `profiles?id=in.(${userIds.join(",")})&select=id,display_name,is_bot`,
    )) as any[];
    const byId = new Map(profs.map((p) => [p.id, p]));

    const winners: Pick[] = [];
    let losers = 0;
    let oldTotal = 0;
    let newTotal = 0;

    for (const p of picks) {
      const pickedYes = !!(p.answer && p.answer.value === true);
      const stake = p.stake_paid;
      const oldPts = p.was_correct ? priceOld(conf.oldOdds, stake) : 0;
      const newSideOdds = pickedYes ? conf.newYes : conf.newNo;
      const newPts = p.was_correct ? priceNew(newSideOdds, stake) : 0;
      const prof = byId.get(p.user_id);
      const name = prof?.display_name ?? p.user_id.slice(0, 6);
      const isBot = !!prof?.is_bot;
      userMeta.set(p.user_id, { name, isBot });
      userOld.set(p.user_id, (userOld.get(p.user_id) ?? 0) + oldPts);
      userNew.set(p.user_id, (userNew.get(p.user_id) ?? 0) + newPts);
      oldTotal += oldPts;
      newTotal += newPts;
      if (p.was_correct) {
        winners.push({
          userId: p.user_id,
          name,
          isBot,
          side: pickedYes ? "כן" : "לא",
          stake,
          correct: true,
          oldPts,
          newPts,
        });
      } else {
        losers += 1;
      }
    }
    winners.sort((a, b) => b.oldPts - a.oldPts || b.stake - a.stake);
    betViews.push({
      q: b.question_he,
      winnerSide: winnerYes ? "כן" : "לא",
      oldOdds: conf.oldOdds,
      newYes: conf.newYes,
      newNo: conf.newNo,
      winners,
      losers,
      oldTotal,
      newTotal,
    });
  }

  // Per-user impact (exclude bot from the human leaderboard table).
  const users = Array.from(userMeta.entries())
    .map(([id, m]) => ({
      id,
      name: m.name,
      isBot: m.isBot,
      old: userOld.get(id) ?? 0,
      neu: userNew.get(id) ?? 0,
    }))
    .map((u) => ({ ...u, delta: u.neu - u.old }))
    .sort((a, b) => a.delta - b.delta);
  const humans = users.filter((u) => !u.isBot);

  const poolOld = humans.reduce((s, u) => s + u.old, 0);
  const poolNew = humans.reduce((s, u) => s + u.neu, 0);
  const poolDelta = poolNew - poolOld;

  // ---------- HTML ----------
  const oddsRows = betViews
    .map((v) => {
      const winNew = v.winnerSide === "כן" ? v.newYes : v.newNo;
      return `<tr>
        <td class="q">${esc(v.q)}</td>
        <td class="c"><span class="winchip">${v.winnerSide}</span></td>
        <td class="c num">×${v.oldOdds.toFixed(2).replace(/\.00$/, "")}</td>
        <td class="c num">×${v.newYes} / ×${v.newNo}</td>
        <td class="c num strong ${winNew < v.oldOdds ? "down" : winNew > v.oldOdds ? "up" : ""}">×${winNew}</td>
      </tr>`;
    })
    .join("");

  const betBlocks = betViews
    .filter((v) => v.winners.length > 0)
    .map((v) => {
      const changed = v.winners.filter((w) => w.newPts !== w.oldPts);
      if (changed.length === 0) {
        return `<div class="bet"><h3>${esc(v.q)}</h3>
          <p class="muted">הזוכים (${v.winners.length}) — היחס לא השתנה מהותית, התשלום נשאר זהה.</p></div>`;
      }
      const rows = v.winners
        .map((w) => {
          const d = w.newPts - w.oldPts;
          return `<tr>
            <td>${esc(w.name)}${w.isBot ? ' <span class="bot">בוט</span>' : ""}</td>
            <td class="c">${w.side}</td>
            <td class="c num">${w.stake}</td>
            <td class="c num">${w.oldPts}</td>
            <td class="c num strong">${w.newPts}</td>
            <td class="c num ${d < 0 ? "down" : d > 0 ? "up" : "muted"}">${d > 0 ? "+" : ""}${d}</td>
          </tr>`;
        })
        .join("");
      return `<div class="bet">
        <h3>${esc(v.q)} <span class="winchip sm">זכה: ${v.winnerSide}</span></h3>
        <table class="grid">
          <thead><tr><th>שחקן</th><th class="c">בחירה</th><th class="c">סיכון</th><th class="c">אתמול</th><th class="c">היום</th><th class="c">שינוי</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr><td colspan="3">סה״כ להימור (${v.winners.length} זוכים)</td><td class="c num">${v.oldTotal}</td><td class="c num strong">${v.newTotal}</td><td class="c num down">${v.newTotal - v.oldTotal}</td></tr></tfoot>
        </table>
      </div>`;
    })
    .join("");

  const userRows = humans
    .map(
      (u) => `<tr>
      <td>${esc(u.name)}</td>
      <td class="c num">${u.old}</td>
      <td class="c num strong">${u.neu}</td>
      <td class="c num ${u.delta < 0 ? "down" : u.delta > 0 ? "up" : "muted"}">${u.delta > 0 ? "+" : ""}${u.delta}</td>
    </tr>`,
    )
    .join("");

  const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<style>
  :root{ --ink:#16241d; --muted:#6b7a72; --line:#e3e6e2; --green:#1a7a4c; --greenbg:#eef6f0; --down:#b3261e; --up:#1a7a4c; --paper:#ffffff; }
  *{box-sizing:border-box;}
  body{ font-family:"Segoe UI","Arial",sans-serif; color:var(--ink); margin:0; background:var(--paper); font-size:13px; line-height:1.55; }
  .page{ padding:38px 44px; }
  header{ border-bottom:3px solid var(--green); padding-bottom:16px; margin-bottom:22px; }
  .kicker{ color:var(--green); font-weight:700; letter-spacing:.04em; font-size:12px; }
  h1{ font-size:25px; margin:6px 0 4px; }
  .sub{ color:var(--muted); font-size:13px; }
  h2{ font-size:16px; margin:26px 0 10px; padding-right:11px; border-right:4px solid var(--green); }
  h3{ font-size:14px; margin:0 0 8px; }
  .tldr{ background:var(--greenbg); border:1px solid #cfe6d8; border-radius:10px; padding:16px 18px; }
  .tldr .big{ font-size:30px; font-weight:800; color:var(--down); }
  .tldr ul{ margin:8px 0 0; padding-inline-start:18px; }
  .tldr li{ margin:3px 0; }
  table{ width:100%; border-collapse:collapse; margin-top:6px; }
  th,td{ padding:7px 9px; border-bottom:1px solid var(--line); text-align:right; vertical-align:middle; }
  th{ color:var(--muted); font-weight:600; font-size:11.5px; text-transform:none; border-bottom:1.5px solid var(--line); }
  td.c,th.c{ text-align:center; }
  .num{ font-variant-numeric:tabular-nums; direction:ltr; }
  .strong{ font-weight:700; }
  .down{ color:var(--down); font-weight:700; }
  .up{ color:var(--up); font-weight:700; }
  .muted{ color:var(--muted); }
  tfoot td{ font-weight:700; border-top:1.5px solid var(--ink); border-bottom:none; background:#fafbfa; }
  .winchip{ display:inline-block; background:var(--green); color:#fff; border-radius:20px; padding:1px 10px; font-size:11px; font-weight:700; }
  .winchip.sm{ font-size:10px; padding:1px 8px; font-weight:600; vertical-align:middle; }
  .bot{ background:#eceff0; color:#6b7a72; border-radius:6px; padding:0 5px; font-size:10px; }
  .bet{ break-inside:avoid; margin:14px 0; }
  .grid td,.grid th{ padding:5px 9px; }
  .two{ display:grid; grid-template-columns:1fr 1fr; gap:14px; }
  .card{ border:1px solid var(--line); border-radius:9px; padding:12px 14px; }
  .card h3{ color:var(--green); }
  .foot{ margin-top:26px; padding-top:12px; border-top:1px solid var(--line); color:var(--muted); font-size:11px; }
  .q{ font-weight:600; }
</style></head><body><div class="page">

<header>
  <div class="kicker">טוטו מונדיאל · נירמול הימורי לייב</div>
  <h1>מקסיקו 2 : 0 דרום אפריקה</h1>
  <div class="sub">משחק מ־11 ביוני 2026 · דו״ח תיקון תוצאות · הופק 12 ביוני 2026</div>
</header>

<div class="tldr">
  <div class="big">ירידה של <span dir="ltr">${Math.abs(poolDelta)}</span> נק׳</div>
  <div>סך הנקודות שחולקו על ההימורים החיים של המשחק ירד מ־${poolOld} ל־${poolNew} (לא כולל הבוט).</div>
  <ul>
    <li><b>הבעיה:</b> כל הימור כן/לא קיבל יחס אחד משותף לשני הצדדים, והייתה תקרת זכייה של 100 נק׳.</li>
    <li><b>התוצאה אתמול:</b> הצד ה״בטוח״ (למשל ״לא VAR״) שולם פי 3.5–6 על אירוע שקורה ב~85–90% מהמקרים, ומי שהימר סכום גדול נחתך ל־100 וזכה כמו מי שהימר פחות.</li>
    <li><b>התיקון להיום:</b> כל צד מתומחר לפי ההסתברות שלו, והתקרה המוחלטת הוסרה (היחס ×8 נשאר כגבול ביטחון).</li>
    <li><b>הוחלט יחד עם כל המשתתפים</b> והוחל רטרואקטיבית על תוצאות אתמול. השינוי הפיך (נשמר גיבוי מלא).</li>
  </ul>
</div>

<h2>מה תוקן בכל הימור — היחס</h2>
<table>
  <thead><tr><th class="q">הימור</th><th class="c">זכה</th><th class="c">יחס אתמול<br>(משותף)</th><th class="c">יחס היום<br>כן / לא</th><th class="c">יחס הצד הזוכה</th></tr></thead>
  <tbody>${oddsRows}</tbody>
</table>
<p class="muted" style="margin-top:8px">היחס מוצג כמכפיל. התשלום בפועל = סיכון × יחס × 0.95 (ניכוי בית 5%, כמו בכל הימור לייב), עד גבול של פי 8 מהסיכון.</p>

<h2>הפירוט — מי זכה וכמה (אתמול מול היום)</h2>
${betBlocks}

<h2>השפעה לכל שחקן</h2>
<table>
  <thead><tr><th>שחקן</th><th class="c">סה״כ אתמול</th><th class="c">סה״כ היום</th><th class="c">שינוי</th></tr></thead>
  <tbody>${userRows}</tbody>
  <tfoot><tr><td>סה״כ בריכה (שחקנים)</td><td class="c num">${poolOld}</td><td class="c num">${poolNew}</td><td class="c num down">${poolDelta}</td></tr></tfoot>
</table>

<div class="foot">
  הנקודות חושבו מחדש באותו מנוע התמחור של המערכת. ״אתמול״ = היחס המשותף הישן עם תקרת 100; ״היום״ = יחס נפרד לכל צד ללא תקרה. ניכוי בית 5% והגבול פי 8 מהסיכון זהים בשתי העמודות. כל ההימורים שכבר הוכרעו עודכנו עם רישום ביקורת (audit) וגיבוי מלא הניתן לשחזור.
</div>

</div></body></html>`;

  const htmlPath = "_scripts/normalization-report.html";
  writeFileSync(htmlPath, html);

  const outPath = "C:/Projects/World cup/Toto-Mundial-normalization-MEX-RSA.pdf";
  const browser = await chromium.launch({ channel: "chrome" });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.pdf({
    path: outPath,
    format: "A4",
    printBackground: true,
    margin: { top: "14mm", bottom: "14mm", left: "12mm", right: "12mm" },
  });
  await browser.close();

  console.log(`Pool: old=${poolOld} new=${poolNew} delta=${poolDelta}`);
  console.log(`Players: ${humans.length}  Bets: ${betViews.length}`);
  console.log(`HTML: ${htmlPath}`);
  console.log(`PDF:  ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
