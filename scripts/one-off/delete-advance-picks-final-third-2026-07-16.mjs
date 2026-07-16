// One-off cleanup: delete the "who advances?" (match_advance_bets) picks that
// were placed on the terminal matches — the final and the third-place play-off
// — before those matches were excluded from the advance market. Nobody
// advances out of them, so the market should never have been offered there.
//
// The picks are ungraded (points_earned IS NULL) and carry no stake, so
// deleting them has ZERO leaderboard impact. Backs up the deleted rows to JSON
// first and runs inside one transaction.
//
// SAFETY: dry-run by default. Pass APPLY=1 to delete.
// Dry-run: node --env-file=.env.local scripts/one-off/delete-advance-picks-final-third-2026-07-16.mjs
// Apply:   APPLY=1 node --env-file=.env.local scripts/one-off/delete-advance-picks-final-third-2026-07-16.mjs
import postgres from "postgres";
import { writeFileSync } from "node:fs";

const APPLY = process.env.APPLY === "1";
const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) { console.error("No DIRECT_URL / DATABASE_URL"); process.exit(1); }
const sql = postgres(url, {
  max: 1, prepare: false, idle_timeout: 5, connect_timeout: 12,
  connection: { statement_timeout: 15000 },
});
const out = (l, r) => { console.log(`\n=== ${l} ===`); console.dir(r, { depth: null }); };

try {
  const [id] = await sql`select current_database() as db,
    (select count(*) from public.profiles where not coalesce(is_bot,false)) as humans`;
  console.log(`\nDB: ${id.db}  humans: ${id.humans}   ${APPLY ? "APPLY (will delete)" : "DRY-RUN (read-only)"}`);

  // The exact picks we would delete — advance picks on final / third-place.
  const doomed = await sql`
    select ab.id as pick_id, p.display_name, ab.team, ab.points_earned,
      m.stage, m.status, m.kickoff_at::text
    from public.match_advance_bets ab
    join public.matches m on m.id = ab.match_id
    join public.profiles p on p.id = ab.user_id
    where m.stage in ('final', 'third_place')
    order by m.stage, p.display_name`;
  out(`advance picks on final / third-place (${doomed.length})`, doomed);

  const graded = doomed.filter((r) => r.points_earned !== null);
  if (graded.length > 0) {
    console.error(`\nAbort: ${graded.length} of these are already graded (points_earned set). Not deleting silently.`);
    await sql.end(); process.exit(1);
  }
  if (doomed.length === 0) {
    console.log("\nNothing to delete. DONE.");
    await sql.end(); process.exit(0);
  }

  if (!APPLY) {
    console.log("\nDRY-RUN complete. No data changed. Re-run with APPLY=1 to delete.");
    await sql.end(); process.exit(0);
  }

  // ---- APPLY ----
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `scripts/one-off/delete-advance-picks-final-third-backup-${stamp}.json`;
  writeFileSync(backupPath, JSON.stringify(doomed, null, 2));
  console.log(`\nBackup written: ${backupPath}`);

  const deleted = await sql.begin(async (tx) => {
    const rows = await tx`
      delete from public.match_advance_bets ab
      using public.matches m
      where ab.match_id = m.id
        and m.stage in ('final', 'third_place')
        and ab.points_earned is null
      returning ab.id`;
    return rows.length;
  });
  console.log(`\nDeleted ${deleted} advance picks.`);

  out("remaining advance picks on final / third-place (must be 0)", await sql`
    select count(*)::int as n
    from public.match_advance_bets ab
    join public.matches m on m.id = ab.match_id
    where m.stage in ('final', 'third_place')`);

  console.log("\nDONE");
} catch (e) {
  console.error("ERR:", e?.message || e);
} finally {
  await sql.end({ timeout: 5 });
  process.exit(0);
}
