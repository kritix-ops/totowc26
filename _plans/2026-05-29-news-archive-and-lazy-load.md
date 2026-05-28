# News archive + lazy load + date filter

Date: 2026-05-29
Status: approved
Owner: yoav
Builds on: `_plans/2026-05-27-tournament-news-rss.md`

## Goal

Today the news tab shows whatever the RSS sources happen to be serving in
their feed window — incidental "today only", purely cache-driven. Make it
a real archive the user can scroll back through, with date filtering, so
the News tab survives across all six weeks of the tournament without
losing yesterday's headlines.

## Constraints

- Friends-pool app. Low stakes. Vercel free tier.
- Storage stays on the existing Supabase Postgres.
- Asia/Jerusalem for every user-facing timestamp via
  `formatDateTime` from `src/lib/format.ts`. No `Intl.DateTimeFormat`
  with implicit TZ.
- Mobile-first per `CLAUDE.md`. 44px touch targets, 360px works, the
  date picker must not blow up the page height on small screens.
- Polite scraper norms: 30-minute cadence with jitter, conditional GETs
  where the upstream supports them.

## Requirements (aligned with user)

- Archive horizon: from **2026-06-11** (tournament kickoff) and forward.
  Pre-tournament news is ignored — the existing in-memory feed has been
  serving fine for that period and there is no asset to backfill.
- Navigation: infinite scroll (`IntersectionObserver` on a sentinel)
  with a date-picker that jumps the cursor to a specific day. Default
  view is "from latest, scroll down for older."
- Cadence: every 30 minutes with ±3 min jitter, uniform across all three
  sources.
- Per-source failure isolation: one source crashing must not stop the
  others. Each source records its own success/failure counters and the
  cron returns 200 with a per-source report.

## Chosen approach

### 1. DB — new table `news_items`

```sql
CREATE TABLE news_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source       text NOT NULL,            -- 'walla' | 'ynet' | 'bbc'
  lang         text NOT NULL,            -- 'he' | 'en'
  link         text NOT NULL,            -- canonical article URL
  title        text NOT NULL,
  summary      text NOT NULL DEFAULT '',
  image_url    text,
  published_at timestamptz NOT NULL,     -- from feed/article, IL-safe
  fetched_at   timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT news_items_link_uniq UNIQUE (link)
);

CREATE INDEX news_items_lang_published_idx
  ON news_items (lang, published_at DESC);
```

- `link` is the dedup key (matches the existing `NewsItem.id` choice).
- The `(lang, published_at DESC)` index supports both "latest 20" and
  keyset pagination by published_at without sequential scan.
- RLS: enable, public select (news is public anyway), service-role
  inserts via the cron. No user writes.

`sync_runs` is the existing fixtures-sync log; we don't reuse it for
news — different shape (per-source counters). Per-source counters land
inline in the cron's JSON response, plus `console.info` logs. If we
need an audit table later we can add `news_sync_runs`; not now.

### 2. Sync — `src/lib/news-sync.ts` + `/api/cron/news`

`syncNews({ source })` fetches all three sources in parallel, each in
its own `try/catch`. For each item, upsert by `link`:

```sql
INSERT INTO news_items (...) VALUES (...)
ON CONFLICT (link) DO NOTHING
```

(We never overwrite — once an item exists, its `published_at` and
`title` are frozen. RSS feeds occasionally edit summaries; we accept
the first-seen version. This is simpler and good enough.)

Each source returns `{ fetched, inserted, skipped, errorMessage? }`.

`/api/cron/news` (GET/POST, `Authorization: Bearer ${CRON_SECRET}`):
- Adds **jitter**: `await sleep(randomInt(0, 180_000))` at the top of
  the handler. Vercel cron fires at exactly `:00/:30`; jitter ensures
  the upstream sees a varied request pattern. The Vercel function
  budget tolerates this — the handler is short and bounded by 60s
  Hobby plan limits.
