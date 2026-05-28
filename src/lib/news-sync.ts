import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { newsItems, newsSyncCursors } from "@/db/schema";
import {
  FEEDS,
  FETCH_TIMEOUT_MS,
  MIN_TAG_URLS_TO_TRUST,
  MIN_YNET_MUNDIAL_MENTIONS,
  SUMMARY_MAX_CHARS,
  WALLA_ITEM_URL_PATTERN,
  WALLA_MUNDIAL_TAG_URL,
  YNET_DATE_RE,
  YNET_EXCLUDED_PATHS,
  YNET_IMG_RE,
  YNET_LINK_RE,
  YNET_MUNDIAL_BODY_RE,
  YNET_MUNDIAL_TAG_URL,
  YNET_SLOT_BOUNDARY,
  YNET_TITLE_RE,
  decodeEntities,
  parseRss,
  stripTags,
  type NewsItem,
  type NewsSource,
} from "./news";

// Cron-side news ingestion. Reads from Walla / Ynet / BBC, dedupes by
// `link`, writes new rows into `news_items`. Unlike the in-render
// fetcher in `news.ts` (which leans on Next's data cache for 15 min),
// this path bypasses the cache so every cron tick actually hits the
// upstream — with conditional GETs where supported so we still cost
// the upstream nothing on a no-change tick.
//
// Failure isolation: each source runs in its own try/catch. One source
// crashing must not block the others. The route returns 200 with a
// per-source counter object even on partial failure so Vercel cron
// doesn't retry-storm a broken upstream.

const USER_AGENT = "TotoMundial/1.0 (+https://kritix.io)";

// Polite scraper headers. Accept-Language helps Hebrew CDNs pick the
// IL variant; the UA names us explicitly so a site operator who looks
// at their access logs sees who we are and can email Reply-To
// (yoav@kritix.io) instead of just blocking by IP.
const BASE_HEADERS: Record<string, string> = {
  "User-Agent": USER_AGENT,
  "Accept-Language": "he-IL, he;q=0.9, en;q=0.5",
};

export type NewsSyncSourceReport = {
  source: NewsSource;
  ok: boolean;
  status: number | null;
  fetched: number;
  inserted: number;
  skipped: number;
  notModified: boolean;
  durationMs: number;
  error?: string;
};

export type NewsSyncReport = {
  jitterMs: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  perSource: Record<NewsSource, NewsSyncSourceReport>;
  totals: { fetched: number; inserted: number; skipped: number };
};

export async function syncNews(opts: { jitterMs?: number } = {}): Promise<NewsSyncReport> {
  const startedAt = new Date();
  const jitterMs = opts.jitterMs ?? 0;

  const cursors = await loadCursors();

  // Run all three sources in parallel. Each one is fully self-contained
  // so a thrown error from one cannot poison the others. The Promise
  // wrapper turns any thrown exception into a "ok:false" report.
  const [walla, ynet, bbc] = await Promise.all([
    runSource("walla", () => syncWalla(cursors.walla)),
    runSource("ynet", () => syncYnet(cursors.ynet)),
    runSource("bbc", () => syncBbc(cursors.bbc)),
  ]);

  const totals = {
    fetched: walla.fetched + ynet.fetched + bbc.fetched,
    inserted: walla.inserted + ynet.inserted + bbc.inserted,
    skipped: walla.skipped + ynet.skipped + bbc.skipped,
  };

  const finishedAt = new Date();
  const report: NewsSyncReport = {
    jitterMs,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    perSource: { walla, ynet, bbc },
    totals,
  };

  console.info("[news sync]", {
    jitterMs,
    totalFetched: totals.fetched,
    totalInserted: totals.inserted,
    totalSkipped: totals.skipped,
    durationMs: report.durationMs,
  });

  return report;
}

// ---------------------------------------------------------------------
// Per-source runners
// ---------------------------------------------------------------------

async function runSource(
  source: NewsSource,
  fn: () => Promise<Omit<NewsSyncSourceReport, "source" | "ok">>,
): Promise<NewsSyncSourceReport> {
  const t0 = Date.now();
  try {
    const partial = await fn();
    const report: NewsSyncSourceReport = {
      source,
      ok: true,
      ...partial,
    };
    console.info(`[news sync ${source}]`, {
      status: report.status,
      fetched: report.fetched,
      inserted: report.inserted,
      skipped: report.skipped,
      notModified: report.notModified,
      durationMs: report.durationMs,
    });
    return report;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const report: NewsSyncSourceReport = {
      source,
      ok: false,
      status: null,
      fetched: 0,
      inserted: 0,
      skipped: 0,
      notModified: false,
      durationMs: Date.now() - t0,
      error: message,
    };
    console.warn(`[news sync ${source}]`, {
      ok: false,
      error: message,
      durationMs: report.durationMs,
    });
    return report;
  }
}

