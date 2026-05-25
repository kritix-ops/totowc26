"use server";

import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { matchBets } from "@/db/schema";
import { getUser } from "@/lib/supabase/auth";
import { getUserAccess } from "@/lib/access";
import { bankBalanceSql, lockUserForBetting } from "@/lib/bank";

export type ExtraBets = {
  btts: boolean | null;
  over25: boolean | null;
  htHome: number | null;
  htAway: number | null;
};

export type SaveBetResult =
  | { ok: true; balance: number }
  | {
      ok: false;
      error:
        | "unauth"
        | "not_paid"
        | "locked"
        | "invalid"
        | "db"
        | "not_found"
        | "insufficient_bank";
      needed?: number;
      balance?: number;
    };

export async function saveBet(
  matchId: string,
  home: number,
  away: number,
  extras: ExtraBets = { btts: null, over25: null, htHome: null, htAway: null },
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
    const result = await db.transaction(async (tx) => {
      // Serialise per-user submits so two tabs cannot double-spend the bank.
      await lockUserForBetting(tx, user.id);

      const cfgRows = (await tx.execute<{
        stake_btts: number;
        stake_over_25: number;
        stake_ht: number;
      }>(sql`
        select stake_btts, stake_over_25, stake_ht
        from public.settings where id = 1
      `)) as unknown as Array<{
        stake_btts: number;
        stake_over_25: number;
        stake_ht: number;
      }>;
      const cfg = cfgRows[0];
      if (!cfg) return { ok: false as const, error: "db" as const };

      // Stake snapshots for the side bets the user is opting into now. Null
      // mirrors the bet column itself — null means "did not opt in".
      const newStakeBtts =
        extras.btts === null ? null : Number(cfg.stake_btts);
      const newStakeOver25 =
        extras.over25 === null ? null : Number(cfg.stake_over_25);
      const newStakeHt =
        htHome !== null && htAway !== null ? Number(cfg.stake_ht) : null;
      const newCost =
        (newStakeBtts ?? 0) + (newStakeOver25 ?? 0) + (newStakeHt ?? 0);

      // Existing row's stakes get refunded — the row is being replaced.
      // If the bet is already scored we cannot refund cleanly; the RLS
      // policy also blocks edits on scored rows, so reject here too.
      const existing = (await tx.execute<{
        stake_paid_btts: number | null;
        stake_paid_over_25: number | null;
        stake_paid_ht: number | null;
        points_earned: number | null;
      }>(sql`
        select stake_paid_btts, stake_paid_over_25, stake_paid_ht, points_earned
        from public.match_bets
        where user_id = ${user.id} and match_id = ${matchId}::uuid
      `)) as unknown as Array<{
        stake_paid_btts: number | null;
        stake_paid_over_25: number | null;
        stake_paid_ht: number | null;
        points_earned: number | null;
      }>;
      const prev = existing[0];
      if (prev && prev.points_earned !== null) {
        return { ok: false as const, error: "locked" as const };
      }
      const refund =
        Number(prev?.stake_paid_btts ?? 0) +
        Number(prev?.stake_paid_over_25 ?? 0) +
        Number(prev?.stake_paid_ht ?? 0);

      const balanceRows = (await tx.execute<{ balance: number }>(
        sql`select ${bankBalanceSql(user.id)} as balance`,
      )) as unknown as Array<{ balance: number }>;
      const balance = Number(balanceRows[0]?.balance ?? 0);

      // Effective balance = current balance + refund of stakes on the row
      // we are about to overwrite. The deduction itself happens on UPSERT.
      const effective = balance + refund;
      if (effective < newCost) {
        console.warn("[bank rejected]", {
          userId: user.id,
          betType: "match",
          matchId,
          cost: newCost,
          balance,
          refund,
        });
        return {
          ok: false as const,
          error: "insufficient_bank" as const,
          needed: newCost - effective,
          balance,
        };
      }

      await tx
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
          stakePaidBtts: newStakeBtts,
          stakePaidOver25: newStakeOver25,
          stakePaidHt: newStakeHt,
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
            stakePaidBtts: newStakeBtts,
            stakePaidOver25: newStakeOver25,
            stakePaidHt: newStakeHt,
            updatedAt: new Date(),
          },
        });

      const newBalance = effective - newCost;
      console.info("[bank stake]", {
        userId: user.id,
        betType: "match",
        matchId,
        cost: newCost,
        refund,
        oldBalance: balance,
        newBalance,
      });
      return { ok: true as const, balance: newBalance };
    });

    if (!result.ok) return result;
    revalidatePath("/", "layout");
    return { ok: true, balance: result.balance };
  } catch (err) {
    console.error("saveBet failed:", err);
    return { ok: false, error: "db" };
  }
}
