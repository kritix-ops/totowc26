import "server-only";

import { sql } from "drizzle-orm";
import { execFirstRow } from "@/db/helpers";
import { getLeaderboard, type LeaderboardEntry } from "@/db/queries";
import { localePath } from "@/lib/paths";
import type { Generator } from "../types";

// "Player X is 1-3 ranks above you. Catch up by joining their open duel."
//
// Reuses the cached getLeaderboard(userId) — the same query StatusRow
// already pays for — to find opener candidates ranked 1-3 above the
// viewer, then runs a small indexed lookup against `duels` for the
// freshest open duel any of them have opened. The pre-cache version
// recomputed the entire leaderboard inline on every render (5
// correlated subqueries × every profile, uncached), which at friends-
// pool scale was still the slowest single query on the dashboard and
// dominated SmartHub's Promise.all wait. See
// _plans/2026-05-30-smart-reminders.md §3.2.

type Row = {
  duel_id: string;
  opener_id: string;
  stake: number;
  question_he: string;
  question_en: string;
};

// Pure helper: pick the rank-gap candidates from a leaderboard board.
// Exported so the selection rules can be tested without a DB.
export function selectDuelCandidates(
  board: LeaderboardEntry[],
): { candidates: LeaderboardEntry[]; myRank: number } | null {
  const me = board.find((r) => r.isYou);
  if (!me || me.rank <= 1) return null;
  const candidates = board.filter(
    (r) => !r.isYou && r.rank < me.rank && me.rank - r.rank <= 3,
  );
  if (candidates.length === 0) return null;
  return { candidates, myRank: me.rank };
}

export const duelOpportunity: Generator = async (ctx) => {
  const board = await getLeaderboard(ctx.userId);
  const selection = selectDuelCandidates(board);
  if (!selection) return null;

  const { candidates, myRank } = selection;
  const candidateIdList = sql.join(
    candidates.map((c) => sql`${c.userId}::uuid`),
    sql`, `,
  );

  const row = await execFirstRow<Row>(sql`
    select
      d.id::text         as "duel_id",
      d.opener_id::text  as "opener_id",
      d.stake            as "stake",
      d.question_he      as "question_he",
      d.question_en      as "question_en"
    from public.duels d
    where d.status = 'open'
      and d.opener_id in (${candidateIdList})
      and d.opener_id <> ${ctx.userId}::uuid
      and d.join_deadline_at > now()
    order by d.created_at desc
    limit 1
  `);
  if (!row) return null;

  const opener = candidates.find((c) => c.userId === row.opener_id);
  if (!opener) return null;

  const isHebrew = ctx.locale === "he";
  const question = isHebrew ? row.question_he : row.question_en;
  const rankGap = myRank - opener.rank;

  // Score 50 base + small bump for closer-gap opponents (1 rank > 3 ranks).
  const score = 50 + (4 - rankGap) * 2;

  return {
    key: `duel_opportunity:${row.duel_id}`,
    type: "duel_opportunity",
    urgency: "opportunity",
    score,
    icon: "Swords",
    title: isHebrew
      ? `${opener.displayName} ${rankGap === 1 ? "מקום אחד" : `${rankGap} מקומות`} מעלייך - יש הזדמנות`
      : `${opener.displayName} is ${rankGap} rank${rankGap > 1 ? "s" : ""} ahead - duel time?`,
    body: isHebrew
      ? `ההצעה: ${truncate(question, 80)} · השקעה ${row.stake} נק'`
      : `Their bet: ${truncate(question, 80)} · ${row.stake}-pt stake`,
    ctaLabel: isHebrew ? "צפה בדו-קרב" : "View duel",
    ctaHref: localePath(ctx.locale, `duels/${row.duel_id}`),
  };
};

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