async function syncWalla(
  cursor: NewsSyncCursorState,
): Promise<Omit<NewsSyncSourceReport, "source" | "ok">> {
  const t0 = Date.now();

  // 1) Conditional fetch the RSS itself.
  const rss = await conditionalFetch(FEEDS.walla, {
    accept: "application/rss+xml, application/xml, text/xml",
    cursor,
  });

  if (rss.notModified) {
    await saveCursor("walla", { ...cursor, lastStatus: 304 });
    return {
      status: 304,
      fetched: 0,
      inserted: 0,
      skipped: 0,
      notModified: true,
      durationMs: Date.now() - t0,
    };
  }
  if (!rss.ok || !rss.body) {
    return {
      status: rss.status,
      fetched: 0,
      inserted: 0,
      skipped: 0,
      notModified: false,
      durationMs: Date.now() - t0,
      error: `walla rss status ${rss.status}`,
    };
  }

  const rawItems = parseRss(rss.body, "walla");

  // 2) Tag-URL filter. The general feed/316 carries world football
  // beyond just the Mundial; the tag page is the authoritative "which
  // articles are Mundial 2026". If the tag scrape fails or returns too
  // few URLs to be trustworthy we keep all RSS items rather than drop
  // to zero — matches the existing in-render fallback behavior.
  const tagUrls = await fetchWallaTagUrlsForSync();
  const filtered =
    tagUrls.size >= MIN_TAG_URLS_TO_TRUST
      ? rawItems.filter((item) => tagUrls.has(item.link))
      : rawItems;

  const inserted = await insertItems(filtered, "walla", "he");

  await saveCursor("walla", {
    lastModified: rss.lastModified ?? cursor.lastModified ?? null,
    etag: rss.etag ?? cursor.etag ?? null,
    lastStatus: rss.status,
  });

  return {
    status: rss.status,
    fetched: filtered.length,
    inserted,
    skipped: filtered.length - inserted,
    notModified: false,
    durationMs: Date.now() - t0,
  };
}

async function syncYnet(
  cursor: NewsSyncCursorState,
): Promise<Omit<NewsSyncSourceReport, "source" | "ok">> {
  const t0 = Date.now();
  // Ynet is HTML scrape — no reliable cache validators. Still send the
  // headers we've stored just in case the CDN starts honouring them;
  // accept 304 as a true short-circuit, otherwise re-parse.
  const html = await conditionalFetch(YNET_MUNDIAL_TAG_URL, {
    accept: "text/html,application/xhtml+xml",
    cursor,
  });

  if (html.notModified) {
    await saveCursor("ynet", { ...cursor, lastStatus: 304 });
    return {
      status: 304,
      fetched: 0,
      inserted: 0,
      skipped: 0,
      notModified: true,
      durationMs: Date.now() - t0,
    };
  }
  if (!html.ok || !html.body) {
    return {
      status: html.status,
      fetched: 0,
      inserted: 0,
      skipped: 0,
      notModified: false,
      durationMs: Date.now() - t0,
      error: `ynet tag status ${html.status}`,
    };
  }

  const candidates = parseYnetTagPage(html.body);

  // Verify each candidate by fetching the article and counting
  // "מונדיאל" mentions. Pre-filter candidates against the existing
  // `news_items` table so a steady-state cron tick only fetches
  // articles we have not seen before — the verify step is the most
  // expensive part of the sync and re-doing it on every tick is what
  // would actually annoy Ynet.
  const knownLinks = await loadExistingLinks(candidates.map((c) => c.link));
  const fresh = candidates.filter((c) => !knownLinks.has(c.link));
  const verifications = await Promise.all(
    fresh.map((item) => verifyYnetArticle(item.link)),
  );
  const verified: NewsItem[] = [];
  for (let i = 0; i < fresh.length; i++) {
    if (verifications[i]) verified.push(fresh[i]);
  }

  const inserted = await insertItems(verified, "ynet", "he");

  await saveCursor("ynet", {
    lastModified: html.lastModified ?? cursor.lastModified ?? null,
    etag: html.etag ?? cursor.etag ?? null,
    lastStatus: html.status,
  });

  return {
    status: html.status,
    fetched: verified.length,
    inserted,
    skipped: verified.length - inserted,
    notModified: false,
    durationMs: Date.now() - t0,
  };
}

