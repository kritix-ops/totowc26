import { NextResponse } from "next/server";

// Returns the VAPID public key so the client can pass it to
// pushManager.subscribe({ applicationServerKey }). Public on purpose -
// the public key is meant to be exposed to every browser that
// subscribes. The private half stays on the server.
//
// See _plans/2026-05-28-lock-reminders.md §5.

export async function GET() {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) {
    // Returning null (not 500) keeps the client subscribe UI graceful:
    // it can show "push notifications not configured" instead of a
    // crash. Admin runs `pnpm push:vapid` to fix.
    return NextResponse.json({ publicKey: null });
  }
  return NextResponse.json({ publicKey: key });
}
