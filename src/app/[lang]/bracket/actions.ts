"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { bracketPredictions } from "@/db/schema";
import { getUser } from "@/lib/supabase/auth";

const SLOTS = ["champion", "runner_up", "third", "fourth"] as const;
type Slot = (typeof SLOTS)[number];

export type SaveBracketResult =
  | { ok: true }
  | { ok: false; error: "unauth" | "invalid" | "db" };

export async function setBracketPick(
  slot: Slot,
  teamCode: string | null,
): Promise<SaveBracketResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauth" };
  if (!SLOTS.includes(slot)) return { ok: false, error: "invalid" };

  try {
    if (teamCode === null) {
      await db
        .delete(bracketPredictions)
        .where(
          and(
            eq(bracketPredictions.userId, user.id),
            eq(bracketPredictions.slot, slot),
          ),
        );
    } else {
      await db
        .insert(bracketPredictions)
        .values({ userId: user.id, slot, teamCode })
        .onConflictDoUpdate({
          target: [bracketPredictions.userId, bracketPredictions.slot],
          set: { teamCode },
        });
    }
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    console.error("setBracketPick failed:", err);
    return { ok: false, error: "db" };
  }
}
