import { NextResponse, type NextRequest } from "next/server";
import { syncFixtures } from "@/lib/sync";
import { isAuthorizedCron } from "@/lib/cron-auth";

export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
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
