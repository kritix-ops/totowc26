// Read-only diagnostic for the failing live-bet push (prod).
//
// sendLiveBetPush() returns the generic "db" error from its catch block,
// which means a query inside the try threw. This script replays ONLY the
// read queries of that flow against DATABASE_URL, plus the user_notifications
// insert inside a transaction that is forced to ROLLBACK — so nothing is
// committed and NO push is ever sent to a real user. Each step is isolated
// so we can see exactly which query throws and the raw Postgres error.
//
// Run: node --env-file=.env.local scripts/one-off/diagnose-live-bet-push-2026-06-14.mjs

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

async function step(name, fn) {
  try {
    const r = await fn();
    const summary = Array.isArray(r) ? `${r.length} rows` : JSON.stringify(r);
    console.log(`OK   ${name}: ${summary}`);
    return r;
  } catch (e) {
    console.error(`FAIL ${name}: ${e?.message ?? e}`);
    if (e?.code) console.error(`     code:   ${e.code}`);
    if (e?.detail) console.error(`     detail: ${e.detail}`);
    if (e?.hint) console.error(`     hint:   ${e.hint}`);
    return null;
  }
}

// 1. listOpenLiveBetsForPush (admin-queries.ts)
const open = await step("listOpenLiveBetsForPush", () => sql`
  select
    cb.id::text       as "id",
    cb.scope::text    as "scope",
    cb.question_he    as "questionHe",
    cb.question_en    as "questionEn",
    cb.match_id::text as "matchId",
    ht.name_he        as "homeNameHe",
    ht.name_en        as "homeNameEn",
    at.name_he        as "awayNameHe",
    at.name_en        as "awayNameEn",
    md.date::text     as "matchdayDate"
  from public.custom_bets cb
  left join public.matches   m  on m.id  = cb.match_id
  left join public.teams     ht on ht.code = m.home_team
  left join public.teams     at on at.code = m.away_team
  left join public.matchdays md on md.id = cb.matchday_id
  where cb.status = 'open'
    and cb.scope::text in ('match', 'day')
  order by m.kickoff_at asc nulls last, md.date asc nulls last, cb.created_at asc
  limit 200
`);

// 2. resolveRecipients({ kind: "all-opted-in" }) (notifications.ts)
const recips = await step("resolveRecipients(all-opted-in)", () => sql`
  select id from public.profiles
  where push_opt_in = true and is_bot = false
`);

// 3. push_subscriptions join (notifications.ts step 2)
await step("push_subscriptions join", () => sql`
  select ps.id, ps.user_id, ps.endpoint, ps.p256dh, ps.auth
  from public.push_subscriptions ps
  join public.profiles p on p.id = ps.user_id
  where p.push_opt_in = true
  limit 5
`);

// 4. user_notifications insert — exact column shape, inside a transaction
//    that always rolls back. Nothing is committed; no push fires.
await step("user_notifications insert (ROLLBACK)", async () => {
  const recipId = recips?.[0]?.id;
  if (!recipId) throw new Error("no opted-in recipient to test the insert with");
  try {
    await sql.begin(async (tx) => {
      const ins = await tx`
        insert into public.user_notifications
          (user_id, kind, title, body, url, pushed, created_by)
        values
          (${recipId}::uuid, 'live_bet', 'DIAGNOSTIC', 'DIAGNOSTIC',
           '/he/bets/live', false, ${recipId}::uuid)
        returning id
      `;
      throw Object.assign(new Error("__rollback__"), {
        __rollback: true,
        rows: ins.length,
      });
    });
  } catch (e) {
    if (e?.__rollback) return `insert shape OK (rolled back), rows=${e.rows}`;
    throw e;
  }
});

await sql.end();
console.log("done");
