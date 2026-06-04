import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/supabase/auth";
import {
  performSaveMatchPick,
  type SaveBetResult,
} from "@/lib/bets/save-match-pick-core";

// POST /api/bets/save
//   body: { matchId: string, home: number, away: number }
//
// Why this exists as a route handler rather than a server action:
//
// Next's own docs (07-mutating-data.md, line 206) state plainly:
// "The client currently dispatches and awaits [Server Functions] one
// at a time. ... If you need parallel data fetching, use ...
// Route Handler."
//
// On /bets a user fills many rows quickly. With the saveBet server
// action, click N's request had to wait for click N-1's response —
// including click N-1's revalidatePath of the 200-row /bets page. If
// the user got bored and navigated away, every queued click was
// silently dropped and those bets were never persisted (this is the
// 2026-06-04 incident report — three rows stuck on "שומר…" and the
// picks never landed in the DB). The 2026-05-29 usePendingAction fix
// only decoupled the BUTTON state from revalidation; it could not fix
// the transport-level queueing.
//
// Route handlers are dispatched via fetch and run in parallel, so each
// row's save is independent. The response shape is identical to the
// legacy `saveBet` server action's SaveBetResult so client error
// mapping is unchanged.

export async function POST(
  request: NextRequest,
): Promise<NextResponse<SaveBetResult>> {
  const user = await getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "unauth" },
      { status: 401 },
    );
  }

  let payload: { matchId?: unknown; home?: unknown; away?: unknown } = {};
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid" },
      { status: 400 },
    );
  }
  if (
    typeof payload.matchId !== "string" ||
    typeof payload.home !== "number" ||
    typeof payload.away !== "number"
  ) {
    return NextResponse.json(
      { ok: false, error: "invalid" },
      { status: 400 },
    );
  }

  try {
    const result = await performSaveMatchPick({
      userId: user.id,
      matchId: payload.matchId,
      home: payload.home,
      away: payload.away,
    });
    return NextResponse.json(result);
  } catch (err) {
    // Defensive net for anything performSaveMatchPick throws that the
    // inner writeMatchPick try/catch did not cover. Without this the
    // client gets an HTML 500 page that JSON.parse cannot decode, and
    // the user sees "שגיאת שמירה" with no diagnostic trail (the 2026-
    // 06-05 updateTag-in-route-handler incident). Logging here means
    // Vercel function logs hold the stack while the client still gets
    // a clean JSON error to display.
    console.error("[api/bets/save] uncaught:", err);
    return NextResponse.json(
      { ok: false, error: "db" },
      { status: 500 },
    );
  }
}
