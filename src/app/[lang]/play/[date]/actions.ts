"use server";

import { revalidatePath, updateTag } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { customBets, userCustomBetPicks } from "@/db/schema";
import { getUser } from "@/lib/supabase/auth";
import { getUserAccess } from "@/lib/access";
import { bankBalanceSql, bankCacheTag, lockUserForBetting } from "@/lib/bank";
import type { PickAnswer } from "@/lib/bets/types";
import { resolvePickPayoutAtSubmit } from "@/lib/bets/payout";
import { isFreePickScope } from "@/lib/bets/free-pick-scopes";
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
          payoutSnapshot: customBets.payoutSnapshot,
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
      //
      // Tournament/stage/group bets are free picks (see
      // src/lib/bets/free-pick-scopes.ts): the stake is forced to 0
      // regardless of what bet.stakeSnapshot says, so a legacy record
      // that still carries a non-zero stakeSnapshot still costs the
      // player nothing. Logged so we can verify the override fired.
      const isFreePick = isFreePickScope(bet.scope);
      const effectiveStake = isFreePick ? 0 : bet.stakeSnapshot;
      if (isFreePick && bet.stakeSnapshot > 0) {
        console.info("[free-pick scope]", {
          betId: bet.id,
          scope: bet.scope,
          legacyStakeSnapshot: bet.stakeSnapshot,
        });
      }
      const balanceRows = await tx.execute(
        sql`select ${bankBalanceSql(user.id)} as balance`,
      );
      const balance = Number(
        (balanceRows as unknown as Array<{ balance: number }>)[0]?.balance ?? 0,
      );
      const refund = existing?.stakePaid ?? 0;
      const effectiveBalance = balance + refund;
      const needed = effectiveStake - effectiveBalance;
      if (needed > 0) {
        return {
          ok: false as const,
          error: "insufficient_bank" as const,
          needed,
        };
      }

      // Resolve per-option payout (Top scorer, Champion, Group winners,
      // ...) — falls back to bet.payoutSnapshot for flat-payout bets.
      // Snapshotted at pick time so a later admin re-publish of the
      // bet does not retro-reprice this user's locked-in pick.
      const pickPayout = resolvePickPayoutAtSubmit({
        answerType: bet.answerType,
        answerConfig: bet.answerConfig,
        answer,
        betLevelPayout: bet.payoutSnapshot,
      });

      if (existing) {
        await tx
          .update(userCustomBetPicks)
          .set({
            answer,
            stakePaid: effectiveStake,
            payoutSnapshot: pickPayout,
            updatedAt: new Date(),
          })
          .where(eq(userCustomBetPicks.id, existing.id));
      } else {
        await tx.insert(userCustomBetPicks).values({
          userId: user.id,
          customBetId,
          answer,
          stakePaid: effectiveStake,
          payoutSnapshot: pickPayout,
        });
      }

      const balanceAfter = effectiveBalance - effectiveStake;
      return { ok: true as const, balanceAfter, pickPayout };
    });

    if (result.ok) {
      console.info("[custom-bet stake]", {
        userId: user.id,
        betId: customBetId,
        balanceAfter: result.balanceAfter,
        pickPayout: result.pickPayout,
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