async function syncBbc(
  cursor: NewsSyncCursorState,
): Promise<Omit<NewsSyncSourceReport, "source" | "ok">> {
  const t0 = Date.now();
  const rss = await conditionalFetch(FEEDS.bbc, {
    accept: "application/rss+xml, application/xml, text/xml",
    cursor,
  });

  if (rss.notModified) {
    await saveCursor("bbc", { ...cursor, lastStatus: 304 });
    return {
      status: 304,
      fetched: 0,
      inserted: 0,
      skipped: 0,
      notModified: true,
      durationMs: Date.now() - t0,
    };
  }
  if (!rss.ok || !rss.body) {
    return {
      status: rss.status,
      fetched: 0,
      inserted: 0,
      skipped: 0,
      notModified: false,
      durationMs: Date.now() - t0,
      error: `bbc rss status ${rss.status}`,
    };
  }

  const items = parseRss(rss.body, "bbc");
  const inserted = await insertItems(items, "bbc", "en");

  await saveCursor("bbc", {
    lastModified: rss.lastModified ?? cursor.lastModified ?? null,
    etag: rss.etag ?? cursor.etag ?? null,
    lastStatus: rss.status,
  });

  return {
    status: rss.status,
    fetched: items.length,
    inserted,
    skipped: items.length - inserted,
    notModified: false,
    durationMs: Date.now() - t0,
  };
}

// ---------------------------------------------------------------------
// HTTP — conditional GET wrapper
// ---------------------------------------------------------------------

type ConditionalFetchResult = {
  ok: boolean;
  status: number;
  body: string | null;
  notModified: boolean;
  lastModified: string | null;
  etag: string | null;
};

