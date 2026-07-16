// One-off: raise the payout floor 20 → 35 on the UNGRADED tournament-scope
// bets (champion, runner-up, third, top scorer, golden ball, final-on-
// penalties). These carry a baked-in floor of 20 from publish time. They are
// not graded, so no points_earned exist yet → ZERO leaderboard impact. We
// only re-price the per-option payouts (answer_config) and each pick's frozen
// payout_snapshot, so the payout is correct when the bet is eventually graded.
//
// Group bets (scope=group) are NOT touched — they keep their 20 floor.
// Already-graded bets (total goals, red cards) are NOT touched here.
// See _plans/2026-07-16-raise-tournament-bet-floor-to-35.md.
//
// Two transforms (MODE env):
//   clamp  (default) — new = max(old, 35). Only sub-floor values move; the
//          rest is untouched. Matches the total-goals change. Flattens the
//          top favourites of the 48-team bets to a shared 35.
//   remap           — new = round(35 + 65*(old-20)/80), i.e. re-run the
//          log-odds curve with floor 35, ceiling 100. Every value shifts up;
//          preserves the favourite gradient (France < Portugal stays).
//
// SAFETY: dry-run by default (prints a compact before→after summary). Pass
// APPLY=1 to mutate. Writes a JSON backup, one transaction, audit row per bet.
//
// Dry-run clamp: node --env-file=.env.local scripts/one-off/reprice-ungraded-tournament-floor-2026-07-16.mjs
// Dry-run remap: MODE=remap node --env-file=.env.local scripts/one-off/reprice-ungraded-tournament-floor-2026-07-16.mjs
// Apply:         APPLY=1 [MODE=remap] node --env-file=.env.local scripts/one-off/reprice-ungraded-tournament-floor-2026-07-16.mjs
import postgres from "postgres";
import { writeFileSync } from "node:fs";

const OLD_FLOOR = 20;
const NEW_FLOOR = 35;
const CEILING = 100;
const ADMIN_ID = "7b6ff987-73de-4604-9390-1cb35fc9812b"; // יואב מזרחי (role=admin)
const MODE = process.env.MODE === "remap" ? "remap" : "clamp";
const APPLY = process.env.APPLY === "1";
const REASON = `Raise tournament floor 20→35 (${MODE}) on ungraded outright bets. See _plans/2026-07-16-raise-tournament-bet-floor-to-35.md.`;

const transform = (p) => {
  if (typeof p !== "number") return p;
  const next =
    MODE === "remap"
      ? Math.round(NEW_FLOOR + (CEILING - NEW_FLOOR) * ((p - OLD_FLOOR) / (CEILING - OLD_FLOOR)))
      : Math.max(p, NEW_FLOOR);
  return Math.min(Math.max(next, NEW_FLOOR), CEILING);
};

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) { console.error("No DIRECT_URL / DATABASE_URL"); process.exit(1); }
const sql = postgres(url, {
  max: 1, prepare: false, idle_timeout: 5, connect_timeout: 12,
  connection: { statement_timeout: 20000 },
});
const hist = (arr) => {
  const m = new Map();
  for (const v of arr) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([v, n]) => `${v}×${n}`).join(", ");
};

