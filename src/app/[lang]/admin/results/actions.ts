"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tournamentResults } from "@/db/schema";
import { getUser } from "@/lib/supabase/auth";
import { profiles } from "@/db/schema";
import { scoreSpecialBets } from "@/lib/sync";

export type SaveResultsInput = {
  topScorer: string;
  finalWentToPenalties: "yes" | "no" | "";
};

export type SaveResultsResult =
  | { ok: true; scored: number }
  | { ok: false; error: "unauth" | "forbidden" | "db" };

async function requireAdminUser() {
  const user = await getUser();
  if (!user) return null;
  const [p] = await db
    .select({ role: profiles.role })
    .from(profiles)
    .where(eq(profiles.id, user.id))
    .limit(1);
  if (!p || p.role !== "admin") return null;
  return user;
}

export async function saveTournamentResults(
  input: SaveResultsInput,
): Promise<SaveResultsResult> {
  const user = await requireAdminUser();
  if (!user) return { ok: false, error: "forbidden" };

  const topScorer = input.topScorer.trim() || null;
  const finalWentToPenalties =
    input.finalWentToPenalties === "yes"
      ? true
      : input.finalWentToPenalties === "no"
        ? false
        : null;

  try {
    await db
      .insert(tournamentResults)
      .values({ id: 1, topScorer, finalWentToPenalties })
      .onConflictDoUpdate({
        target: tournamentResults.id,
        set: { topScorer, finalWentToPenalties, updatedAt: new Date() },
      });
    const scored = await scoreSpecialBets();
    revalidatePath("/", "layout");
    return { ok: true, scored };
  } catch (err) {
    console.error("saveTournamentResults failed:", err);
    return { ok: false, error: "db" };
  }
}
