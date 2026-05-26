import "server-only";

import type { Locale } from "@/app/[lang]/dictionaries";

// Hand-rolled RSS 2.0 reader for the tournament News tab. Three feeds,
// three slightly different item shapes — keeping the parser local means
// no extra dependency and a tiny attack surface (rule 13). Server-only:
// runs inside the Next runtime, never on the client.

export type NewsSource = "walla" | "ynet" | "bbc";

export type NewsItem = {
  id: string;
  title: string;
  summary: string;
  link: string;
  publishedAt: string;
  imageUrl: string | null;
  source: NewsSource;
};

export type NewsFeed = {
  items: NewsItem[];
  source: NewsSource;
};

const REVALIDATE_SECONDS = 900;
const FETCH_TIMEOUT_MS = 8000;
const MAX_ITEMS = 20;
const SUMMARY_MAX_CHARS = 220;

const FEEDS = {
  walla: "https://rss.walla.co.il/feed/316",
  ynet: "https://www.ynet.co.il/Integration/StoryRss3.xml",
  bbc: "https://feeds.bbci.co.uk/sport/football/world-cup/rss.xml",
} as const;

// Walla's tag page for "מונדיאל 2026". Walla doesn't expose a
// tag-specific RSS, so we scrape this page server-side to get the set of
// article URLs tagged for the World Cup, then intersect with the world-
// football RSS to keep only true World-Cup items.
const WALLA_MUNDIAL_TAG_URL =
  "https://tags.walla.co.il/%D7%9E%D7%95%D7%A0%D7%93%D7%99%D7%90%D7%9C_2026";
const WALLA_ITEM_URL_PATTERN = /https?:\/\/sports\.walla\.co\.il\/item\/\d+/g;
const MIN_TAG_URLS_TO_TRUST = 5;

// Ynet's tag page for "מונדיאל 2026". Ynet's general sports RSS feed
// hardly carries any World-Cup items in May 2026, so intersecting it
// would yield ~zero. Instead we scrape the tag page directly. The page
// is built from repeated <div class="slotView"> blocks; we split on
// those boundaries and extract title/link/date/image per block, so
// adding or removing a variant in the future never bleeds one card's
// fields into another. We deliberately keep only blocks whose title
// sits inside a slotTitle <span> — that excludes the page's "תוכן
// גולשים" sidebar widgets, which use a plain anchor with no span and
// are not Mundial articles.
const YNET_MUNDIAL_TAG_URL =
  "https://www.ynet.co.il/topics/%D7%9E%D7%95%D7%A0%D7%93%D7%99%D7%90%D7%9C_2026";
const YNET_SLOT_BOUNDARY =
  /<div class="slotView"[^>]*>([\s\S]*?)(?=<div class="slotView"|<\/section>|<footer)/g;
const YNET_LINK_RE =
  /href="(https:\/\/www\.ynet\.co\.il\/sport(?:\/[a-z]+)?\/article\/[A-Za-z0-9_-]+)"/;
const YNET_TITLE_RE =
  /<(?:h[12]|div)\s+[^>]*class="slotTitle[^"]*"[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/;
const YNET_DATE_RE = /dateTime="([^"]+)"/;
const YNET_IMG_RE = /<img\s+[^>]*src="([^"]+)"/;
// Ynet articles carry their primary category in the URL path
// (/sport/<category>/article/<id>). The Mundial-2026 tag aggregates
// articles broadly — including Israeli-league cup wins and other
// non-Mundial sports stories that mention the tournament in passing.
// We drop any article whose primary category is clearly off-topic so
// the news tab stays close to "actual World Cup coverage". Canonical
// /sport/article/ (no category) and /sport/worldsoccer/ stay.
const YNET_EXCLUDED_PATHS = [
  "/sport/israelisoccer/",
  "/sport/israelibasketball/",
  "/sport/basketball/",
  "/sport/nba/",
  "/sport/handball/",
  "/sport/tennis/",
  "/sport/motor/",
  "/sport/extremesport/",
  "/sport/morsports/",
];

