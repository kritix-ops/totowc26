// Read-only verification of the 2026-06-19 MEX vs KOR reopen.
// Run: node --env-file=.env.local scripts/one-off/verify-reopen-mex-kor-2026-06-19.mjs

import postgres from "postgres";

const BET_ID = "5be5cf9f-017d-4baa-9c1b-9a33af3d55ff";
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 2 });

try {
  const [bet] = await sql`
    select status::text as status, (lock_at > now()) as time_left, lock_at
    from public.custom_bets where id = ${BET_ID}
  `;
  console.log("bet:", bet);

  const audit = await sql`
    select action, previous_status, new_status, performed_at
    from public.bet_grading_audit
    where custom_bet_id = ${BET_ID}
    order by performed_at desc limit 4
  `;
  console.log("recent audit:");
  for (const a of audit) {
    console.log(
      `  ${a.action}  ${a.previous_status}->${a.new_status}  ${new Date(a.performed_at).toISOString()}`,
    );
  }
} finally {
  await sql.end({ timeout: 5 });
}
