"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { specialBets } from "@/db/schema";
import { getUser } from "@/lib/supabase/auth";
import { getUserAccess } from "@/lib/access";
import { bankBalanceSql, lockUserForBetting } from "@/lib/bank";

type Slot = "top_scorer" | "final_penalties";

export type SaveSpecialResult =
  | { ok: true; balance: number }
  | {
      ok: false;
      error: "unauth" | "not_paid" | "invalid" | "db" | "insufficient_bank";
      needed?: number;
      balance?: number;
    };

const STAKE_COLUMN: Record<Slot, string> = {
  top_scorer: "stake_top_scorer",
  final_penalties: "stake_final_penalties",
};

export async function saveSpecial(
  slot: Slot,
  value: string,
): Promise<SaveSpecialResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauth" };
  const access = await getUserAccess(user.id);
  if (!access.canEdit) {
    console.info("[gate specials]", { userId: user.id, ...access });
    return { ok: false, error: "not_paid" };
  }

  const v = value.trim();

  // Validate per-slot value shape before touching the bank.
  if (v) {
    if (slot === "final_penalties" && v !== "yes" && v !== "no") {
      return { ok: false, error: "invalid" };
    }
    if (slot === "top_scorer" && v.length < 2) {
      return { ok: false, error: "invalid" };
    }
  }

  try {
    const result = await db.transaction(async (tx) => {
      await lockUserForBetting(tx, user.id);

      const existing = (await tx.execute<{
        stake_paid: number | null;
        points_earned: number | null;
      }>(sql`
        select stake_paid, points_earned
        from public.special_bets
        where user_id = ${user.id} and bet_type = ${slot}::special_bet_type
      `)) as unknown as Array<{
        stake_paid: number | null;
        points_earned: number | null;
      }>;
      const prev = existing[0];
      if (prev && prev.points_earned !== null) {
        return { ok: false as const, error: "invalid" as const };
      }
      const refund = Number(prev?.stake_paid ?? 0);

      if (!v) {
        // Empty value means "clear my pick" — refund the existing stake.
        await tx
          .delete(specialBets)
          .where(
            and(
              eq(specialBets.userId, user.id),
              eq(specialBets.betType, slot),
            ),
          );
        const balanceRows = (await tx.execute<{ balance: number }>(
          sql`select ${bankBalanceSql(user.id)} as balance`,
        )) as unknown as Array<{ balance: number }>;
        const newBalance = Number(balanceRows[0]?.balance ?? 0);
        console.info("[bank stake]", {
          userId: user.id,
          betType: "special",
          slot,
          cost: 0,
          refund,
          newBalance,
        });
        return { ok: true as const, balance: newBalance };
      }

      const cfgRows = (await tx.execute<{ stake: number }>(sql`
        select ${sql.raw(STAKE_COLUMN[slot])} as stake
        from public.settings where id = 1
      `)) as unknown as Array<{ stake: number }>;
      const stake = Number(cfgRows[0]?.stake ?? 0);

      const balanceRows = (await tx.execute<{ balance: number }>(
        sql`select ${bankBalanceSql(user.id)} as balance`,
      )) as unknown as Array<{ balance: number }>;
      const balance = Number(balanceRows[0]?.balance ?? 0);

      const effective = balance + refund;
      if (effective < stake) {
        console.warn("[bank rejected]", {
          userId: user.id,
          betType: "special",
          slot,
          cost: stake,
          balance,
          refund,
        });
        return {
          ok: false as const,
          error: "insufficient_bank" as const,
          needed: stake - effective,
          balance,
        };
      }

      await tx
        .insert(specialBets)
        .values({ userId: user.id, betType: slot, value: v, stakePaid: stake })
        .onConflictDoUpdate({
          target: [specialBets.userId, specialBets.betType],
          set: { value: v, stakePaid: stake, updatedAt: new Date() },
        });

      const newBalance = effective - stake;
      console.info("[bank stake]", {
        userId: user.id,
        betType: "special",
        slot,
        cost: stake,
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
    console.error("saveSpecial failed:", err);
    return { ok: false, error: "db" };
  }
}