export async function getNewsForLocale(locale: Locale): Promise<NewsFeed> {
  if (locale === "en") {
    const items = await fetchAndParse("bbc");
    console.info("[news render]", {
      locale,
      source: "bbc",
      itemCount: items.length,
    });
    return { items, source: "bbc" };
  }

  // Hebrew: mix Walla (RSS filtered to the Mundial-2026 tag) with Ynet
  // (scraped directly from the Mundial-2026 tag page) and sort by date.
  // The general Ynet sports RSS barely carries Mundial items today, so
  // RSS intersection would be near-empty for Ynet; the tag scrape is
  // the only path that yields useful Ynet content. If both primary
  // sources come back empty we still fall back to the unfiltered Ynet
  // sports RSS so the tab is never blank for a transient upstream issue.
  const [wallaRaw, wallaTagUrls, ynetItems] = await Promise.all([
    fetchAndParse("walla").catch((error) => {
      console.warn("[news fetch walla]", {
        url: FEEDS.walla,
        error: error instanceof Error ? error.message : String(error),
      });
      return [] as NewsItem[];
    }),
    fetchWallaMundialTagUrls(),
    fetchYnetMundialArticles(),
  ]);

  const wallaFiltered =
    wallaTagUrls.size >= MIN_TAG_URLS_TO_TRUST
      ? wallaRaw.filter((item) => wallaTagUrls.has(item.link))
      : wallaRaw;

  console.info("[news filter walla]", {
    rawCount: wallaRaw.length,
    tagUrlCount: wallaTagUrls.size,
    keptCount: wallaFiltered.length,
    filtered: wallaTagUrls.size >= MIN_TAG_URLS_TO_TRUST,
  });

  const merged = [...wallaFiltered, ...ynetItems]
    .sort(
      (a, b) =>
        new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
    )
    .slice(0, MAX_ITEMS);

  console.info("[news merge]", {
    wallaCount: wallaFiltered.length,
    ynetCount: ynetItems.length,
    mergedCount: merged.length,
  });

  if (merged.length > 0) {
    const primary: NewsSource = wallaFiltered.length >= ynetItems.length
      ? "walla"
      : "ynet";
    console.info("[news render]", {
      locale,
      source: primary,
      itemCount: merged.length,
    });
    return { items: merged, source: primary };
  }

  console.warn("[news fallback]", {
    from: "walla+ynet-tag",
    to: "ynet-rss",
    reason: "both primary sources returned 0 items",
  });
  const ynetRss = await fetchAndParse("ynet").catch((error) => {
    console.warn("[news fetch ynet]", {
      url: FEEDS.ynet,
      error: error instanceof Error ? error.message : String(error),
    });
    return [] as NewsItem[];
  });

  console.info("[news render]", {
    locale,
    source: "ynet",
    itemCount: ynetRss.length,
  });
  return { items: ynetRss, source: "ynet" };
}

