"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles, settings } from "@/db/schema";
import { getUser } from "@/lib/supabase/auth";

// Surface for the admin /admin/settings/scoring page. Carries:
//   • startingBank — every new player's opening points
//   • scoringExact / scoringOutcome — main 1/X/2 payouts
//   • matchRiskEnabled / matchRiskPenalty — turns wrong picks into a
//     net negative; off by default so the pool is pure-upside
//   • dailyRenewalEnabled / dailyRenewalAmount — admin-opt-in bank top-up
//   • duelMaxStake / duelDefaultJoinWindowHours — 1v1 duel limits
//   • liveOdds* — knobs converting bookmaker odds into our stake/payout
//   • stake*/payout* per custom-bet answer type (defaults the admin can
//     override per bet at creation)
//   • prizeKing* / prizeMatchesWinnerPct / prizeLiveWinnerPct /
//     prizeDuelsWinnerPct / prizeReservePct — 7-way prize split (must
//     sum to 100)
//   • prizePct1..4 — legacy top-4 split (kept until PR 5 swaps the UI;
//     allowed to be ≤ 100 to preserve the existing fractional-reserve
//     semantics)
export type ScoringPayload = {
  startingBank: number;
  scoringExact: number;
  scoringOutcome: number;
  matchRiskEnabled: boolean;
  matchRiskPenalty: number;
  dailyRenewalEnabled: boolean;
  dailyRenewalAmount: number;
  duelMaxStake: number;
  duelDefaultJoinWindowHours: number;
  duelDailyLimit: number;
  liveOddsBaseStake: number;
  liveOddsMaxPayout: number;
  liveOddsHouseEdgePct: number;
  stakeYesNo: number;
  payoutYesNo: number;
  stakeNumber: number;
  payoutNumber: number;
  stakeMultiChoice: number;
  payoutMultiChoice: number;
  stakeFreeText: number;
  payoutFreeText: number;
  // Legacy top-4 split.
  prizePct1: number;
  prizePct2: number;
  prizePct3: number;
  prizePct4: number;
  // 7-way category split (king 1/2/3, matches/live/duels winner, reserve).
  prizeKingFirstPct: number;
  prizeKingSecondPct: number;
  prizeKingThirdPct: number;
  prizeMatchesWinnerPct: number;
  prizeLiveWinnerPct: number;
  prizeDuelsWinnerPct: number;
  prizeReservePct: number;
};

// Keys that must be non-negative finite integers in [0, 32000].
const INTEGER_KEYS = [
  "startingBank",
  "scoringExact",
  "scoringOutcome",
  "matchRiskPenalty",
  "dailyRenewalAmount",
  "duelMaxStake",
  "duelDefaultJoinWindowHours",
  "duelDailyLimit",
  "liveOddsBaseStake",
  "liveOddsMaxPayout",
  "liveOddsHouseEdgePct",
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
  "prizeKingFirstPct",
  "prizeKingSecondPct",
  "prizeKingThirdPct",
  "prizeMatchesWinnerPct",
  "prizeLiveWinnerPct",
  "prizeDuelsWinnerPct",
  "prizeReservePct",
] as const satisfies ReadonlyArray<keyof ScoringPayload>;

const BOOLEAN_KEYS = [
  "matchRiskEnabled",
  "dailyRenewalEnabled",
] as const satisfies ReadonlyArray<keyof ScoringPayload>;

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

  // Validate: integers in range, booleans actually boolean, payouts > 0
  // so a correct bet is at least net-zero, sane upper bounds on duel
  // stake (1..20) matching the DB CHECK.
  for (const k of INTEGER_KEYS) {
    const v = payload[k];
    if (!Number.isFinite(v) || !Number.isInteger(v) || v < 0 || v > 32000) {
      return { ok: false, error: "invalid" };
    }
  }
  for (const k of BOOLEAN_KEYS) {
    if (typeof payload[k] !== "boolean") return { ok: false, error: "invalid" };
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
  if (payload.duelMaxStake < 1 || payload.duelMaxStake > 20) {
    return { ok: false, error: "invalid" };
  }
  if (payload.liveOddsHouseEdgePct > 50) {
    return { ok: false, error: "invalid" };
  }

  // Legacy prize percentages: each ≤ 100, sum ≤ 100 (fractional reserve
  // allowed for backward compatibility with the existing PrizeStrip UI).
  const legacyPctSum =
    payload.prizePct1 + payload.prizePct2 + payload.prizePct3 + payload.prizePct4;
  if (
    payload.prizePct1 > 100 ||
    payload.prizePct2 > 100 ||
    payload.prizePct3 > 100 ||
    payload.prizePct4 > 100 ||
    legacyPctSum > 100
  ) {
    return { ok: false, error: "invalid" };
  }

  // 7-way category split: each ≤ 100, sum MUST be exactly 100 (the DB
  // has a CHECK constraint mirroring this — the client also enforces
  // it via a disabled save button so the user sees the delta).
  const categorySum =
    payload.prizeKingFirstPct +
    payload.prizeKingSecondPct +
    payload.prizeKingThirdPct +
    payload.prizeMatchesWinnerPct +
    payload.prizeLiveWinnerPct +
    payload.prizeDuelsWinnerPct +
    payload.prizeReservePct;
  if (
    payload.prizeKingFirstPct > 100 ||
    payload.prizeKingSecondPct > 100 ||
    payload.prizeKingThirdPct > 100 ||
    payload.prizeMatchesWinnerPct > 100 ||
    payload.prizeLiveWinnerPct > 100 ||
    payload.prizeDuelsWinnerPct > 100 ||
    payload.prizeReservePct > 100 ||
    categorySum !== 100
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
        matchRiskEnabled: payload.matchRiskEnabled,
        matchRiskPenalty: payload.matchRiskPenalty,
        dailyRenewalEnabled: payload.dailyRenewalEnabled,
        dailyRenewalAmount: payload.dailyRenewalAmount,
        duelMaxStake: payload.duelMaxStake,
        duelDefaultJoinWindowHours: payload.duelDefaultJoinWindowHours,
        duelDailyLimit: payload.duelDailyLimit,
        liveOddsBaseStake: payload.liveOddsBaseStake,
        liveOddsMaxPayout: payload.liveOddsMaxPayout,
        liveOddsHouseEdgePct: payload.liveOddsHouseEdgePct,
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
        prizeKingFirstPct: payload.prizeKingFirstPct,
        prizeKingSecondPct: payload.prizeKingSecondPct,
        prizeKingThirdPct: payload.prizeKingThirdPct,
        prizeMatchesWinnerPct: payload.prizeMatchesWinnerPct,
        prizeLiveWinnerPct: payload.prizeLiveWinnerPct,
        prizeDuelsWinnerPct: payload.prizeDuelsWinnerPct,
        prizeReservePct: payload.prizeReservePct,
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

