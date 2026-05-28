import { NextResponse, type NextRequest } from "next/server";
import { runBackup } from "@/lib/backup";
import { isAuthorizedCron } from "@/lib/cron-auth";

// Daily backup runs against the live DB and hits the GitHub REST API
// several times, so keep us on the Node runtime (Edge can't do crypto +
// fs the way `runBackup` uses them).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const report = await runBackup({ source: "cron-backup" });
    return NextResponse.json({ ok: true, report });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

// Accept POST too so a manual `curl -X POST` from the admin's terminal
// works the same as the cron firing.
export const POST = GET;
