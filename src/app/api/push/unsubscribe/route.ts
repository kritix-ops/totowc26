import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import { getUser } from "@/lib/supabase/auth";

// POST /api/push/unsubscribe
//
// Body: { endpoint: string } - the endpoint URL the client just
// unsubscribed locally (PushSubscription.unsubscribe()). We then
// remove the row so the server stops trying to send to it.
//
// See _plans/2026-05-28-lock-reminders.md §5.

type Body = { endpoint?: unknown };

export async function POST(request: NextRequest) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const endpoint = typeof body.endpoint === "string" ? body.endpoint : null;
  if (!endpoint) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  try {
    await db
      .delete(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.userId, user.id),
          eq(pushSubscriptions.endpoint, endpoint),
        ),
      );
    console.info("[push unsubscribe]", {
      userId: user.id,
      endpoint: endpoint.slice(0, 60),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[push unsubscribe failed]", { userId: user.id, err });
    return NextResponse.json({ error: "db" }, { status: 500 });
  }
}
