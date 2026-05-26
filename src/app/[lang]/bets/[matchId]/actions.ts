"use server";

import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { matchBets } from "@/db/schema";
import { getUser } from "@/lib/supabase/auth";
import { getUserAccess } from "@/lib/access";

// 1/X/2 match-bet submission. The main pick is free (stake_main = 0),
// so this action never touches the bank — no advisory lock needed.
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

  const row = await db.execute<{ ok: boolean }>(sql`
    select (
      m.status = 'scheduled'
      and m.kickoff_at > now() + ((s.bet_lock_minutes || ' minutes')::interval)
    ) as "ok"
    from public.matches m, public.settings s
    where m.id = ${matchId}::uuid and s.id = 1
    limit 1
  `);
  const list = row as unknown as Array<{ ok: boolean }>;
  if (list.length === 0) return { ok: false, error: "not_found" };
  if (!list[0].ok) return { ok: false, error: "locked" };

  try {
    await db
      .insert(matchBets)
      .values({ userId: user.id, matchId, homeScore: h, awayScore: a })
      .onConflictDoUpdate({
        target: [matchBets.userId, matchBets.matchId],
        set: { homeScore: h, awayScore: a, updatedAt: new Date() },
      });

    console.info("[match-bet save]", {
      userId: user.id,
      matchId,
      home: h,
      away: a,
    });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    console.error("saveBet failed:", err);
    return { ok: false, error: "db" };
  }
}
