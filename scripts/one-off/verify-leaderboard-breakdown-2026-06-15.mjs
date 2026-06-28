// Read-only check that the leaderboard breakdown query still parses, the
// UNION branches line up after adding match_label / match_at, and that
// match-scoped live bets actually carry their match. Run:
//   node --env-file=.env.local scripts/one-off/verify-leaderboard-breakdown-2026-06-15.mjs
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, {
  prepare: false,
  max: 1,
  connection: { statement_timeout: 15000 },
});

try {
  // A user who has graded, match-scoped live picks, so match_label is non-null.
  const [picker] = await sql`
    select pk.user_id
    from public.user_custom_bet_picks pk
    join public.custom_bets cb on cb.id = pk.custom_bet_id
    where cb.status in ('graded', 'reversed')
      and pk.points_earned is not null
      and cb.match_id is not null
    limit 1
  `;
  const userId = picker?.user_id ?? "00000000-0000-0000-0000-000000000000";
  console.log("[verify] probing user:", userId);

  // duelCaseSql is irrelevant to the columns I changed, so stub the duel
  // delta with 0::int — this still validates the full four-branch UNION.
  const rows = await sql`
    with target as (
      select ${userId}::uuid as user_id
    ),
    events as (
      select
        mb.user_id as user_id, 'match'::text as kind,
        coalesce(m.finalized_at, m.kickoff_at) as event_at,
        coalesce(mb.points_earned, 0)::int as delta,
        (m.home_team || ' ' || m.away_team) as title_he,
        (m.home_team || ' ' || m.away_team) as title_en,
        null::text as detail_he, null::text as detail_en,
        null::text as match_label, m.kickoff_at as match_at
      from public.match_bets mb
      join public.matches m on m.id = mb.match_id
      join target t on t.user_id = mb.user_id
      where m.status = 'final' and mb.points_earned is not null
      union all
      select
        pk.user_id as user_id,
        case when cb.scope in ('match','day') then 'live'::text else 'tournament'::text end as kind,
        coalesce(cb.graded_at, cb.lock_at) as event_at,
        (coalesce(pk.points_earned, 0) - pk.stake_paid)::int as delta,
        cb.question_he as title_he, cb.question_en as title_en,
        null::text as detail_he, null::text as detail_en,
        case when cb.match_id is not null then (m2.home_team || ' ' || m2.away_team) else null end as match_label,
        m2.kickoff_at as match_at
      from public.user_custom_bet_picks pk
      join public.custom_bets cb on cb.id = pk.custom_bet_id
      left join public.matches m2 on m2.id = cb.match_id
      join target t on t.user_id = pk.user_id
      where cb.status in ('graded','reversed') and pk.points_earned is not null
      union all
      select
        opener.user_id as user_id, 'duel'::text as kind,
        coalesce(d.settled_at, d.created_at) as event_at, 0::int as delta,
        coalesce(d.question_he, 'דו-קרב') as title_he,
        coalesce(d.question_en, 'Duel') as title_en,
        null::text as detail_he, null::text as detail_en,
        null::text as match_label, null::timestamptz as match_at
      from public.duels d
      join (
        select t.user_id, d2.id as duel_id from target t join public.duels d2 on d2.opener_id = t.user_id
        union all
        select t.user_id, d2.id as duel_id from target t join public.duels d2 on d2.joiner_id = t.user_id
      ) opener on opener.duel_id = d.id
      where d.status = 'settled'
      union all
      select
        pa.user_id as user_id, 'adjustment'::text as kind,
        pa.created_at as event_at, pa.delta::int as delta,
        coalesce(pa.reason, 'התאמה ידנית') as title_he,
        coalesce(pa.reason, 'Manual adjustment') as title_en,
        null::text as detail_he, null::text as detail_en,
        null::text as match_label, null::timestamptz as match_at
      from public.point_adjustments pa
      join target t on t.user_id = pa.user_id
    ),
    ranked as (
      select e.*, row_number() over (partition by e.user_id order by e.event_at desc) as rn
      from events e
    )
    select r.kind, r.delta, r.title_he, r.match_label, r.match_at
    from ranked r
    where r.rn <= 8
       or r.event_at >= (
            date_trunc('day', (now() at time zone 'Asia/Jerusalem')) - interval '1 day'
          ) at time zone 'Asia/Jerusalem'
    order by r.event_at desc
  `;

  console.log(`[verify] query OK — ${rows.length} rows`);
  for (const r of rows.slice(0, 12)) {
    console.log(
      `  ${r.kind.padEnd(11)} d=${String(r.delta).padStart(4)} match=${(r.match_label ?? "—").padEnd(8)} at=${r.match_at ?? "—"}  | ${r.title_he}`,
    );
  }
  const live = rows.filter((r) => r.kind === "live");
  const liveWithMatch = live.filter((r) => r.match_label);
  console.log(
    `[verify] live rows: ${live.length}, of which ${liveWithMatch.length} carry a match label`,
  );
} finally {
  await sql.end();
}
