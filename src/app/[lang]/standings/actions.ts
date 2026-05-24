"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { groupPredictions } from "@/db/schema";
import { getUser } from "@/lib/supabase/auth";

export type SaveGroupResult =
  | { ok: true }
  | { ok: false; error: "unauth" | "invalid" | "db" };

export async function saveGroupOrder(
  groupId: string,
  orderedTeamCodes: string[],
): Promise<SaveGroupResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauth" };

  if (orderedTeamCodes.length !== 4) return { ok: false, error: "invalid" };
  if (new Set(orderedTeamCodes).size !== 4) return { ok: false, error: "invalid" };

  try {
    // Replace any existing predictions for this user × group with the new
    // ordering. Cleanest path is delete + re-insert in one transaction.
    await db.transaction(async (tx) => {
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
        })),
      );
    });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    console.error("saveGroupOrder failed:", err);
    return { ok: false, error: "db" };
  }
}
