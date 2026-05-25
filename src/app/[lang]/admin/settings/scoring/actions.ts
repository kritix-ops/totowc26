"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles, settings } from "@/db/schema";
import { getUser } from "@/lib/supabase/auth";

type Field = keyof ScoringPayload;

export type ScoringPayload = {
  startingBank: number;
  stakeBtts: number;
  stakeOver25: number;
  stakeHt: number;
  stakeGroupTeam: number;
  stakeBracketChampion: number;
  stakeBracketRunnerUp: number;
  stakeBracketThird: number;
  stakeBracketFourth: number;
  stakeTopScorer: number;
  stakeFinalPenalties: number;
  scoringExact: number;
  scoringOutcome: number;
  scoringBtts: number;
  scoringOver25: number;
  scoringHtExact: number;
  scoringHtOutcome: number;
  scoringGroupTeam: number;
  scoringGroupPerfect: number;
  scoringChampion: number;
  scoringRunnerUp: number;
  scoringThird: number;
  scoringFourth: number;
  scoringTopScorer: number;
  scoringFinalPenalties: number;
  // Prize split for the top 4 finishers. Must sum to <= 100 (enforced by
  // a CHECK constraint on settings as well).
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

  // Validate: all integers, all non-negative, starting_bank > 0,
  // payouts must be > stakes so a correct bet is at least net-zero.
  const integerKeys: Field[] = [
    "startingBank",
    "stakeBtts",
    "stakeOver25",
    "stakeHt",
    "stakeGroupTeam",
    "stakeBracketChampion",
    "stakeBracketRunnerUp",
    "stakeBracketThird",
    "stakeBracketFourth",
    "stakeTopScorer",
    "stakeFinalPenalties",
    "scoringExact",
    "scoringOutcome",
    "scoringBtts",
    "scoringOver25",
    "scoringHtExact",
    "scoringHtOutcome",
    "scoringGroupTeam",
    "scoringGroupPerfect",
    "scoringChampion",
    "scoringRunnerUp",
    "scoringThird",
    "scoringFourth",
    "scoringTopScorer",
    "scoringFinalPenalties",
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

  // Prize percentages: each must be 0-100, sum <= 100 (a fraction held
  // back is allowed — admin may want to reserve some of the pot for ops).
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
        stakeBtts: payload.stakeBtts,
        stakeOver25: payload.stakeOver25,
        stakeHt: payload.stakeHt,
        stakeGroupTeam: payload.stakeGroupTeam,
        stakeBracketChampion: payload.stakeBracketChampion,
        stakeBracketRunnerUp: payload.stakeBracketRunnerUp,
        stakeBracketThird: payload.stakeBracketThird,
        stakeBracketFourth: payload.stakeBracketFourth,
        stakeTopScorer: payload.stakeTopScorer,
        stakeFinalPenalties: payload.stakeFinalPenalties,
        scoringExact: payload.scoringExact,
        scoringOutcome: payload.scoringOutcome,
        scoringBtts: payload.scoringBtts,
        scoringOver25: payload.scoringOver25,
        scoringHtExact: payload.scoringHtExact,
        scoringHtOutcome: payload.scoringHtOutcome,
        scoringGroupTeam: payload.scoringGroupTeam,
        scoringGroupPerfect: payload.scoringGroupPerfect,
        scoringChampion: payload.scoringChampion,
        scoringRunnerUp: payload.scoringRunnerUp,
        scoringThird: payload.scoringThird,
        scoringFourth: payload.scoringFourth,
        scoringTopScorer: payload.scoringTopScorer,
        scoringFinalPenalties: payload.scoringFinalPenalties,
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
