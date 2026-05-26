"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles, settings } from "@/db/schema";
import { getUser } from "@/lib/supabase/auth";

type Field = keyof ScoringPayload;

// After the legacy cleanup the settings surface only carries:
//   • startingBank — every player's opening points
//   • scoringExact / scoringOutcome — the main 1/X/2 payout (free pick)
//   • stake*/payout* per custom-bet answer type (defaults that the
//     admin can override per bet at creation)
//   • prizePct1..4 — pot split (must sum to ≤ 100)
export type ScoringPayload = {
  startingBank: number;
  scoringExact: number;
  scoringOutcome: number;
  stakeYesNo: number;
  payoutYesNo: number;
  stakeNumber: number;
  payoutNumber: number;
  stakeMultiChoice: number;
  payoutMultiChoice: number;
  stakeFreeText: number;
  payoutFreeText: number;
  prizePct1: number;
  prizePct2: number;
  prizePct3: number;
  prizePct4: number;
};

export type SaveScoringResult =
  | { ok: true }
  | { ok: false; error: "unauth" | "forbidden" | "invalid" | "db" };

async function isAdminUser(): Promise<string | null> {
  const user = await getUser();
  if (!user) return null;
  const [p] = await db
    .select({ role: profiles.role })
    .from(profiles)
    .where(eq(profiles.id, user.id))
    .limit(1);
  if (!p || p.role !== "admin") return null;
  return user.id;
}

export async function saveScoringSettings(
  payload: ScoringPayload,
): Promise<SaveScoringResult> {
  const adminId = await isAdminUser();
  if (!adminId) return { ok: false, error: "forbidden" };

  // Validate: all integers, all non-negative, startingBank > 0,
  // payouts must be > 0 so a correct bet is at least net-zero.
  const integerKeys: Field[] = [
    "startingBank",
    "scoringExact",
    "scoringOutcome",
    "stakeYesNo",
    "payoutYesNo",
    "stakeNumber",
    "payoutNumber",
    "stakeMultiChoice",
    "payoutMultiChoice",
    "stakeFreeText",
    "payoutFreeText",
    "prizePct1",
    "prizePct2",
    "prizePct3",
    "prizePct4",
  ];
  for (const k of integerKeys) {
    const v = payload[k];
    if (!Number.isFinite(v) || !Number.isInteger(v) || v < 0 || v > 32000) {
      return { ok: false, error: "invalid" };
    }
  }
  if (payload.startingBank < 1) return { ok: false, error: "invalid" };
  if (
    payload.payoutYesNo < 1 ||
    payload.payoutNumber < 1 ||
    payload.payoutMultiChoice < 1 ||
    payload.payoutFreeText < 1
  ) {
    return { ok: false, error: "invalid" };
  }

  // Prize percentages: each ≤ 100, sum ≤ 100 (a fraction held back is
  // fine — admin may reserve some of the pot for ops).
  const pctSum =
    payload.prizePct1 + payload.prizePct2 + payload.prizePct3 + payload.prizePct4;
  if (
    payload.prizePct1 > 100 ||
    payload.prizePct2 > 100 ||
    payload.prizePct3 > 100 ||
    payload.prizePct4 > 100 ||
    pctSum > 100
  ) {
    return { ok: false, error: "invalid" };
  }

  try {
    await db
      .update(settings)
      .set({
        startingBank: payload.startingBank,
        scoringExact: payload.scoringExact,
        scoringOutcome: payload.scoringOutcome,
        stakeYesNo: payload.stakeYesNo,
        payoutYesNo: payload.payoutYesNo,
        stakeNumber: payload.stakeNumber,
        payoutNumber: payload.payoutNumber,
        stakeMultiChoice: payload.stakeMultiChoice,
        payoutMultiChoice: payload.payoutMultiChoice,
        stakeFreeText: payload.stakeFreeText,
        payoutFreeText: payload.payoutFreeText,
        prizePct1: payload.prizePct1,
        prizePct2: payload.prizePct2,
        prizePct3: payload.prizePct3,
        prizePct4: payload.prizePct4,
        updatedAt: new Date(),
      })
      .where(eq(settings.id, 1));
    console.info("[settings updated]", { by: adminId, payload });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    console.error("saveScoringSettings failed:", err);
    return { ok: false, error: "db" };
  }
}

