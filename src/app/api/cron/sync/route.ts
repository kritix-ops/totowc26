import { NextResponse, type NextRequest } from "next/server";
import { syncFixtures } from "@/lib/sync";
import { isAuthorizedCron } from "@/lib/cron-auth";

// The full fixture sync (fetch → score → grade → lock → settle → remind)
// can run long when several matches go final at once and reminder emails
// fan out. The default function timeout would cut that off mid-run and
// leave the sync_runs row stuck on ok=false, so we match the other cron
// routes at 60s. Especially relevant now the sync fires every 5 minutes
// (see vercel.json) instead of once a day.
export const maxDuration = 60;

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
