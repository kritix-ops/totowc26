"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { specialBets } from "@/db/schema";
import { getUser } from "@/lib/supabase/auth";

type Slot = "top_scorer" | "final_penalties";

export type SaveSpecialResult =
  | { ok: true }
  | { ok: false; error: "unauth" | "invalid" | "db" };

export async function saveSpecial(
  slot: Slot,
  value: string,
): Promise<SaveSpecialResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauth" };

  const v = value.trim();
  if (!v) {
    // Empty value means "clear my pick"
    try {
      await db
        .delete(specialBets)
        .where(
          and(eq(specialBets.userId, user.id), eq(specialBets.betType, slot)),
        );
      revalidatePath("/", "layout");
      return { ok: true };
    } catch {
      return { ok: false, error: "db" };
    }
  }

  if (slot === "final_penalties" && v !== "yes" && v !== "no") {
    return { ok: false, error: "invalid" };
  }
  if (slot === "top_scorer" && v.length < 2) {
    return { ok: false, error: "invalid" };
  }

  try {
    await db
      .insert(specialBets)
      .values({ userId: user.id, betType: slot, value: v })
      .onConflictDoUpdate({
        target: [specialBets.userId, specialBets.betType],
        set: { value: v, updatedAt: new Date() },
      });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    console.error("saveSpecial failed:", err);
    return { ok: false, error: "db" };
  }
}
