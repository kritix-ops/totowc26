import { NextResponse, type NextRequest } from "next/server";
import { syncFixtures } from "@/lib/sync";

// Vercel sends `Authorization: Bearer ${CRON_SECRET}` on every cron firing.
// Same endpoint also accepts a `secret` query param so admins can trigger it
// from a browser if needed.
function authorized(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const auth = request.headers.get("authorization");
  if (auth === `Bearer ${expected}`) return true;
  const q = request.nextUrl.searchParams.get("secret");
  return q === expected;
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const report = await syncFixtures(2026, { source: "cron" });
    return NextResponse.json({ ok: true, report });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

// Accept POST too so external cron services can use either verb.
export const POST = GET;
