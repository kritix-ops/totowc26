import { NextResponse, type NextRequest } from "next/server";
import { syncNews } from "@/lib/news-sync";
import { fillMonkeyPicks } from "@/lib/bets/monkey";
import { isAuthorizedCron } from "@/lib/cron-auth";

// News archive sync. Pulls Walla / Ynet / BBC into `news_items` every
// 30 minutes (see vercel.json).
//
// Vercel cron fires at exactly `:00` and `:30` for `*/30 * * * *`. A
// thundering herd of requests hitting Walla / Ynet at precisely those
// moments is the most bot-like signal we could send. Jitter spreads
// the actual upstream fetch up to 20s after the cron tick — enough to
// look human-ish in upstream access logs while leaving ~40s of the
// 60s Hobby-plan function budget for the sync itself (typical run is
// 5-15s with 304s, longer when there are new Ynet articles to verify).
const MAX_JITTER_MS = 20_000;

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const jitterMs = Math.floor(Math.random() * MAX_JITTER_MS);
  if (jitterMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, jitterMs));
  }

  try {
    const report = await syncNews({ jitterMs });

    // Piggyback the monkey bot's fill on this 30-minute cron. The Hobby plan
    // can't add another scheduled trigger and a separate GitHub Actions
    // workflow file can't be pushed with the available token scopes, so the
    // monkey rides the news cadence instead. Best-effort and fully isolated:
    // a monkey failure must never fail the news sync. Self-provisions the bot
    // on first run. See _plans/2026-06-01-monkey-bot-and-random-fill.md.
    let monkey: Awaited<ReturnType<typeof fillMonkeyPicks>> | null = null;
    try {
      monkey = await fillMonkeyPicks();
    } catch (err) {
      console.error("[news cron] monkey fill failed", err);
    }

    // 200 even when one upstream is sick — the report carries per-source
    // ok flags so the cron retry loop doesn't pile up against an
    // unavailable feed. Only a thrown exception below counts as 500.
    return NextResponse.json({ ok: true, report, monkey });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[news sync] failed", { error: msg });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

// Accept POST too so external schedulers can use either verb.
export const POST = GET;
