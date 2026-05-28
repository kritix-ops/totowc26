import "server-only";

// Hand-rolled RSS 2.0 reader and Walla / Ynet / BBC source descriptors.
// The render path no longer lives here — `/api/cron/news` calls into
// `news-sync.ts` to populate the `news_items` table, and the tab reads
// from the DB via `news-read.ts`. What stays in this file is the
// shared vocabulary both halves need: the parsed-item shape, the
// per-source URLs and scrape patterns, and the pure parsing primitives.
// Keeping the parser local means no extra dependency and a tiny attack
// surface (rule 13). Server-only: runs inside the Next runtime, never
// on the client.

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

export const FETCH_TIMEOUT_MS = 8000;
export const SUMMARY_MAX_CHARS = 220;

export const FEEDS = {
  walla: "https://rss.walla.co.il/feed/316",
  ynet: "https://www.ynet.co.il/Integration/StoryRss3.xml",
  bbc: "https://feeds.bbci.co.uk/sport/football/world-cup/rss.xml",
} as const;

// Walla's tag page for "מונדיאל 2026". Walla doesn't expose a
// tag-specific RSS, so we scrape this page server-side to get the set of
// article URLs tagged for the World Cup, then intersect with the world-
// football RSS to keep only true World-Cup items.
export const WALLA_MUNDIAL_TAG_URL =
  "https://tags.walla.co.il/%D7%9E%D7%95%D7%A0%D7%93%D7%99%D7%90%D7%9C_2026";
export const WALLA_ITEM_URL_PATTERN = /https?:\/\/sports\.walla\.co\.il\/item\/\d+/g;
export const MIN_TAG_URLS_TO_TRUST = 5;

// Ynet's tag page for "מונדיאל 2026". Ynet's general sports RSS feed
// hardly carries any World-Cup items in May 2026, so intersecting it
// would yield ~zero. Instead we scrape the tag page directly. The page
// is built from repeated <div class="slotView"> blocks; we split on
// those boundaries and extract title/link/date/image per block, so
// adding or removing a variant in the future never bleeds one card's
// fields into another. We deliberately keep only blocks whose title
// sits inside a slotTitle <span> - that excludes the page's "תוכן
// גולשים" sidebar widgets, which use a plain anchor with no span and
// are not Mundial articles.
export const YNET_MUNDIAL_TAG_URL =
  "https://www.ynet.co.il/topics/%D7%9E%D7%95%D7%A0%D7%93%D7%99%D7%90%D7%9C_2026";
export const YNET_SLOT_BOUNDARY =
  /<div class="slotView"[^>]*>([\s\S]*?)(?=<div class="slotView"|<\/section>|<footer)/g;
export const YNET_LINK_RE =
  /href="(https:\/\/www\.ynet\.co\.il\/sport(?:\/[a-z]+)?\/article\/[A-Za-z0-9_-]+)"/;
export const YNET_TITLE_RE =
  /<(?:h[12]|div)\s+[^>]*class="slotTitle[^"]*"[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/;
export const YNET_DATE_RE = /dateTime="([^"]+)"/;
export const YNET_IMG_RE = /<img\s+[^>]*src="([^"]+)"/;
// Ynet articles carry their primary category in the URL path
// (/sport/<category>/article/<id>). The Mundial-2026 tag page also
// mixes in editorially-curated "trending" sports articles that aren't
// actually tagged Mundial at all - verified by fetching the articles
// directly (zero "מונדיאל" mentions in their own body). So we do two
// passes: (1) drop articles whose primary category is clearly off-
// topic by URL path, (2) fetch each remaining article and require at
// least MIN_YNET_MUNDIAL_MENTIONS occurrences of "מונדיאל" in the body.
// Pass 2 is the load-bearing filter; pass 1 just keeps the per-render
// article-fetch count low.
export const YNET_EXCLUDED_PATHS = [
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
export const MIN_YNET_MUNDIAL_MENTIONS = 2;
export const YNET_MUNDIAL_BODY_RE = /מונדיאל/g;

// --- RSS parser ---------------------------------------------------------

export function parseRss(xml: string, source: NewsSource): NewsItem[] {
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

export function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

export function decodeEntities(value: string): string {
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
