import { NextResponse, type NextRequest } from "next/server";
import { syncNews } from "@/lib/news-sync";

// News archive sync. Pulls Walla / Ynet / BBC into `news_items` every
// 30 minutes (see vercel.json). Same auth shape as /api/cron/sync:
// Vercel sends `Authorization: Bearer ${CRON_SECRET}` on every cron
// firing. Header-only — no `?secret=` fallback so the secret never lands
// in URL logs.
function authorized(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${expected}`;
}

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
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const jitterMs = Math.floor(Math.random() * MAX_JITTER_MS);
  if (jitterMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, jitterMs));
  }

  try {
    const report = await syncNews({ jitterMs });
    // 200 even when one upstream is sick — the report carries per-source
    // ok flags so the cron retry loop doesn't pile up against an
    // unavailable feed. Only a thrown exception below counts as 500.
    return NextResponse.json({ ok: true, report });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[news sync] failed", { error: msg });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

// Accept POST too so external schedulers can use either verb.
export const POST = GET;
