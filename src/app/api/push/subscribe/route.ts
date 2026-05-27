import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import { getUser } from "@/lib/supabase/auth";

// POST /api/push/subscribe
//
// Body: PushSubscription.toJSON() shape:
//   { endpoint, keys: { p256dh, auth } }
//
// Upserts a row in push_subscriptions keyed by endpoint (the same
// browser/device produces a stable endpoint URL). Also re-stamps
// last_seen_at so a stale-subscription pruner can later evict ones
// that haven't refreshed in N months.
//
// Returns 401 for unauth, 400 for malformed body, 200 on success.
// See _plans/2026-05-28-lock-reminders.md §5.

type Body = {
  endpoint?: unknown;
  keys?: {
    p256dh?: unknown;
    auth?: unknown;
  };
};

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
  const p256dh =
    typeof body.keys?.p256dh === "string" ? body.keys.p256dh : null;
  const auth = typeof body.keys?.auth === "string" ? body.keys.auth : null;
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const userAgent = request.headers.get("user-agent")?.slice(0, 500) ?? null;

  try {
    await db
      .insert(pushSubscriptions)
      .values({
        userId: user.id,
        endpoint,
        p256dh,
        auth,
        userAgent,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: {
          // If the same endpoint is reused under a different account
          // (rare; happens when two users share a browser), rebind it
          // to the current user and refresh keys + last_seen_at.
          userId: user.id,
          p256dh,
          auth,
          userAgent,
          lastSeenAt: new Date(),
        },
      });
    console.info("[push subscribe]", {
      userId: user.id,
      endpoint: endpoint.slice(0, 60),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[push subscribe failed]", { userId: user.id, err });
    return NextResponse.json({ error: "db" }, { status: 500 });
  }
}
