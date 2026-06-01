"use server";

import { revalidatePath, updateTag } from "next/cache";
import { getUser } from "@/lib/supabase/auth";
import { getUserAccess } from "@/lib/access";
import { bankCacheTag } from "@/lib/bank";
import { writeMatchPick, type WriteOutcome } from "@/lib/bets/write-core";

// 1/X/2 match-bet submission. The main pick still does not debit the
// bank at submit time - points (positive or negative) are credited by
// scoreFinalMatches() once the match is final. The risk-penalty snapshot,
// deadline cascade, clamping and upsert all live in the shared write-core
// (src/lib/bets/write-core.ts) so this action, the "Surprise me" bulk fill
// and the monkey bot all go through one gated path. Custom side bets live in
// the user_custom_bet_picks system instead.

export type SaveBetResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | "unauth"
        | "not_paid"
        | "locked"
        | "invalid"
        | "db"
        | "not_found";
    };

export async function saveBet(
  matchId: string,
  home: number,
  away: number,
): Promise<SaveBetResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauth" };
  const access = await getUserAccess(user.id);

  const res = await writeMatchPick(
    { kind: "self", userId: user.id, access },
    { matchId, home, away },
    { overwrite: true },
  );

  if (res.status === "filled") {
    console.info("[match-bet save]", { userId: user.id, matchId, home, away });
    // Bust this user's cached bank entry so the next paint reflects the new
    // risk-penalty snapshot, then revalidate only the surfaces that show this
    // user's pick (a layout-wide bust made the save button feel "stuck").
    updateTag(bankCacheTag(user.id));
    revalidatePath("/[lang]", "page");
    revalidatePath("/[lang]/bets", "page");
    revalidatePath("/[lang]/bets/[matchId]", "page");
    return { ok: true };
  }
  return { ok: false, error: mapError(res) };
}

// Map the shared write-core outcome onto this action's historic error union.
// overwrite:true never yields "already_filled", so the residual cases fold to
// "db" defensively.
function mapError(res: Exclude<WriteOutcome, { status: "filled" }>): Exclude<
  SaveBetResult,
  { ok: true }
>["error"] {
  if (res.status === "skipped") {
    if (res.reason === "not_allowed") return "not_paid";
    if (res.reason === "locked" || res.reason === "closed") return "locked";
    return "db";
  }
  if (res.error === "not_found") return "not_found";
  if (res.error === "invalid") return "invalid";
  return "db";
}
