import "server-only";
import { revalidatePath, revalidateTag } from "next/cache";
import { getUserAccess } from "@/lib/access";
import { bankCacheTag } from "@/lib/bank";
import {
  cancelAdvancePickSelf,
  writeAdvancePick,
  writeMatchPick,
  type WriteOutcome,
} from "@/lib/bets/write-core";

// Shared core for the match-score 1/X/2 save. Two transports call it
// with identical semantics — the legacy server action at
// src/app/[lang]/bets/[matchId]/actions.ts and the POST route handler
// at src/app/api/bets/save/route.ts. Keeping the auth gate up at the
// transport layer (so route handlers can return a real 401 and actions
// can return { ok: false, error: "unauth" } in their own shape) and
// the write + cache busts + error mapping down here means the two
// paths can never drift in what they actually do.
//
// Cache invalidation uses revalidateTag, NOT updateTag. Per
// node_modules/next/dist/docs/.../updateTag.md, updateTag is
// Server-Action-only and THROWS when invoked from a Route Handler
// context. We had to find this out the hard way (QA agent run
// 2026-06-05 caught it: every save through /api/bets/save returned
// HTTP 500 after the write had already succeeded). revalidateTag
// works in both contexts. We pass { expire: 0 } so the bank pill the
// user just refilled never shows a stale value - this matches the
// blocking-revalidate semantics the old updateTag call provided.

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

export async function performSaveMatchPick(input: {
  userId: string;
  matchId: string;
  home: number;
  away: number;
}): Promise<SaveBetResult> {
  const access = await getUserAccess(input.userId);
  const res = await writeMatchPick(
    { kind: "self", userId: input.userId, access },
    { matchId: input.matchId, home: input.home, away: input.away },
    { overwrite: true },
  );

  if (res.status === "filled") {
    console.info("[match-bet save]", {
      userId: input.userId,
      matchId: input.matchId,
      home: input.home,
      away: input.away,
    });
    revalidateTag(bankCacheTag(input.userId), { expire: 0 });
    revalidatePath("/[lang]", "page");
    revalidatePath("/[lang]/bets", "page");
    revalidatePath("/[lang]/bets/[matchId]", "page");
    return { ok: true };
  }
  return { ok: false, error: mapError(res) };
}

// Shared core for the "who advances?" (מי עולה?) pick. Same transport rationale
// as performSaveMatchPick — called from the /api/bets/advance route handler so
// the tap saves in parallel with score saves rather than queueing behind a
// 200-row revalidation. No bank cache bust (the pick carries no stake).
export async function performSaveAdvancePick(input: {
  userId: string;
  matchId: string;
  team: string;
}): Promise<SaveBetResult> {
  const access = await getUserAccess(input.userId);
  const res = await writeAdvancePick(
    { kind: "self", userId: input.userId, access },
    { matchId: input.matchId, team: input.team },
  );
  if (res.status === "filled") {
    console.info("[advance-bet save]", {
      userId: input.userId,
      matchId: input.matchId,
      team: input.team,
    });
    revalidatePath("/[lang]", "page");
    revalidatePath("/[lang]/bets", "page");
    return { ok: true };
  }
  return { ok: false, error: mapError(res) };
}

export async function performClearAdvancePick(input: {
  userId: string;
  matchId: string;
}): Promise<SaveBetResult> {
  const access = await getUserAccess(input.userId);
  const res = await cancelAdvancePickSelf(
    { kind: "self", userId: input.userId, access },
    { matchId: input.matchId },
  );
  if (res.status === "filled" || (res.status === "skipped" && res.reason === "already_filled")) {
    console.info("[advance-bet clear]", {
      userId: input.userId,
      matchId: input.matchId,
      removed: res.status === "filled",
    });
    revalidatePath("/[lang]", "page");
    revalidatePath("/[lang]/bets", "page");
    return { ok: true };
  }
  return { ok: false, error: mapError(res) };
}

function mapError(
  res: Exclude<WriteOutcome, { status: "filled" }>,
): Exclude<SaveBetResult, { ok: true }>["error"] {
  if (res.status === "skipped") {
    if (res.reason === "not_allowed") return "not_paid";
    if (res.reason === "locked" || res.reason === "closed") return "locked";
    return "db";
  }
  if (res.error === "not_found") return "not_found";
  if (res.error === "invalid") return "invalid";
  return "db";
}
