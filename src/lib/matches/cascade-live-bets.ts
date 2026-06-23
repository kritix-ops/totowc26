import "server-only";

import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { betGradingAudit, customBets, userCustomBetPicks } from "@/db/schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type CascadedVoid = {
  betId: string;
  questionHe: string;
  pickerIds: string[];
};

// Void + refund every match-scoped live bet attached to a canceled match,
// inside the caller's transaction. A canceled match can never produce the
// stats those bets grade against (corners, cards, over/under...), so they are
// always unwound regardless of how the 1/X/2 guesses are later resolved —
// confirmed product decision.
//
// Reuses voidCustomBet's primitive: setting points_earned = stake_paid nets
// every pick to zero in the bank formula, so each picker is made whole win or
// lose, graded or not. One immutable audit row per bet. Returns the per-bet
// picker lists so the caller can fire feed notices AFTER the commit.
export async function cascadeVoidMatchLiveBets(
  tx: Tx,
  matchId: string,
  performedBy: string,
  reason: string,
): Promise<CascadedVoid[]> {
  const bets = await tx
    .select({
      id: customBets.id,
      status: customBets.status,
      resolvedValue: customBets.resolvedValue,
      questionHe: customBets.questionHe,
    })
    .from(customBets)
    .where(
      and(
        eq(customBets.matchId, matchId),
        eq(customBets.scope, "match"),
        ne(customBets.status, "cancelled"),
      ),
    );

  const result: CascadedVoid[] = [];
  for (const bet of bets) {
    const refunded = await tx
      .update(userCustomBetPicks)
      .set({
        pointsEarned: sql`${userCustomBetPicks.stakePaid}`,
        updatedAt: new Date(),
      })
      .where(eq(userCustomBetPicks.customBetId, bet.id))
      .returning({ userId: userCustomBetPicks.userId });

    await tx.insert(betGradingAudit).values({
      customBetId: bet.id,
      action: "cancel",
      previousStatus: bet.status,
      newStatus: "cancelled",
      previousResolvedValue: bet.resolvedValue as unknown,
      newResolvedValue: null,
      reason,
      performedBy,
    });

    await tx
      .update(customBets)
      .set({
        status: "cancelled",
        resolvedValue: null,
        gradedAt: null,
        gradedBy: null,
        updatedAt: new Date(),
      })
      .where(eq(customBets.id, bet.id));

    // One pick per (user, bet) by unique index, so distinct users == picks.
    result.push({
      betId: bet.id,
      questionHe: bet.questionHe,
      pickerIds: [...new Set(refunded.map((r) => r.userId))],
    });
  }

  return result;
}
