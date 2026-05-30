import "server-only";

import { sql } from "drizzle-orm";
import { execFirstRow } from "@/db/helpers";
import { localePath } from "@/lib/paths";
import type { Generator } from "../types";

// "Player X is 1-3 ranks above you. Catch up by joining their open duel."
//
// Surfaces a duel opened by a player whose current leaderboard rank
// is 1-3 above the viewer. Subtle nudge that "you can claw back
// points off a specific person who is ahead of you" - more personal
// than the generic open-duels moment.
//
// Computes the leaderboard inline via the same `point_adjustments`
// + `match_bets` + `user_custom_bet_picks` + duels formula used by
// queries.ts to keep the moment self-contained. If anyone else's
// rank changes a few seconds later, no harm: the next render picks
// up the new state.
//
// See _plans/2026-05-30-smart-reminders.md §3.2.

type Row = {
  duel_id: string;
  opener_name: string;
  opener_rank: number;
  my_rank: number;
  stake: number;
  question_he: string;
  question_en: string;
};

export const duelOpportunity: Generator = async (ctx) => {
  const r = await execFirstRow<Row>(sql`
    with totals as (
      -- Same shape as getLeaderboard but pared down to (user_id, points).
      -- Starting bank + adjustments + matches net + custom net + duels net.
      select p.id as user_id,
             (
               coalesce((select sum(s.starting_bank) from public.settings s where s.id = 1), 30)
               + coalesce((select sum(pa.delta) from public.point_adjustments pa where pa.user_id = p.id), 0)
               + coalesce((select sum(mb.points_earned) from public.match_bets mb
                   where mb.user_id = p.id and mb.points_earned is not null), 0)
               + coalesce((select sum(coalesce(pk.points_earned,0) - pk.stake_paid)
                   from public.user_custom_bet_picks pk
                   where pk.user_id = p.id), 0)
               + coalesce((select sum(
                     case
                       when d.status = 'settled' and d.resolved_value = d.opener_answer and d.opener_id = p.id then d.stake
                       when d.status = 'settled' and d.resolved_value = d.opener_answer and d.joiner_id = p.id then -d.stake
                       when d.status = 'settled' and d.resolved_value <> d.opener_answer and d.opener_id = p.id then -d.stake
                       when d.status = 'settled' and d.resolved_value <> d.opener_answer and d.joiner_id = p.id then d.stake
                       when d.status = 'matched' and (d.opener_id = p.id or d.joiner_id = p.id) then -d.stake
                       when d.status = 'open' and d.opener_id = p.id then -d.stake
                       else 0
                     end
                   ) from public.duels d
                   where (d.opener_id = p.id or d.joiner_id = p.id)), 0)
             )::int as points
      from public.profiles p
    ),
    ranked as (
      select user_id, points,
             rank() over (order by points desc) as rk
      from totals
    ),
    me as (
      select rk as my_rank from ranked where user_id = ${ctx.userId}::uuid
    )
    select
      d.id::text                                   as "duel_id",
      op.display_name                              as "opener_name",
      r.rk::int                                    as "opener_rank",
      (select my_rank from me)::int                as "my_rank",
      d.stake                                      as "stake",
      d.question_he                                as "question_he",
      d.question_en                                as "question_en"
    from public.duels d
    join public.profiles op on op.id = d.opener_id
    join ranked r on r.user_id = d.opener_id
    where d.status = 'open'
      and d.opener_id <> ${ctx.userId}::uuid
      and d.join_deadline_at > now()
      and (select my_rank from me) is not null
      and r.rk < (select my_rank from me)
      and (select my_rank from me) - r.rk between 1 and 3
    order by ((select my_rank from me) - r.rk) asc, d.created_at desc
    limit 1
  `);
  if (!r) return null;

  const isHebrew = ctx.locale === "he";
  const question = isHebrew ? r.question_he : r.question_en;
  const rankGap = r.my_rank - r.opener_rank;

  // Score 50 base + small bump for closer-gap opponents (1 rank > 3 ranks).
  const score = 50 + (4 - rankGap) * 2;

  return {
    key: `duel_opportunity:${r.duel_id}`,
    type: "duel_opportunity",
    urgency: "opportunity",
    score,
    icon: "Swords",
    title: isHebrew
      ? `${r.opener_name} ${rankGap === 1 ? "מקום אחד" : `${rankGap} מקומות`} מעלייך - יש הזדמנות`
      : `${r.opener_name} is ${rankGap} rank${rankGap > 1 ? "s" : ""} ahead - duel time?`,
    body: isHebrew
      ? `ההצעה: ${truncate(question, 80)} · השקעה ${r.stake} נק'`
      : `Their bet: ${truncate(question, 80)} · ${r.stake}-pt stake`,
    ctaLabel: isHebrew ? "צפה בדו-קרב" : "View duel",
    ctaHref: localePath(ctx.locale, `duels/${r.duel_id}`),
  };
};

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
