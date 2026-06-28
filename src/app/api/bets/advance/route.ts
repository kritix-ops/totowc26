import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/supabase/auth";
import {
  performClearAdvancePick,
  performSaveAdvancePick,
  type SaveBetResult,
} from "@/lib/bets/save-match-pick-core";

// POST /api/bets/advance
//   body: { matchId: string, team: string | null }
//
// The "who advances?" (מי עולה?) knockout pick. A route handler rather than a
// server action for the same reason as /api/bets/save: taps on the quick-picks
// page must save in parallel instead of queueing behind a 200-row revalidation
// (the 2026-06-04 lost-pick incident). team = null clears the pick.

export async function POST(
  request: NextRequest,
): Promise<NextResponse<SaveBetResult>> {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauth" }, { status: 401 });
  }

  let payload: { matchId?: unknown; team?: unknown } = {};
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }
  if (
    typeof payload.matchId !== "string" ||
    (payload.team !== null && typeof payload.team !== "string")
  ) {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }

  try {
    const result =
      payload.team === null || payload.team === ""
        ? await performClearAdvancePick({
            userId: user.id,
            matchId: payload.matchId,
          })
        : await performSaveAdvancePick({
            userId: user.id,
            matchId: payload.matchId,
            team: payload.team,
          });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/bets/advance] uncaught:", err);
    return NextResponse.json({ ok: false, error: "db" }, { status: 500 });
  }
}
