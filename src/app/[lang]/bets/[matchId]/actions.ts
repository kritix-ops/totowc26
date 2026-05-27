"use server";

import { revalidatePath, updateTag } from "next/cache";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { matchBets } from "@/db/schema";
import { getUser } from "@/lib/supabase/auth";
import { getUserAccess } from "@/lib/access";
import { bankCacheTag } from "@/lib/bank";

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

  // Fetch the lock gate AND the live risk-mode flags in a single round
  // trip. risk_enabled is consumed below to decide what to snapshot
  // into match_bets.stake_paid_main; risk_penalty is the snapshot value.
  const row = await db.execute<{
    ok: boolean;
    risk_enabled: boolean;
    risk_penalty: number;
  }>(sql`
    select
      (
        m.status = 'scheduled'
        and m.kickoff_at > now() + ((s.bet_lock_minutes || ' minutes')::interval)
      ) as "ok",
      s.match_risk_enabled as "risk_enabled",
      s.match_risk_penalty as "risk_penalty"
    from public.matches m, public.settings s
    where m.id = ${matchId}::uuid and s.id = 1
    limit 1
  `);
  const list = row as unknown as Array<{
    ok: boolean;
    risk_enabled: boolean;
    risk_penalty: number;
  }>;
  if (list.length === 0) return { ok: false, error: "not_found" };
  if (!list[0].ok) return { ok: false, error: "locked" };
  const stakeSnapshot = list[0].risk_enabled ? list[0].risk_penalty : null;

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