async function fetchAndParse(source: NewsSource): Promise<NewsItem[]> {
  const url = FEEDS[source];
  const started = Date.now();
  const res = await fetch(url, {
    next: { revalidate: REVALIDATE_SECONDS },
    headers: { Accept: "application/rss+xml, application/xml, text/xml" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    console.warn(`[news fetch ${source}]`, {
      url,
      status: res.status,
      durationMs: Date.now() - started,
    });
    return [];
  }

  const xml = await res.text();
  const items = parseRss(xml, source).slice(0, MAX_ITEMS);

  console.info(`[news fetch ${source}]`, {
    url,
    status: res.status,
    itemCount: items.length,
    durationMs: Date.now() - started,
  });

  return items;
}

async function fetchWallaMundialTagUrls(): Promise<Set<string>> {
  const started = Date.now();
  try {
    const res = await fetch(WALLA_MUNDIAL_TAG_URL, {
      next: { revalidate: REVALIDATE_SECONDS },
      headers: { Accept: "text/html" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn("[news fetch walla-tag]", {
        url: WALLA_MUNDIAL_TAG_URL,
        status: res.status,
        durationMs: Date.now() - started,
      });
      return new Set();
    }
    const html = await res.text();
    const urls = new Set(html.match(WALLA_ITEM_URL_PATTERN) ?? []);
    console.info("[news fetch walla-tag]", {
      url: WALLA_MUNDIAL_TAG_URL,
      status: res.status,
      urlCount: urls.size,
      durationMs: Date.now() - started,
    });
    return urls;
  } catch (error) {
    console.warn("[news fetch walla-tag]", {
      url: WALLA_MUNDIAL_TAG_URL,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - started,
    });
    return new Set();
  }
}

async function fetchYnetMundialArticles(): Promise<NewsItem[]> {
  const started = Date.now();
  try {
    const res = await fetch(YNET_MUNDIAL_TAG_URL, {
      next: { revalidate: REVALIDATE_SECONDS },
      headers: { Accept: "text/html" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn("[news fetch ynet-tag]", {
        url: YNET_MUNDIAL_TAG_URL,
        status: res.status,
        durationMs: Date.now() - started,
      });
      return [];
    }
    const html = await res.text();
    const items: NewsItem[] = [];
    const seen = new Set<string>();
    let droppedByPath = 0;
    // Use a local copy of the boundary regex to keep state across calls
    // safe — the YNET_SLOT_BOUNDARY constant is /g and stateful.
    const boundary = new RegExp(YNET_SLOT_BOUNDARY.source, "g");
    let block: RegExpExecArray | null;
    while ((block = boundary.exec(html)) !== null) {
      if (items.length >= MAX_ITEMS) break;
      const body = block[1];
      const linkMatch = body.match(YNET_LINK_RE);
      if (!linkMatch) continue;
      const link = linkMatch[1];
      if (seen.has(link)) continue;
      if (YNET_EXCLUDED_PATHS.some((p) => link.includes(p))) {
        droppedByPath++;
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
        title,
        summary: "",
        link,
        publishedAt: dateMatch ? dateMatch[1] : new Date().toISOString(),
        imageUrl: imgMatch ? imgMatch[1] : null,
        source: "ynet",
      });
    }
    console.info("[news fetch ynet-tag]", {
      url: YNET_MUNDIAL_TAG_URL,
      status: res.status,
      itemCount: items.length,
      droppedByPath,
      durationMs: Date.now() - started,
    });
    return items;
  } catch (error) {
    console.warn("[news fetch ynet-tag]", {
      url: YNET_MUNDIAL_TAG_URL,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - started,
    });
    return [];
  }
}

// --- RSS parser ---------------------------------------------------------

function parseRss(xml: string, source: NewsSource): NewsItem[] {
  const items: NewsItem[] = [];
  const itemRegex = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = pickText(block, "title");
    const link = pickText(block, "link");
    if (!title || !link) continue;

    const rawDescription = pickText(block, "description");
    const summary = clamp(stripTags(rawDescription), SUMMARY_MAX_CHARS);
    const pubDate = pickText(block, "pubDate");
    const guid = pickText(block, "guid") || link;
    const imageUrl = pickImage(block, source);

    items.push({
      id: guid,
      title,
      summary,
      link,
      publishedAt: pubDate || new Date().toUTCString(),
      imageUrl,
      source,
    });
  }

  return items;
}

function pickText(block: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = block.match(re);
  if (!m) return "";
  return decodeEntities(stripCdata(m[1]).trim());
}

function pickImage(block: string, source: NewsSource): string | null {
  if (source === "walla") {
    const m = block.match(/<enclosure\b[^>]*\burl="([^"]+)"/i);
    return m ? m[1] : null;
  }
  if (source === "bbc") {
    const m = block.match(/<media:thumbnail\b[^>]*\burl="([^"]+)"/i);
    return m ? m[1] : null;
  }
  return null;
}

function stripCdata(value: string): string {
  const m = value.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return m ? m[1] : value;
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function clamp(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max - 1).trimEnd() + "…";
}
