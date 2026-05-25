"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { bracketPredictions } from "@/db/schema";
import { getUser } from "@/lib/supabase/auth";
import { getUserAccess } from "@/lib/access";
import { bankBalanceSql, lockUserForBetting } from "@/lib/bank";

const SLOTS = ["champion", "runner_up", "third", "fourth"] as const;
type Slot = (typeof SLOTS)[number];

export type SaveBracketResult =
  | { ok: true; balance: number }
  | {
      ok: false;
      error: "unauth" | "not_paid" | "invalid" | "db" | "insufficient_bank";
      needed?: number;
      balance?: number;
    };

// Stake column on settings for each bracket slot.
const STAKE_COLUMN: Record<Slot, string> = {
  champion: "stake_bracket_champion",
  runner_up: "stake_bracket_runner_up",
  third: "stake_bracket_third",
  fourth: "stake_bracket_fourth",
};

export async function setBracketPick(
  slot: Slot,
  teamCode: string | null,
): Promise<SaveBracketResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauth" };
  const access = await getUserAccess(user.id);
  if (!access.canEdit) {
    console.info("[gate bracket]", { userId: user.id, ...access });
    return { ok: false, error: "not_paid" };
  }
  if (!SLOTS.includes(slot)) return { ok: false, error: "invalid" };

  try {
    const result = await db.transaction(async (tx) => {
      await lockUserForBetting(tx, user.id);

      // Look up the stake cost for this specific slot. We pick the column
      // by name; the slot value is constrained to the SLOTS tuple above so
      // there is no SQL-injection surface here.
      const cfgRows = (await tx.execute<{ stake: number }>(sql`
        select ${sql.raw(STAKE_COLUMN[slot])} as stake
        from public.settings where id = 1
      `)) as unknown as Array<{ stake: number }>;
      const stake = Number(cfgRows[0]?.stake ?? 0);

      // Existing row gets refunded; reject if it's already been scored.
      const existing = (await tx.execute<{
        stake_paid: number | null;
        points_earned: number | null;
      }>(sql`
        select stake_paid, points_earned
        from public.bracket_predictions
        where user_id = ${user.id} and slot = ${slot}::bracket_slot
      `)) as unknown as Array<{
        stake_paid: number | null;
        points_earned: number | null;
      }>;
      const prev = existing[0];
      if (prev && prev.points_earned !== null) {
        return { ok: false as const, error: "invalid" as const };
      }
      const refund = Number(prev?.stake_paid ?? 0);

      if (teamCode === null) {
        // Clearing the pick: refund the existing stake by deleting the row.
        // No new charge.
        await tx
          .delete(bracketPredictions)
          .where(
            and(
              eq(bracketPredictions.userId, user.id),
              eq(bracketPredictions.slot, slot),
            ),
          );
        const balanceRows = (await tx.execute<{ balance: number }>(
          sql`select ${bankBalanceSql(user.id)} as balance`,
        )) as unknown as Array<{ balance: number }>;
        const newBalance = Number(balanceRows[0]?.balance ?? 0);
        console.info("[bank stake]", {
          userId: user.id,
          betType: "bracket",
          slot,
          cost: 0,
          refund,
          newBalance,
        });
        return { ok: true as const, balance: newBalance };
      }

      const balanceRows = (await tx.execute<{ balance: number }>(
        sql`select ${bankBalanceSql(user.id)} as balance`,
      )) as unknown as Array<{ balance: number }>;
      const balance = Number(balanceRows[0]?.balance ?? 0);

      const effective = balance + refund;
      if (effective < stake) {
        console.warn("[bank rejected]", {
          userId: user.id,
          betType: "bracket",
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
        .insert(bracketPredictions)
        .values({ userId: user.id, slot, teamCode, stakePaid: stake })
        .onConflictDoUpdate({
          target: [bracketPredictions.userId, bracketPredictions.slot],
          set: { teamCode, stakePaid: stake },
        });

      const newBalance = effective - stake;
      console.info("[bank stake]", {
        userId: user.id,
        betType: "bracket",
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
    console.error("setBracketPick failed:", err);
    return { ok: false, error: "db" };
  }
}
