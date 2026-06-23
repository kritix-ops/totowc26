import { NextResponse, type NextRequest } from "next/server";
import { revalidateTag } from "next/cache";
import {
  syncFixtures,
  syncTouchedFixtures,
  syncTouchedLeaderboard,
} from "@/lib/sync";
import { CACHE_TAG_FIXTURES, CACHE_TAG_LEADERBOARD } from "@/db/queries";
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
    // The cron runs in a Route Handler, so it must use revalidateTag, NOT
    // updateTag (updateTag is Server-Action-only and throws here — see
    // src/lib/bets/save-match-pick-core.ts). Without this the grading the
    // sync just did sat behind the leaderboard's 60s and the fixtures
    // metadata's 5-60min revalidate windows; busting the tags here pushes
    // the new standings and stage label out immediately instead.
    //
    // { expire: 0 } is the form proven to invalidate these unstable_cache
    // tags in this codebase (matches the bank revalidation in
    // save-match-pick-core.ts). The newer profile="max" targets the
    // cacheLife model, not unstable_cache, so we do not use it here. The
    // doc calls this the right pattern for an external system (the cron)
    // hitting a Route Handler and needing the data to expire. Cost is one
    // cheap (~11ms) blocking recompute on the next leaderboard visit, fired
    // at most once per 5-minute tick and only when grading actually moved.
    if (syncTouchedFixtures(report))
      revalidateTag(CACHE_TAG_FIXTURES, { expire: 0 });
    if (syncTouchedLeaderboard(report))
      revalidateTag(CACHE_TAG_LEADERBOARD, { expire: 0 });
    return NextResponse.json({ ok: true, report });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

// Accept POST too so external cron services can use either verb.
export const POST = GET;
