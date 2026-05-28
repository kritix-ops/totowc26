import { NextResponse, type NextRequest } from "next/server";
import { loadNewsArchivePage } from "@/lib/news-read";

// Read endpoint for the news archive. Keyset pagination via
// `?before=<iso>`; the client passes back the `nextCursor` it got from
// the previous page. See _plans/2026-05-29-news-archive-and-lazy-load.md.
//
// No auth — news headlines are public on every upstream source anyway,
// and this is the entry path the tournament tab hits on every scroll.
//
// Cache: short s-maxage so a fresh cron tick surfaces within ~1 minute,
// stale-while-revalidate so the first user after that window doesn't
// pay the DB round-trip latency. Keyed by full URL (lang + before
// vary the response) by virtue of being a GET with no cookies.
export async function GET(request: NextRequest) {
  const t0 = Date.now();
  const params = request.nextUrl.searchParams;

  const rawLang = params.get("lang");
  const lang: "he" | "en" = rawLang === "en" ? "en" : "he";

  const before = params.get("before");
  const limitRaw = params.get("limit");
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;

  try {
    const page = await loadNewsArchivePage({ lang, before, limit });
    const durationMs = Date.now() - t0;
    console.info("[news api]", {
      lang,
      before: before ?? null,
      limit: limit ?? null,
      count: page.items.length,
      oldest:
        page.items.length > 0
          ? page.items[page.items.length - 1].publishedAt
          : null,
      hasMore: page.nextCursor !== null,
      durationMs,
    });
    return NextResponse.json(page, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[news api] failed", {
      lang,
      before: before ?? null,
      error: msg,
    });
    return NextResponse.json(
      { error: "failed_to_load_news" },
      { status: 500 },
    );
  }
}