async function conditionalFetch(
  url: string,
  opts: { accept: string; cursor: NewsSyncCursorState },
): Promise<ConditionalFetchResult> {
  const headers: Record<string, string> = {
    ...BASE_HEADERS,
    Accept: opts.accept,
  };
  if (opts.cursor.lastModified) {
    headers["If-Modified-Since"] = opts.cursor.lastModified;
  }
  if (opts.cursor.etag) {
    headers["If-None-Match"] = opts.cursor.etag;
  }

  const res = await fetch(url, {
    cache: "no-store",
    headers,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  const lastModified = res.headers.get("last-modified");
  const etag = res.headers.get("etag");

  if (res.status === 304) {
    return {
      ok: true,
      status: 304,
      body: null,
      notModified: true,
      lastModified,
      etag,
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      body: null,
      notModified: false,
      lastModified,
      etag,
    };
  }

  const body = await res.text();
  return {
    ok: true,
    status: res.status,
    body,
    notModified: false,
    lastModified,
    etag,
  };
}

// ---------------------------------------------------------------------
// Walla tag-URL helper
// ---------------------------------------------------------------------

async function fetchWallaTagUrlsForSync(): Promise<Set<string>> {
  try {
    const res = await fetch(WALLA_MUNDIAL_TAG_URL, {
      cache: "no-store",
      headers: { ...BASE_HEADERS, Accept: "text/html" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn("[news sync walla-tag]", {
        url: WALLA_MUNDIAL_TAG_URL,
        status: res.status,
      });
      return new Set();
    }
    const html = await res.text();
    const urls = new Set(html.match(WALLA_ITEM_URL_PATTERN) ?? []);
    return urls;
  } catch (err) {
    console.warn("[news sync walla-tag]", {
      url: WALLA_MUNDIAL_TAG_URL,
      error: err instanceof Error ? err.message : String(err),
    });
    return new Set();
  }
}

// ---------------------------------------------------------------------
// Ynet tag-page parser + per-article verifier
// ---------------------------------------------------------------------

function parseYnetTagPage(html: string): NewsItem[] {
  const items: NewsItem[] = [];
  const seen = new Set<string>();
  // Local copy of the global-flag regex so its lastIndex state stays
  // scoped to this call. The shared YNET_SLOT_BOUNDARY constant carries
  // .lastIndex across calls and would skip slots in long-running
  // processes.
  const boundary = new RegExp(YNET_SLOT_BOUNDARY.source, "g");
  let block: RegExpExecArray | null;
  while ((block = boundary.exec(html)) !== null) {
    const body = block[1];
    const linkMatch = body.match(YNET_LINK_RE);
    if (!linkMatch) continue;
    const link = linkMatch[1];
    if (seen.has(link)) continue;
    if (YNET_EXCLUDED_PATHS.some((p) => link.includes(p))) {
      seen.add(link);
      continue;
    }
    const titleMatch = body.match(YNET_TITLE_RE);
    if (!titleMatch) continue;
    const title = decodeEntities(stripTags(titleMatch[1]));
    if (!title) continue;
    const dateMatch = body.match(YNET_DATE_RE);
    const imgMatch = body.match(YNET_IMG_RE);
    seen.add(link);
    items.push({
      id: link,
      title: clampSummary(title, 200),
      summary: "",
      link,
      publishedAt: dateMatch ? dateMatch[1] : new Date().toISOString(),
      imageUrl: imgMatch ? imgMatch[1] : null,
      source: "ynet",
    });
  }
  return items;
}

async function verifyYnetArticle(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      cache: "no-store",
      headers: { ...BASE_HEADERS, Accept: "text/html" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return false;
    const html = await res.text();
    const matches = html.match(YNET_MUNDIAL_BODY_RE);
    return (matches?.length ?? 0) >= MIN_YNET_MUNDIAL_MENTIONS;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------
// DB writes
// ---------------------------------------------------------------------

type NewsSyncCursorState = {
  lastModified: string | null;
  etag: string | null;
};

const EMPTY_CURSOR: NewsSyncCursorState = { lastModified: null, etag: null };

async function loadCursors(): Promise<Record<NewsSource, NewsSyncCursorState>> {
  const rows = await db.select().from(newsSyncCursors);
  const result: Record<NewsSource, NewsSyncCursorState> = {
    walla: { ...EMPTY_CURSOR },
    ynet: { ...EMPTY_CURSOR },
    bbc: { ...EMPTY_CURSOR },
  };
  for (const row of rows) {
    if (row.source === "walla" || row.source === "ynet" || row.source === "bbc") {
      result[row.source] = {
        lastModified: row.lastModified,
        etag: row.etag,
      };
    }
  }
  return result;
}

async function saveCursor(
  source: NewsSource,
  cursor: { lastModified: string | null; etag: string | null; lastStatus: number },
): Promise<void> {
  await db.execute(sql`
    INSERT INTO news_sync_cursors
      (source, last_modified, etag, last_fetched_at, last_status, updated_at)
    VALUES
      (${source}, ${cursor.lastModified}, ${cursor.etag}, now(), ${cursor.lastStatus}, now())
    ON CONFLICT (source) DO UPDATE SET
      last_modified   = EXCLUDED.last_modified,
      etag            = EXCLUDED.etag,
      last_fetched_at = EXCLUDED.last_fetched_at,
      last_status     = EXCLUDED.last_status,
      updated_at      = now()
  `);
}

async function loadExistingLinks(links: string[]): Promise<Set<string>> {
  if (links.length === 0) return new Set();
  const rows = await db
    .select({ link: newsItems.link })
    .from(newsItems)
    .where(sql`${newsItems.link} = ANY(${links})`);
  return new Set(rows.map((r) => r.link));
}

async function insertItems(
  items: NewsItem[],
  source: NewsSource,
  lang: "he" | "en",
): Promise<number> {
  if (items.length === 0) return 0;

  const rows = items
    .map((item) => toRow(item, source, lang))
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (rows.length === 0) return 0;

  // ON CONFLICT DO NOTHING on the link unique index. RETURNING id lets
  // us count actual inserts vs duplicates without a second query.
  const inserted = await db
    .insert(newsItems)
    .values(rows)
    .onConflictDoNothing({ target: newsItems.link })
    .returning({ id: newsItems.id });

  return inserted.length;
}

function toRow(
  item: NewsItem,
  source: NewsSource,
  lang: "he" | "en",
): {
  source: string;
  lang: string;
  link: string;
  title: string;
  summary: string;
  imageUrl: string | null;
  publishedAt: Date;
} | null {
  const published = parseDate(item.publishedAt);
  if (!published) return null; // refuse undated items; cron won't surface them
  return {
    source,
    lang,
    link: item.link,
    title: item.title,
    summary: item.summary
      ? clampSummary(item.summary, SUMMARY_MAX_CHARS)
      : "",
    imageUrl: item.imageUrl ?? null,
    publishedAt: published,
  };
}

function parseDate(value: string): Date | null {
  if (!value) return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  return new Date(ms);
}

function clampSummary(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max - 1).trimEnd() + "…";
}
