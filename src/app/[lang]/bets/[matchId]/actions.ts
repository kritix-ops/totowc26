"use server";

import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { matchBets } from "@/db/schema";
import { getUser } from "@/lib/supabase/auth";

export type ExtraBets = {
  btts: boolean | null;
  over25: boolean | null;
  htHome: number | null;
  htAway: number | null;
};

export type SaveBetResult =
  | { ok: true }
  | { ok: false; error: "unauth" | "locked" | "invalid" | "db" | "not_found" };

export async function saveBet(
  matchId: string,
  home: number,
  away: number,
  extras: ExtraBets = { btts: null, over25: null, htHome: null, htAway: null },
): Promise<SaveBetResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauth" };
  if (!Number.isFinite(home) || !Number.isFinite(away)) {
    return { ok: false, error: "invalid" };
  }
  const h = Math.max(0, Math.min(99, Math.floor(home)));
  const a = Math.max(0, Math.min(99, Math.floor(away)));

  const normalizeHt = (n: number | null) => {
    if (n === null || !Number.isFinite(n)) return null;
    return Math.max(0, Math.min(99, Math.floor(n)));
  };
  const htH = normalizeHt(extras.htHome);
  const htA = normalizeHt(extras.htAway);
  // Halftime is all-or-nothing: either both numbers are present or neither.
  const htHome = htH !== null && htA !== null ? htH : null;
  const htAway = htH !== null && htA !== null ? htA : null;

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
      .values({
        userId: user.id,
        matchId,
        homeScore: h,
        awayScore: a,
        betBtts: extras.btts,
        betOver25: extras.over25,
        betHtHome: htHome,
        betHtAway: htAway,
      })
      .onConflictDoUpdate({
        target: [matchBets.userId, matchBets.matchId],
        set: {
          homeScore: h,
          awayScore: a,
          betBtts: extras.btts,
          betOver25: extras.over25,
          betHtHome: htHome,
          betHtAway: htAway,
          updatedAt: new Date(),
        },
      });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    console.error("saveBet failed:", err);
    return { ok: false, error: "db" };
  }
}
