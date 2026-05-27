"use server";

import { revalidatePath, updateTag } from "next/cache";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { matchBets } from "@/db/schema";
import { getUser } from "@/lib/supabase/auth";
import { getUserAccess } from "@/lib/access";
import { bankCacheTag } from "@/lib/bank";
import {
  getDeadlineContext,
  resolveMatchScoreLock,
} from "@/lib/deadlines";

// 1/X/2 match-bet submission. The main pick still does not debit the
// bank at submit time - points (positive or negative) are credited by
// scoreFinalMatches() once the match is final. What we DO snapshot here
// is the risk-penalty currently in force: if the admin has flipped
// match_risk_enabled on, we record the penalty value on the row so
// /me/bank can display "5 pts at risk on this pick". The actual scoring
// math reads live settings at grade time - see src/lib/sync.ts §5.
// Custom side bets live in the user_custom_bet_picks system instead.

export type SaveBetResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | "unauth"
        | "not_paid"
        | "locked"
        | "invalid"
        | "db"
        | "not_found";
    };

export async function saveBet(
  matchId: string,
  home: number,
  away: number,
): Promise<SaveBetResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauth" };
  const access = await getUserAccess(user.id);
  if (!access.canEdit) {
    console.info("[gate bets]", { userId: user.id, ...access });
    return { ok: false, error: "not_paid" };
  }
  if (!Number.isFinite(home) || !Number.isFinite(away)) {
    return { ok: false, error: "invalid" };
  }
  const h = Math.max(0, Math.min(99, Math.floor(home)));
  const a = Math.max(0, Math.min(99, Math.floor(away)));

  // Fetch the inputs the deadline resolver needs + the live risk-mode
  // flags in a single round trip. The matchday row is joined by
  // date(kickoff AT TIME ZONE 'Asia/Jerusalem') = md.date so the
  // matchday-level offset override applies to the right day. If no
  // matchday row exists yet (admin hasn't materialised it), md fields
  // come back null and the resolver falls through to the type default.
  const row = await db.execute<{
    status: string;
    kickoff_at: string;
    lock_at_override: string | null;
    matchday_offset: number | null;
    risk_enabled: boolean;
    risk_penalty: number;
  }>(sql`
    select
      m.status::text as "status",
      m.kickoff_at as "kickoff_at",
      m.lock_at_override as "lock_at_override",
      md.lock_offset_override_minutes as "matchday_offset",
      s.match_risk_enabled as "risk_enabled",
      s.match_risk_penalty as "risk_penalty"
    from public.matches m
    cross join public.settings s
    left join public.matchdays md
      on md.date = (m.kickoff_at at time zone 'Asia/Jerusalem')::date
    where m.id = ${matchId}::uuid and s.id = 1
    limit 1
  `);
  const list = row as unknown as Array<{
    status: string;
    kickoff_at: string;
    lock_at_override: string | null;
    matchday_offset: number | null;
    risk_enabled: boolean;
    risk_penalty: number;
  }>;
  if (list.length === 0) return { ok: false, error: "not_found" };
  const r = list[0];
  if (r.status !== "scheduled") return { ok: false, error: "locked" };

  const context = await getDeadlineContext();
  const resolved = resolveMatchScoreLock(
    {
      matchId,
      kickoffAt: new Date(r.kickoff_at),
      lockAtOverride: r.lock_at_override ? new Date(r.lock_at_override) : null,
      matchdayLockOffsetMinutes: r.matchday_offset,
    },
    context,
  );
  const now = Date.now();
  if (resolved.effectiveLockAt.getTime() <= now) {
    console.info("[bet rejected lock]", {
      userId: user.id,
      betType: "match_score",
      matchId,
      effectiveLockAt: resolved.effectiveLockAt.toISOString(),
      skewSeconds: Math.round((now - resolved.effectiveLockAt.getTime()) / 1000),
    });
    return { ok: false, error: "locked" };
  }
  const stakeSnapshot = r.risk_enabled ? r.risk_penalty : null;

  try {
    await db
      .insert(matchBets)
      .values({
        userId: user.id,
        matchId,
        homeScore: h,
        awayScore: a,
        stakePaidMain: stakeSnapshot,
      })
      .onConflictDoUpdate({
        target: [matchBets.userId, matchBets.matchId],
        set: {
          homeScore: h,
          awayScore: a,
          stakePaidMain: stakeSnapshot,
          updatedAt: new Date(),
        },
      });

    console.info("[match-bet save]", {
      userId: user.id,
      matchId,
      home: h,
      away: a,
      stakePaidMain: stakeSnapshot,
    });
    // Bank read used by the header pill cached match_bets sums; bust
    // this user's bank entry so the next paint reflects the new stake
    // snapshot.
    updateTag(bankCacheTag(user.id));
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    console.error("saveBet failed:", err);
    return { ok: false, error: "db" };
  }
}
