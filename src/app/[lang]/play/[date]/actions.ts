"use server";

import { revalidatePath, updateTag } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { customBets, userCustomBetPicks } from "@/db/schema";
import { getUser } from "@/lib/supabase/auth";
import { getUserAccess } from "@/lib/access";
import { bankBalanceSql, bankCacheTag, lockUserForBetting } from "@/lib/bank";
import type { PickAnswer } from "@/lib/bets/types";
import { resolveCustomBetLock } from "@/lib/deadlines";

type Err =
  | "unauth"
  | "not_paid"
  | "bet_not_found"
  | "bet_not_open"
  | "bet_locked"
  | "invalid_answer"
  | "insufficient_bank"
  | "db";

export type SubmitPickResult =
  | { ok: true; balanceAfter: number }
  | { ok: false; error: Err; needed?: number };

// Submit / replace the caller's pick on one custom bet. Single advisory-
// locked transaction so two tabs cannot race past the bank check.
//
// Atomicity:
//   1. Lock(userId) → serializes this user's bet-submitting paths.
//   2. Re-read bet status + lock_at + stake_snapshot.
//   3. Read existing pick (refund the old stake before charging the new).
//   4. Verify (balance + refund) >= newStake.
//   5. Upsert the pick row with the new answer + stake snapshot.
export async function submitCustomBetPick(
  customBetId: string,
  answer: PickAnswer,
): Promise<SubmitPickResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauth" };

  const access = await getUserAccess(user.id);
  if (!access.canEdit) return { ok: false, error: "not_paid" };

  try {
    const result = await db.transaction(async (tx) => {
      await lockUserForBetting(tx, user.id);

      const [bet] = await tx
        .select({
          id: customBets.id,
          scope: customBets.scope,
          status: customBets.status,
          lockAt: customBets.lockAt,
          stakeSnapshot: customBets.stakeSnapshot,
          answerType: customBets.answerType,
          answerConfig: customBets.answerConfig,
        })
        .from(customBets)
        .where(eq(customBets.id, customBetId))
        .limit(1);

      if (!bet) return { ok: false as const, error: "bet_not_found" as const };
      if (bet.status !== "open") {
        return { ok: false as const, error: "bet_not_open" as const };
      }
      const resolved = resolveCustomBetLock({
        id: bet.id,
        scope: bet.scope,
        lockAt: bet.lockAt,
      });
      const now = Date.now();
      if (resolved.effectiveLockAt.getTime() <= now) {
        console.info("[bet rejected lock]", {
          userId: user.id,
          betType: `custom_${bet.scope}`,
          betId: bet.id,
          effectiveLockAt: resolved.effectiveLockAt.toISOString(),
          skewSeconds: Math.round(
            (now - resolved.effectiveLockAt.getTime()) / 1000,
          ),
        });
        return { ok: false as const, error: "bet_locked" as const };
      }
      if (!validateAnswer(bet.answerType, bet.answerConfig as unknown, answer)) {
        return { ok: false as const, error: "invalid_answer" as const };
      }

      const [existing] = await tx
        .select({
          id: userCustomBetPicks.id,
          stakePaid: userCustomBetPicks.stakePaid,
          locked: userCustomBetPicks.locked,
        })
        .from(userCustomBetPicks)
        .where(
          and(
            eq(userCustomBetPicks.userId, user.id),
            eq(userCustomBetPicks.customBetId, customBetId),
          ),
        )
        .limit(1);

      if (existing?.locked) {
        return { ok: false as const, error: "bet_locked" as const };
      }

      // Bank check inside the txn so this user's other in-flight stakes
      // are visible. We add the existing pick's stake back since updating
      // a pick refunds the old one before charging the new.
      const balanceRows = await tx.execute(
        sql`select ${bankBalanceSql(user.id)} as balance`,
      );
      const balance = Number(
        (balanceRows as unknown as Array<{ balance: number }>)[0]?.balance ?? 0,
      );
      const refund = existing?.stakePaid ?? 0;
      const effectiveBalance = balance + refund;
      const needed = bet.stakeSnapshot - effectiveBalance;
      if (needed > 0) {
        return {
          ok: false as const,
          error: "insufficient_bank" as const,
          needed,
        };
      }

      if (existing) {
        await tx
          .update(userCustomBetPicks)
          .set({
            answer,
            stakePaid: bet.stakeSnapshot,
            updatedAt: new Date(),
          })
          .where(eq(userCustomBetPicks.id, existing.id));
      } else {
        await tx.insert(userCustomBetPicks).values({
          userId: user.id,
          customBetId,
          answer,
          stakePaid: bet.stakeSnapshot,
        });
      }

      const balanceAfter = effectiveBalance - bet.stakeSnapshot;
      return { ok: true as const, balanceAfter };
    });

    if (result.ok) {
      console.info("[custom-bet stake]", {
        userId: user.id,
        betId: customBetId,
        balanceAfter: result.balanceAfter,
      });
      // Drop this user's cached bank breakdown so the header pill
      // shows the post-stake balance on their next nav.
      updateTag(bankCacheTag(user.id));
      // The live-bets surface moved into /bets/live; revalidate
      // both paths so the cutover redirect keeps stale data off
      // either URL.
      revalidatePath("/[lang]/bets", "layout");
      revalidatePath("/[lang]/play", "layout");
      return { ok: true, balanceAfter: result.balanceAfter };
    }
    if (result.error === "insufficient_bank") {
      console.warn("[custom-bet rejected]", {
        userId: user.id,
        betId: customBetId,
        needed: result.needed,
      });
    }
    return result;
  } catch (err) {
    console.error("[custom-bet stake] failed:", err);
    return { ok: false, error: "db" };
  }
}

// Validate the player's answer against the bet's answer_type + config.
function validateAnswer(
  answerType: "yes_no" | "number" | "multi_choice" | "free_text",
  config: unknown,
  answer: PickAnswer,
): boolean {
  if (answer.type !== answerType) return false;
  if (answer.type === "yes_no") {
    return typeof answer.value === "boolean";
  }
  if (answer.type === "number") {
    if (typeof answer.value !== "number" || !Number.isFinite(answer.value)) {
      return false;
    }
    const c = config as { min?: number; max?: number } | null | undefined;
    if (c?.min !== undefined && answer.value < c.min) return false;
    if (c?.max !== undefined && answer.value > c.max) return false;
    return true;
  }
  if (answer.type === "multi_choice") {
    if (typeof answer.value !== "string" || answer.value.length === 0) return false;
    const c = config as { options?: Array<{ value: string }> } | null | undefined;
    return !!c?.options?.some((o) => o.value === answer.value);
  }
  // free_text
  if (typeof answer.value !== "string") return false;
  return answer.value.length > 0 && answer.value.length <= 200;
}
