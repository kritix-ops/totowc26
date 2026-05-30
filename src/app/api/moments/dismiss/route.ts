import { NextResponse, type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getUser } from "@/lib/supabase/auth";
import { isValidMomentKey, nextIlMorning } from "@/lib/moments/dismiss";

// POST /api/moments/dismiss
//   body: { momentKey: string }
//
// Records "user X dismissed moment Y until tomorrow 04:00 IL." The
// Smart Hub ranker reads this through getActiveDismissals().
//
// Authorization: we ignore any user_id the client could try to slip
// in; the row is always written for the session-bound user. The
// moment_key shape is validated against the same regex the DB CHECK
// constraint enforces - rejecting bad keys at the HTTP layer turns
// what would be a 500 into a 400.
//
// See _plans/2026-05-30-smart-reminders.md §3.3.

export async function POST(request: NextRequest) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let payload: { momentKey?: unknown } = {};
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }
  const momentKey = typeof payload.momentKey === "string" ? payload.momentKey : "";
  if (!isValidMomentKey(momentKey)) {
    return NextResponse.json({ ok: false, error: "invalid_key" }, { status: 400 });
  }

  const dismissedUntil = nextIlMorning(new Date());
  try {
    await db.execute(sql`
      insert into public.user_moment_dismissals
        (user_id, moment_key, dismissed_until)
      values
        (${user.id}::uuid, ${momentKey}, ${dismissedUntil.toISOString()}::timestamptz)
      on conflict (user_id, moment_key)
      do update set
        dismissed_until = excluded.dismissed_until,
        created_at = now()
    `);
    console.info("[moments dismiss]", {
      userId: user.id,
      momentKey,
      dismissedUntil: dismissedUntil.toISOString(),
    });
    return NextResponse.json({ ok: true, dismissedUntil: dismissedUntil.toISOString() });
  } catch (err) {
    console.error("[moments dismiss failed]", {
      userId: user.id,
      momentKey,
      err,
    });
    return NextResponse.json({ ok: false, error: "db" }, { status: 500 });
  }
}
