import { NextResponse, type NextRequest } from "next/server";
import { fillMonkeyPicks } from "@/lib/bets/monkey";
import { isAuthorizedCron } from "@/lib/cron-auth";

// Monkey bot fill. Fills an odds-weighted random pick on every open bet the
// monkey hasn't picked yet, so human players have a baseline to beat.
//
// Triggered by GitHub Actions (.github/workflows/monkey-cron.yml), NOT a
// vercel.json cron: Hobby plan rejects sub-daily schedules and three daily
// crons already exist. Same header-only CRON_SECRET auth as every other
// /api/cron/* route. Idempotent — safe to fire hourly and to overlap.

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const report = await fillMonkeyPicks();
    if (!report.ok) {
      // No monkey profile yet (bootstrap script not run). 200 with a flag so
      // the cron doesn't retry-loop; the Actions log shows ok:false.
      console.warn("[monkey cron] no monkey profile", report);
      return NextResponse.json({ ok: false, report });
    }
    console.info("[monkey cron]", report);
    return NextResponse.json({ ok: true, report });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[monkey cron] failed", { error: msg });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

// Accept POST too so external schedulers can use either verb.
export const POST = GET;
