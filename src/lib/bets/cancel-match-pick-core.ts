import "server-only";
import { revalidatePath, revalidateTag } from "next/cache";
import { getUserAccess } from "@/lib/access";
import { bankCacheTag } from "@/lib/bank";
import { cancelMatchPickSelf } from "@/lib/bets/write-core";
import type { WriteOutcome } from "@/lib/bets/write-core";

// Shared core for the owner-explicit cancel of a 1/X/2 match pick. Two
// transports call this with identical semantics — the server action at
// src/app/[lang]/bets/[matchId]/actions.ts and the parallel-safe POST
// route at src/app/api/bets/cancel/route.ts. Same split rationale as
// performSaveMatchPick: server actions queue per-tab, so the dedicated
// transport keeps the cancel path uniform with the save path.
//
// The action-shaped error union below intentionally matches SaveBetResult
// so the BetForm's existing error-translation map covers cancel too —
// fewer copy strings to keep in sync between the two surfaces.

export type CancelBetResult =
  | { ok: true }
  | {
      ok: false;
      error: "unauth" | "not_paid" | "locked" | "not_found" | "db" | "nothing_to_cancel";
    };

export async function performCancelMatchPick(input: {
  userId: string;
  matchId: string;
}): Promise<CancelBetResult> {
  const access = await getUserAccess(input.userId);
  const res = await cancelMatchPickSelf(
    { kind: "self", userId: input.userId, access },
    { matchId: input.matchId },
  );

  if (res.status === "filled") {
    console.info("[match-bet cancel]", {
      userId: input.userId,
      matchId: input.matchId,
    });
    // Match the save path's revalidations so the bank pill + bets lists
    // refresh in the same render cycle as a placed-then-cancelled flip.
    revalidateTag(bankCacheTag(input.userId), { expire: 0 });
    revalidatePath("/[lang]", "page");
    revalidatePath("/[lang]/bets", "page");
    revalidatePath("/[lang]/bets/[matchId]", "page");
    return { ok: true };
  }
  return { ok: false, error: mapError(res) };
}

function mapError(
  res: Exclude<WriteOutcome, { status: "filled" }>,
): Exclude<CancelBetResult, { ok: true }>["error"] {
  if (res.status === "skipped") {
    if (res.reason === "not_allowed") return "not_paid";
    if (res.reason === "locked" || res.reason === "closed") return "locked";
    if (res.reason === "already_filled") return "nothing_to_cancel";
    return "db";
  }
  if (res.error === "not_found") return "not_found";
  return "db";
}
