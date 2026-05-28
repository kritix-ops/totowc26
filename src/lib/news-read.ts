import "server-only";

import { and, desc, eq, gte, lt } from "drizzle-orm";
import { db } from "@/db";
import { newsItems } from "@/db/schema";
import type { NewsSource } from "./news";

// 2026-06-11 00:00 Asia/Jerusalem (IDT, UTC+3) = 2026-06-10 21:00 UTC.
// Tournament kickoff. The read API hides anything older even when the
// cron has been ingesting before this instant — the user-facing archive
// is "from kickoff forward". Hard floor lives at the read layer rather
// than the write layer so pre-tournament rows in the table stay
// available for admin debugging without leaking into the public tab.
export const NEWS_ARCHIVE_START_UTC = new Date("2026-06-10T21:00:00Z");

// Read-side helper for the news archive. Keyset pagination on
// published_at — page N+1 returns rows strictly older than the oldest
// row on page N. This stays correct even when the cron inserts new
// rows mid-scroll, because we paginate on a stable monotone key
// (published_at) rather than offset.

export type NewsArchiveItem = {
  id: string;
  source: NewsSource;
  lang: "he" | "en";
  title: string;
  summary: string;
  link: string;
  imageUrl: string | null;
  publishedAt: string;
};

export type NewsArchivePage = {
  items: NewsArchiveItem[];
  // ISO timestamp of the oldest item on this page, to use as `before`
  // on the next request. `null` when the page is empty — caller can
  // stop scrolling.
  nextCursor: string | null;
};

const MIN_LIMIT = 1;
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

export async function loadNewsArchivePage(opts: {
  lang: "he" | "en";
  before?: string | null;
  limit?: number;
}): Promise<NewsArchivePage> {
  const limit = clampLimit(opts.limit ?? DEFAULT_LIMIT);
  const before = parseBefore(opts.before);

  const whereClause = before
    ? and(
        eq(newsItems.lang, opts.lang),
        gte(newsItems.publishedAt, NEWS_ARCHIVE_START_UTC),
        lt(newsItems.publishedAt, before),
      )
    : and(
        eq(newsItems.lang, opts.lang),
        gte(newsItems.publishedAt, NEWS_ARCHIVE_START_UTC),
      );

  const rows = await db
    .select({
      id: newsItems.id,
      source: newsItems.source,
      lang: newsItems.lang,
      title: newsItems.title,
      summary: newsItems.summary,
      link: newsItems.link,
      imageUrl: newsItems.imageUrl,
      publishedAt: newsItems.publishedAt,
    })
    .from(newsItems)
    .where(whereClause)
    .orderBy(desc(newsItems.publishedAt))
    .limit(limit);

  const items: NewsArchiveItem[] = rows.map((row) => ({
    id: row.id,
    source: row.source as NewsSource,
    lang: row.lang as "he" | "en",
    title: row.title,
    summary: row.summary,
    link: row.link,
    imageUrl: row.imageUrl,
    publishedAt: row.publishedAt.toISOString(),
  }));

  const nextCursor =
    items.length === limit ? items[items.length - 1].publishedAt : null;

  return { items, nextCursor };
}

function clampLimit(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_LIMIT;
  if (value < MIN_LIMIT) return MIN_LIMIT;
  if (value > MAX_LIMIT) return MAX_LIMIT;
  return Math.floor(value);
}

function parseBefore(value: string | null | undefined): Date | null {
  if (!value) return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  return new Date(ms);
}
