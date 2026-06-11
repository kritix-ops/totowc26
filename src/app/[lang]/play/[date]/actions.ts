"use server";

import { revalidatePath, updateTag } from "next/cache";
import { bankCacheTag } from "@/lib/bank";
import { getUser } from "@/lib/supabase/auth";
import { getUserAccess } from "@/lib/access";
import type { PickAnswer } from "@/lib/bets/types";
import { writeCustomPick, type WriteOutcome } from "@/lib/bets/write-core";

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

// Submit / replace the caller's pick on one custom bet. The advisory-locked
// transaction, status + deadline checks, bank check and per-option payout
// snapshot all live in the shared write-core (src/lib/bets/write-core.ts), so
// this action, the "Surprise me" bulk fill and the monkey bot cannot diverge.
//
// `stake` is the player-chosen risk for live (match/day) bets. Optional:
// when omitted, write-core uses the bet's snapshotted default. Tampered
// values get clamped server-side; the bet card never sends out-of-range
// numbers. Free-pick scopes (tournament/stage/group) ignore it.
export async function submitCustomBetPick(
  customBetId: string,
  answer: PickAnswer,
  stake?: number,
): Promise<SubmitPickResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauth" };

  const access = await getUserAccess(user.id);
  const res = await writeCustomPick(
    { kind: "self", userId: user.id, access },
    { customBetId, answer, requestedStake: stake },
    { overwrite: true },
  );

  if (res.status === "filled") {
    console.info("[custom-bet stake]", {
      userId: user.id,
      betId: customBetId,
      requestedStake: stake,
      balanceAfter: res.balanceAfter,
    });
    // Drop this user's cached bank breakdown so the header pill shows the
    // post-stake balance on their next nav. The live-bets surface moved into
    // /bets/live; revalidate both paths so the cutover redirect keeps stale
    // data off either URL.
    updateTag(bankCacheTag(user.id));
    revalidatePath("/[lang]/bets", "layout");
    revalidatePath("/[lang]/play", "layout");
    return { ok: true, balanceAfter: res.balanceAfter ?? 0 };
  }

  if (res.status === "skipped" && res.reason === "unaffordable") {
    console.warn("[custom-bet rejected]", {
      userId: user.id,
      betId: customBetId,
      needed: res.needed,
    });
    return { ok: false, error: "insufficient_bank", needed: res.needed };
  }
  return { ok: false, error: mapError(res) };
}

// Map the shared write-core outcome onto this action's historic error union.
// overwrite:true never yields "already_filled"; the unaffordable case is
// handled above so it can carry `needed`.
function mapError(res: Exclude<WriteOutcome, { status: "filled" }>): Err {
  if (res.status === "skipped") {
    if (res.reason === "not_allowed") return "not_paid";
    if (res.reason === "closed") return "bet_not_open";
    if (res.reason === "locked") return "bet_locked";
    return "db";
  }
  if (res.error === "bet_not_found") return "bet_not_found";
  if (res.error === "invalid_answer") return "invalid_answer";
  return "db";
}
