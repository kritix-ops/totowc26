import { NextResponse, type NextRequest } from "next/server";
import { syncFixtures } from "@/lib/sync";

// Vercel sends `Authorization: Bearer ${CRON_SECRET}` on every cron firing.
// Header-only: we used to also accept `?secret=` for browser-triggered runs
// but that leaked the secret into access logs and the URL bar history.
function authorized(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${expected}`;
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
