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

  // Hebrew: Walla primary, Ynet fallback only when Walla returns
  // nothing usable (network error or zero items). Walla items are
  // filtered down to the World-Cup tag set when the tag page is
  // reachable; if that scrape fails we fall back to the unfiltered
  // world-football feed so the tab is never empty for a transient
  // upstream issue.
  const [wallaRaw, tagUrls] = await Promise.all([
    fetchAndParse("walla").catch((error) => {
      console.warn("[news fetch walla]", {
        url: FEEDS.walla,
        error: error instanceof Error ? error.message : String(error),
      });
      return [] as NewsItem[];
    }),
    fetchWallaMundialTagUrls(),
  ]);

  const walla =
    tagUrls.size >= MIN_TAG_URLS_TO_TRUST
      ? wallaRaw.filter((item) => tagUrls.has(item.link))
      : wallaRaw;

  console.info("[news filter walla]", {
    rawCount: wallaRaw.length,
    tagUrlCount: tagUrls.size,
    keptCount: walla.length,
    filtered: tagUrls.size >= MIN_TAG_URLS_TO_TRUST,
  });

  if (walla.length > 0) {
    console.info("[news render]", {
      locale,
      source: "walla",
      itemCount: walla.length,
    });
    return { items: walla, source: "walla" };
  }

  console.warn("[news fallback]", {
    from: "walla",
    to: "ynet",
    reason: "walla returned 0 items",
  });
  const ynet = await fetchAndParse("ynet").catch((error) => {
    console.warn("[news fetch ynet]", {
      url: FEEDS.ynet,
      error: error instanceof Error ? error.message : String(error),
    });
    return [] as NewsItem[];
  });

  console.info("[news render]", {
    locale,
    source: "ynet",
    itemCount: ynet.length,
  });
  return { items: ynet, source: "ynet" };
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
