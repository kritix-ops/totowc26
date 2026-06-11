import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/supabase/auth";
import {
  performCancelMatchPick,
  type CancelBetResult,
} from "@/lib/bets/cancel-match-pick-core";

// POST /api/bets/cancel
//   body: { matchId: string }
//
// Parallel-safe owner-explicit cancel of a 1/X/2 match pick. Same
// rationale as /api/bets/save: server actions queue per browser tab,
// so a route handler is the right transport when several rows of bets
// could be cancelled in a tight loop. The single-card BetForm uses the
// `cancelBet` server action; this endpoint exists for the same
// reason the save one does — uniform inline cancel surfaces.

export async function POST(
  request: NextRequest,
): Promise<NextResponse<CancelBetResult>> {
  const user = await getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "unauth" },
      { status: 401 },
    );
  }

  let payload: { matchId?: unknown } = {};
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "db" },
      { status: 400 },
    );
  }
  if (typeof payload.matchId !== "string") {
    return NextResponse.json(
      { ok: false, error: "db" },
      { status: 400 },
    );
  }

  try {
    const result = await performCancelMatchPick({
      userId: user.id,
      matchId: payload.matchId,
    });
    return NextResponse.json(result);
  } catch (err) {
    // Defensive net mirrors /api/bets/save — anything
    // performCancelMatchPick throws that the inner write try/catch
    // missed becomes a clean JSON 500 the client can decode instead
    // of an HTML error page.
    console.error("[api/bets/cancel] uncaught:", err);
    return NextResponse.json(
      { ok: false, error: "db" },
      { status: 500 },
    );
  }
}