try {
  const [id] = await sql`select current_database() as db,
    (select count(*) from public.profiles where not coalesce(is_bot,false)) as humans`;
  console.log(`\nDB: ${id.db}  humans: ${id.humans}   MODE: ${MODE}   ${APPLY ? "APPLY (will mutate)" : "DRY-RUN (read-only)"}`);

  const bets = await sql`
    select id, status, question_he, answer_type, answer_config
    from public.custom_bets
    where scope = 'tournament' and status not in ('graded','cancelled')
    order by created_at`;

  // Safety: none of these may have graded picks.
  const graded = await sql`
    select count(*)::int as n from public.user_custom_bet_picks pk
    join public.custom_bets cb on cb.id = pk.custom_bet_id
    where cb.scope = 'tournament' and cb.status not in ('graded','cancelled')
      and pk.points_earned is not null`;
  if (graded[0].n > 0) {
    console.error(`\nAbort: ${graded[0].n} picks already have points_earned on these bets. Not safe to re-price silently.`);
    await sql.end(); process.exit(1);
  }

  const backup = [];
  let plannedOptionRows = 0, plannedPickRows = 0;

  for (const bet of bets) {
    const cfg = bet.answer_config || {};
    console.log(`\n──────── ${bet.question_he}  [${bet.status} / ${bet.answer_type}]`);

    // answer_config payout preview.
    if (bet.answer_type === "yes_no") {
      const y = cfg.payoutOverrideYes, n = cfg.payoutOverrideNo;
      console.log(`  yes ${y} → ${transform(y)}    no ${n} → ${transform(n)}`);
    } else {
      const opts = Array.isArray(cfg.options) ? cfg.options : [];
      if (opts.length) {
        const before = opts.map((o) => o.payoutOverride).filter((v) => typeof v === "number");
        const after = before.map(transform);
        console.log(`  options before: ${hist(before)}`);
        console.log(`  options after : ${hist(after)}`);
      } else {
        console.log(`  (dynamicSource=${cfg.dynamicSource}; options hydrated at view time — only picks re-priced)`);
      }
    }

    // Picks preview.
    const picks = await sql`
      select payout_snapshot from public.user_custom_bet_picks
      where custom_bet_id = ${bet.id} and payout_snapshot is not null`;
    const pb = picks.map((r) => r.payout_snapshot);
    const pa = pb.map(transform);
    const changed = pb.filter((v, i) => v !== pa[i]).length;
    console.log(`  picks (${pb.length}) payout_snapshot before: ${hist(pb)}`);
    console.log(`  picks (${pb.length}) payout_snapshot after : ${hist(pa)}   (${changed} change)`);

    plannedPickRows += changed;
    plannedOptionRows += 1;
    backup.push({ id: bet.id, question: bet.question_he, answer_config: cfg });
  }

  console.log(`\nPlanned: re-price answer_config on ${bets.length} bets, ${plannedPickRows} pick payout_snapshot rows. Leaderboard impact: 0 (ungraded).`);

  if (!APPLY) {
    console.log(`\nDRY-RUN complete (${MODE}). No data changed. Re-run with APPLY=1 to commit.`);
    await sql.end(); process.exit(0);
  }

  // ---- APPLY ----
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `scripts/one-off/reprice-ungraded-tournament-floor-backup-${MODE}-${stamp}.json`;
  writeFileSync(backupPath, JSON.stringify(backup, null, 2));
  console.log(`\nBackup written: ${backupPath}`);

  let optRows = 0, pickRows = 0;
  await sql.begin(async (tx) => {
    for (const bet of bets) {
      const cfg = bet.answer_config || {};
      let newCfg;
      if (bet.answer_type === "yes_no") {
        newCfg = { ...cfg };
        if (typeof cfg.payoutOverrideYes === "number") newCfg.payoutOverrideYes = transform(cfg.payoutOverrideYes);
        if (typeof cfg.payoutOverrideNo === "number") newCfg.payoutOverrideNo = transform(cfg.payoutOverrideNo);
      } else {
        const opts = Array.isArray(cfg.options) ? cfg.options : [];
        newCfg = { ...cfg, options: opts.map((o) => (typeof o.payoutOverride === "number" ? { ...o, payoutOverride: transform(o.payoutOverride) } : o)) };
      }
      await tx`update public.custom_bets set answer_config = ${tx.json(newCfg)}, updated_at = now() where id = ${bet.id}`;
      optRows += 1;

      // Re-price each pick's frozen snapshot below the new floor / per remap.
      const picks = await tx`
        select id, payout_snapshot from public.user_custom_bet_picks
        where custom_bet_id = ${bet.id} and payout_snapshot is not null`;
      let betPickRows = 0;
      for (const pk of picks) {
        const next = transform(pk.payout_snapshot);
        if (next !== pk.payout_snapshot) {
          await tx`update public.user_custom_bet_picks set payout_snapshot = ${next}, updated_at = now() where id = ${pk.id}`;
          betPickRows += 1;
        }
      }
      pickRows += betPickRows;

      // bet_odds_audit is the home for payout/odds edits that re-price picks
      // (before / after config + affected count), unlike bet_grading_audit
      // whose action CHECK only allows grade/reverse/cancel/reopen.
      await tx`
        insert into public.bet_odds_audit
          (custom_bet_id, before, after, affected_picks, reason, performed_by)
        values (${bet.id}, ${tx.json(cfg)}, ${tx.json(newCfg)}, ${betPickRows}, ${REASON}, ${ADMIN_ID})`;
    }
  });

  console.log(`\nApplied: ${optRows} answer_config rows, ${pickRows} pick payout_snapshot rows, ${optRows} audit rows.`);
  console.log("\nDONE");
} catch (e) {
  console.error("ERR:", e?.message || e);
} finally {
  await sql.end({ timeout: 5 });
  process.exit(0);
}
