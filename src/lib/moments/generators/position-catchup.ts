import "server-only";

import { sql } from "drizzle-orm";
import { execFirstRow } from "@/db/helpers";
import { getMyRankSummary } from "@/db/queries";
import { localePath } from "@/lib/paths";
import type { Generator } from "../types";

// "You are in the bottom half - here are N open bets that could close
// the gap."
//
// Lights up when the viewer is in the lower half of the leaderboard
// AND there are open custom bets (any scope) they have not picked.
// The body names the actual count and the gap so it feels like the
// dashboard is reading the room.
//
// Uses getMyRankSummary so the rank shown here matches the leaderboard
// surface exactly (same formula, includes duel deltas). A divergent
// custom calculation here would let a player see "rank 3" on the
// dashboard and "rank 7" inside this card — broken trust signal.
//
// See _plans/2026-05-30-smart-reminders.md §3.2.

type Row = {
  unpicked_count: number;
};

export const positionCatchup: Generator = async (ctx) => {
  // Two parallel reads: the canonical rank summary + the count of
  // open custom bets the user has not picked.
  const [rank, openRow] = await Promise.all([
    getMyRankSummary(ctx.userId),
    execFirstRow<Row>(sql`
      select count(*)::int as "unpicked_count"
      from public.custom_bets cb
      left join public.user_custom_bet_picks pk
        on pk.user_id = ${ctx.userId}::uuid and pk.custom_bet_id = cb.id
      where cb.status = 'open'
        and cb.lock_at > now()
        and pk.id is null
    `),
  ]);

  const unpickedCount = openRow?.unpicked_count ?? 0;
  if (!rank.myRank || rank.total < 4) {
    console.info("[moments position_catchup]", {
      userId: ctx.userId,
      skipped: "tiny_pool_or_unranked",
      myRank: rank.myRank,
      total: rank.total,
    });
    return null;
  }

  // Bottom half threshold, rounded up so a 7-player pool still
  // triggers at rank 4+ rather than only at the very tail.
  const halfwayPoint = Math.ceil(rank.total / 2);
  if (rank.myRank < halfwayPoint) {
    console.info("[moments position_catchup]", {
      userId: ctx.userId,
      skipped: "top_half",
      myRank: rank.myRank,
      total: rank.total,
    });
    return null;
  }
  if (unpickedCount < 3) {
    console.info("[moments position_catchup]", {
      userId: ctx.userId,
      skipped: "few_open_bets",
      unpickedCount,
    });
    return null;
  }

  const isHebrew = ctx.locale === "he";
  // Score 55 base, bumps for deeper-position and more available bets.
  // Both bumps capped so the moment cannot dominate every Hub render.
  const positionDepth =
    (rank.myRank - halfwayPoint) / Math.max(1, rank.total - halfwayPoint);
  const score = 55 + Math.round(positionDepth * 10) + Math.min(8, unpickedCount);

  const gapToLeader = rank.gapToLeader;

  const moment = {
    key: "position_catchup",
    type: "position_catchup" as const,
    urgency: "opportunity" as const,
    score,
    icon: "TrendingUp" as const,
    title: isHebrew
      ? `מקום ${rank.myRank} מתוך ${rank.total} - יש מה לעשות`
      : `Rank ${rank.myRank} of ${rank.total} - room to climb`,
    body: isHebrew
      ? `${unpickedCount} הימורים פתוחים שעוד לא הימרת עליהם${gapToLeader > 0 ? `. ${gapToLeader} נק' מהמוביל` : ""}.`
      : `${unpickedCount} bets open you haven't placed${gapToLeader > 0 ? `. ${gapToLeader} pts behind the leader` : ""}.`,
    ctaLabel: isHebrew ? "ראה הימורים פתוחים" : "Browse open bets",
    ctaHref: localePath(ctx.locale, "bets"),
  };

  console.info("[moments position_catchup]", {
    userId: ctx.userId,
    myRank: rank.myRank,
    total: rank.total,
    unpickedCount,
    gapToLeader,
    score,
  });
  return moment;
};
