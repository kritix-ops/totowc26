"use server";

import { getUser } from "@/lib/supabase/auth";
import {
  performSaveMatchPick,
  type SaveBetResult,
} from "@/lib/bets/save-match-pick-core";

// 1/X/2 match-bet submission as a server action.
//
// The real work lives in `performSaveMatchPick` (src/lib/bets/save-match-pick-core.ts).
// The same core is reached by the parallel-safe POST route at
// src/app/api/bets/save/route.ts, which is what every inline-save
// surface should use — server actions are dispatched one at a time
// per Next's own docs, so rapid-fire saves on /bets queued behind
// each other and lost picks when the user navigated away. This
// action survives only as a backward-compatible export for any
// caller still wired to the server-action contract.

export type { SaveBetResult } from "@/lib/bets/save-match-pick-core";

export async function saveBet(
  matchId: string,
  home: number,
  away: number,
): Promise<SaveBetResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauth" };
  return performSaveMatchPick({ userId: user.id, matchId, home, away });
}
