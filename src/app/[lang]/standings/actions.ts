"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { groupPredictions } from "@/db/schema";
import { getUser } from "@/lib/supabase/auth";
import { getUserAccess } from "@/lib/access";
import { bankBalanceSql, lockUserForBetting } from "@/lib/bank";

export type SaveGroupResult =
  | { ok: true; balance: number }
  | {
      ok: false;
      error: "unauth" | "not_paid" | "invalid" | "db" | "insufficient_bank";
      needed?: number;
      balance?: number;
    };

export async function saveGroupOrder(
  groupId: string,
  orderedTeamCodes: string[],
): Promise<SaveGroupResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauth" };
  const access = await getUserAccess(user.id);
  if (!access.canEdit) {
    console.info("[gate standings]", { userId: user.id, ...access });
    return { ok: false, error: "not_paid" };
  }

  if (orderedTeamCodes.length !== 4) return { ok: false, error: "invalid" };
  if (new Set(orderedTeamCodes).size !== 4) return { ok: false, error: "invalid" };

  try {
    const result = await db.transaction(async (tx) => {
      await lockUserForBetting(tx, user.id);

      const cfgRows = (await tx.execute<{ stake_group_team: number }>(sql`
        select stake_group_team from public.settings where id = 1
      `)) as unknown as Array<{ stake_group_team: number }>;
      const stakePerTeam = Number(cfgRows[0]?.stake_group_team ?? 0);
      // Group prediction = 4 team rows, each charged stakeGroupTeam.
      const newCost = stakePerTeam * 4;

      // Refund existing stake for this group (unscored rows only).
      const existing = (await tx.execute<{
        stake_paid: number;
        any_scored: boolean;
      }>(sql`
        select
          coalesce(sum(stake_paid), 0)::int                  as stake_paid,
          bool_or(points_earned is not null)                 as any_scored
        from public.group_predictions
        where user_id = ${user.id} and group_id = ${groupId}
      `)) as unknown as Array<{ stake_paid: number; any_scored: boolean }>;
      const prev = existing[0];
      if (prev?.any_scored) {
        return { ok: false as const, error: "invalid" as const };
      }
      const refund = Number(prev?.stake_paid ?? 0);

      const balanceRows = (await tx.execute<{ balance: number }>(
        sql`select ${bankBalanceSql(user.id)} as balance`,
      )) as unknown as Array<{ balance: number }>;
      const balance = Number(balanceRows[0]?.balance ?? 0);

      const effective = balance + refund;
      if (effective < newCost) {
        console.warn("[bank rejected]", {
          userId: user.id,
          betType: "group",
          groupId,
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

      // Replace any existing predictions for this user × group with the new
      // ordering. Cleanest path is delete + re-insert in the same tx.
      await tx
        .delete(groupPredictions)
        .where(
          and(
            eq(groupPredictions.userId, user.id),
            eq(groupPredictions.groupId, groupId),
          ),
        );
      await tx.insert(groupPredictions).values(
        orderedTeamCodes.map((code, idx) => ({
          userId: user.id,
          groupId,
          teamCode: code,
          predictedRank: idx + 1,
          stakePaid: stakePerTeam,
        })),
      );

      const newBalance = effective - newCost;
      console.info("[bank stake]", {
        userId: user.id,
        betType: "group",
        groupId,
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
    console.error("saveGroupOrder failed:", err);
    return { ok: false, error: "db" };
  }
}
