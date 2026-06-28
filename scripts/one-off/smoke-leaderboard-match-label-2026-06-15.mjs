// One-off smoke test for the leaderboard breakdown match-label change.
// Runs the new `live` union branch (the only branch that gained a JOIN +
// CASE) verbatim against the DB to confirm the SQL is valid and that
// match_label / match_at actually populate for match-scoped live bets.
// Read-only. Safe to delete after verifying.
import postgres from "postgres";

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) throw new Error("No DIRECT_URL / DATABASE_URL in env");

const sql = postgres(url, { prepare: false, max: 1 });

try {
  const rows = await sql`
    select
      pk.user_id                                  as user_id,
      case when cb.scope in ('match', 'day') then 'live'::text
           else 'tournament'::text
      end                                         as kind,
      coalesce(cb.graded_at, cb.lock_at)          as event_at,
      cb.question_he                              as title_he,
      case when cb.match_id is not null
           then (m2.home_team || ' ' || m2.away_team)
           else null
      end                                         as match_label,
      m2.kickoff_at                               as match_at,
      cb.scope                                    as scope
    from public.user_custom_bet_picks pk
    join public.custom_bets cb on cb.id = pk.custom_bet_id
    left join public.matches m2 on m2.id = cb.match_id
    where cb.status in ('graded', 'reversed') and pk.points_earned is not null
    order by event_at desc nulls last
    limit 8
  `;

  console.info("[smoke] rows returned:", rows.length);
  for (const r of rows) {
    console.info("[smoke]", {
      scope: r.scope,
      matchLabel: r.match_label,
      matchAt: r.match_at,
      title: (r.title_he || "").slice(0, 28),
    });
  }
  const withLabel = rows.filter((r) => r.match_label).length;
  console.info(
    `[smoke] ${withLabel}/${rows.length} live rows carry a match label`,
  );
} finally {
  await sql.end();
}