- Returns `{ ok, per_source: { walla, ynet, bbc } }` with status 200
  even on partial failure (so cron retries don't pile up). Status 500
  only if everything blew up.

**Conditional GETs:** Walla and BBC RSS support `If-Modified-Since` and
`ETag`. We store the last-seen `Last-Modified` / `ETag` per source in
a tiny `news_sync_cursors` table (or as JSONB on `settings` — single
row keyed by source). When the upstream returns 304, we skip parsing
and increment a `not_modified` counter. Ynet HTML scrape doesn't
support this reliably; we always fetch.

Headers sent to all three sources:
- `User-Agent: "TotoMundial/1.0 (+https://kritix.io)"`
- `Accept: <appropriate per source>`
- `Accept-Language: he-IL, en;q=0.5` (helps for Hebrew sources)

### 3. Read API — `/api/news`

```
GET /api/news?lang=he&before=<iso>&limit=20
```

- `lang`: `he` or `en` (default `he`). Filters on `lang` column.
- `before`: ISO timestamp. Returns items with `published_at < before`.
  Omitted = "from latest". This is **keyset pagination**, not offset —
  works correctly even when the cron inserts new rows during a scroll
  session.
- `limit`: clamped to `[1, 50]`, default 20.

Response:
```json
{
  "items": [{ "id", "source", "title", "summary", "link", "imageUrl",
              "publishedAt" }],
  "nextCursor": "<oldest published_at in this page, or null if exhausted>"
}
```

`Cache-Control: public, s-maxage=60, stale-while-revalidate=300` —
fresh enough that new items show within ~1 min, but still caches the
hot "first page" between users.

### 4. UI — `NewsTab` → client component with infinite scroll

`NewsTab.tsx` stays the entry point but becomes a thin server wrapper:
- Server-fetches the first page directly from the DB (no extra
  round-trip) and passes it to a new client component
  `NewsList.tsx`.
- `NewsList.tsx` (`"use client"`) renders the cards, owns the cursor
  state, and uses `IntersectionObserver` on a sentinel `<li>` at the
  bottom to call `/api/news?before=<cursor>&lang=...` for the next
  page.

**Date picker:**
- A single `<input type="date">` above the list with a clear-button.
  Native picker — zero new dependencies, mobile-perfect on iOS/Android
  out of the box (rule 10: lazy user), `font-size: 16px` to avoid iOS
  zoom-on-focus.
- Picking a date resets the list and sets `before = endOfDay(picked,
  IL)`. The result is "items published up to and including that day,
  newest first." Clear-button restores "from latest."

**Empty/error states (rule 16):**
- Empty (filtered date earlier than archive horizon, or all sources
  empty for that day): show the existing `newsEmpty*` card.
- Network error on fetching next page: inline retry button under the
  last visible card. Initial-render error falls back to the existing
  empty card with a different message (`newsErrorBody`).

**Loading state:**
- A skeleton card under the visible list while the next page loads.
  No spinners — matches the existing card geometry so layout doesn't
  shift.

### 5. Migrating from the live `getNewsForLocale` fetcher

`src/lib/news.ts` keeps its parser and source-fetch helpers
(`fetchAndParse`, `fetchWallaMundialTagUrls`, `fetchYnetMundialArticles`,
`verifyYnetMundialArticle`) — they become the inputs to the sync. The
old `getNewsForLocale(locale)` API is **removed** from the server entry
path: the tab no longer fetches live, it reads from the DB. The lib
file is renamed in its export role but the file path stays the same to
avoid a wide rename diff.

If the cron has not yet produced any rows (first deploy, tournament
hasn't started, DB wipe), the read API returns an empty page and the
UI renders the empty state — same UX as today's "no items returned"
case.

## Alternatives rejected

- **Keep in-memory only with longer ISR window.** Doesn't solve "scroll
  back to yesterday" — RSS feeds drop items off the feed within hours.
- **Offset pagination (LIMIT/OFFSET).** Breaks when the cron inserts
  rows during a scroll session: page 2 would repeat items already
  shown on page 1. Keyset is correct here.
- **Per-day pre-aggregated tabs.** Heavier UI, more DB queries, doesn't
  beat infinite scroll for "I want to see what happened yesterday." The
  date picker covers the "jump to day" use case without committing to
  a tab-per-day layout.
- **Reuse `sync_runs` for news.** Different counters, different
  failure mode; the JOIN-less audit gain isn't worth the schema mush.

## Security

- All three sources are public RSS/HTML, no auth or PII stored.
- `link UNIQUE` prevents storage-DoS via duplicate insert spam (cron is
  the only writer anyway, but defense in depth).
- HTML in titles/summaries: continue to `stripTags` + `decodeEntities`
  before insert. The DB stores plain text.
- `image_url`: stored as-is but only rendered through `next/image`
  with the existing pinned `remotePatterns` allow-list — arbitrary
  hosts won't render even if the upstream feed adds new CDNs.
- External links: `target="_blank" rel="noopener noreferrer"` (already
  in the existing card).
- RLS: `news_items` public SELECT (news is public), service role
  bypass for inserts. No INSERT/UPDATE/DELETE policies for
  authenticated users.
- Cron endpoint: `Authorization: Bearer ${CRON_SECRET}` (matches the
  existing sync route exactly — no `?secret=` fallback).
- Rate-limit considerations: at 48 runs/day × 3 sources = 144 upstream
  hits/day, well below polite-scraper norms. Jitter avoids a thundering
  herd pattern. Ynet article-verification fans out per item but only
  on fresh items (after the cron upsert filter sees them); steady state
  is a handful per cron tick.

## Observability

- `[news sync]` — per cron tick: `{ jitterMs, totalFetched, totalInserted,
  totalSkipped, durationMs }`.
- `[news sync walla]`, `[news sync ynet]`, `[news sync bbc]` —
  per-source: `{ fetched, inserted, skipped, notModified, ok, error?,
  durationMs }`.
- `[news api]` — per `/api/news` request: `{ lang, before, limit,
  count, oldest, hasMore }`.
- `[news list]` (client) — `{ event: 'init' | 'load_more' | 'pick_date'
  | 'error', count, before? }`.
- `[news render]` — kept from the existing implementation, now logged
  from the server wrapper rendering the first page.

`console.info` for normal flow, `console.warn` for partial failures
(one source down), `console.error` only for total cron failure.

## Settings audit

No new user-facing settings in this PR. Candidates if a settings layer
lands later:
- "Default time range" (24h / 7d / all-archive).
- "Hide source X" (per-user mute).

Neither is justified for a friends pool. Skip.

## Open questions

- Retention policy: do we prune rows older than X months after the
  tournament ends? Not in scope for this PR — the table will hold ~6
  weeks × ~3 sources × ~20 items/day = ~2500 rows at most, which is
  zero practical cost. Decide at end-of-tournament whether to keep
  the archive permanently or archive it to S3 / drop it.
- Localized headlines: Hebrew sources sometimes link to English
  articles or vice versa. Out of scope; locale picks the source pool,
  the source picks the article language.

## Files touched

- `src/db/migrations/0033_news_items.sql` (new)
- `src/db/schema.ts` (add `newsItems`, `newsSyncCursors`)
- `src/lib/news.ts` (keep parsing helpers, drop `getNewsForLocale`
  page-fetch path)
- `src/lib/news-sync.ts` (new — orchestrates sync, writes to DB)
- `src/lib/news-read.ts` (new — keyset query helper)
- `src/app/api/cron/news/route.ts` (new)
- `src/app/api/news/route.ts` (new — read endpoint)
- `src/app/[lang]/tournament/NewsTab.tsx` (thin server wrapper)
- `src/app/[lang]/tournament/NewsList.tsx` (new — client component)
- `src/app/[lang]/dictionaries/he.json`, `en.json` (new strings)
- `vercel.json` (add `/api/cron/news` schedule `*/30 * * * *`)
