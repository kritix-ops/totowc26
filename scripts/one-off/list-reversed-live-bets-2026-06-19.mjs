// Read-only: list reversed custom bets whose lock has not yet passed — the
// ones a player COULD still fill if they were reopened to 'open'. Used to
// identify the MEX vs KOR bet that an admin reversed by mistake (2026-06-19).
//
// Run: node --env-file=.env.local scripts/one-off/list-reversed-live-bets-2026-06-19.mjs

import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}
console.log("DB host:", new URL(url).host);

const sql = postgres(url, {
  prepare: false,
  max: 2,
  idle_timeout: 5,
  connect_timeout: 10,
});

try {
  const rows = await sql`
    select
      cb.id::text                     as id,
      cb.scope::text                  as scope,
      cb.status::text                 as status,
      cb.question_he                  as question,
      cb.lock_at                      as lock_at,
      (cb.lock_at > now())            as time_left,
      coalesce(ht.code, '')           as home,
      coalesce(at.code, '')           as away,
      (select count(*) from public.user_custom_bet_picks pk
        where pk.custom_bet_id = cb.id) as picks
    from public.custom_bets cb
    left join public.matches m on m.id = cb.match_id
    left join public.teams ht on ht.code = m.home_team
    left join public.teams at on at.code = m.away_team
    where cb.status = 'reversed'
    order by cb.lock_at desc
  `;

  console.log(`\nFound ${rows.length} reversed bet(s):\n`);
  for (const r of rows) {
    console.log(
      [
        `id=${r.id}`,
        `scope=${r.scope}`,
        `match=${r.home || "-"} vs ${r.away || "-"}`,
        `picks=${r.picks}`,
        `lock_at=${new Date(r.lock_at).toISOString()}`,
        `timeLeft=${r.time_left}`,
        `q="${(r.question || "").slice(0, 50)}"`,
      ].join("  "),
    );
  }
  console.log("");
} catch (e) {
  console.error("query failed:", e?.message ?? e);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
