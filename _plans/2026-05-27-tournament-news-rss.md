# Tournament news tab — RSS feed

Date: 2026-05-27
Status: approved
Owner: yoav

## Goal

Replace the `news` tab placeholder on `/[lang]/tournament` with a real
list of news headlines. Hebrew users see Hebrew sources; English users
see English sources. Locale picks the feed; nothing else.

## Constraints

- Friends-pool app, low stakes. No paid news API.
- Next 16 App Router. RSS is XML; must be parsed server-side (CORS).
- Project rule: every user-facing date renders in `Asia/Jerusalem` via
  `formatDateTime` from `src/lib/format.ts`.
- Mobile-first per project `CLAUDE.md` (44px touch targets, 360px works).
- Vercel free tier; cache aggressively to avoid burning the function
  budget and to be a good neighbour to the upstream feeds.

## Requirements (aligned with user)

- Hebrew: Walla world-football feed primary, Ynet sports as fallback
  only when Walla fails or returns zero items.
- English: BBC World Cup feed only.
- Cache TTL: 15 minutes (`revalidate: 900`).
- Display per item: thumbnail (from `<enclosure>` for Walla,
  `<media:thumbnail>` for BBC, none for Ynet), title, 1–2 line summary,
  Jerusalem-time timestamp, source name. Card layout.
- Remove the `tabBadgeSoon` badge from the News tab on the same PR — the
  feed is no longer "coming soon".

## Chosen approach

1. `src/lib/news.ts` — server-only. Pure RSS 2.0 parser written by hand
   (no new dependency; XML is simple here and a custom parser keeps the
   attack surface small). Exports `getNewsForLocale(locale)` which:
   - For `he`: fetches Walla feed/316 with `next: { revalidate: 900 }`.
     If the response is non-OK or yields 0 items, falls back to Ynet
     StoryRss3 with the same TTL. Logs which branch fired.
   - For `en`: fetches the BBC World Cup feed only.
   - Returns `{ items: NewsItem[], source: 'walla' | 'ynet' | 'bbc' }`
     with at most 20 items, newest first.
2. `src/app/[lang]/tournament/NewsTab.tsx` — server component that
   awaits `getNewsForLocale` and renders the list. Empty/error states
   are explicit (rule 16). Each card is a full-width clickable area on
   mobile, links open in a new tab with `rel="noopener noreferrer"`.
3. `src/app/[lang]/tournament/page.tsx` — drop the `tabBadgeSoon` badge
   on the News tab spec.
4. `src/app/[lang]/dictionaries/{he,en}.json` — add strings for the
   news tab heading, "powered by" line, empty state, error state, and
   "open article" aria-label. Keep the existing
   `newsComingSoon*` keys in place but unused for now — easy to remove
   in a follow-up if we are sure we won't roll back.
5. `next.config.ts` — add `images.remotePatterns` for
   `ichef.bbci.co.uk` and `images.wcdn.co.il` so `next/image` can serve
   the thumbnails optimised.

### Why a hand-rolled RSS parser

Three RSS feeds, three slightly different shapes (enclosure vs
media:thumbnail vs no thumbnail). The parsing surface is small enough
that a 40-line custom function is clearer and safer than pulling in
`fast-xml-parser` or `rss-parser`. No new supply-chain risk per rule 13.

## Alternatives rejected

- **Client-side RSS fetch via API route polled from the browser** —
  doubles the round-trip, breaks ISR caching benefits, and forces a
  loading spinner where SSR can just render. Rejected.
- **Aggregator service (FeedSpot, RSS.app)** — paid above a tiny tier,
  introduces a third-party dependency for a feature that doesn't need
  one. Violates rule 8 (cost) for no real gain.
- **Mix Walla + Ynet + Sport5 + ONE** — Sport5 and ONE don't expose
  public RSS endpoints (verified). Ynet's general sports feed is
  Israeli-football-heavy with very little World-Cup signal in May. So
  Walla world-football is the right primary source; Ynet only earns its
  spot when Walla is down. (User explicitly chose this.)

## Security

- All feeds are public, read-only, no auth or PII.
- XML parser must:
  - Never `eval` or build a DOM.
  - Strip HTML tags from `<description>` before display (descriptions
    may contain inline markup we don't want to render).
  - Decode XML entities (`&amp;`, `&lt;`, etc.) on extracted text.
- External links: `target="_blank" rel="noopener noreferrer"`.
- External images: pinned to two specific hostnames via
  `images.remotePatterns`. Adding a new feed later means an explicit
  config update; we don't accept arbitrary image hosts.
- Cache TTL 900s = 4 hits/hour to each upstream. Walla and BBC both
  publish without robots restrictions on these endpoints; this is well
  inside polite-crawler norms.
- No user input flows into the fetch — locale is the only switch and is
  validated by `hasLocale` upstream.

## Observability

Log namespaces:
- `[news fetch walla]`, `[news fetch ynet]`, `[news fetch bbc]` — emit
  `{ url, status, itemCount, durationMs }` on success and
  `{ url, error }` on failure. Always log values, not just verbs (per
  rule 14).
- `[news fallback]` — emit `{ from: 'walla', to: 'ynet', reason }` when
  the Hebrew fallback fires.
- `[news render]` — emit `{ locale, source, itemCount }` once per page
  render of the news tab.

These are `console.info` for success paths and `console.warn` for
fallback or partial-failure paths so they show up clearly in Vercel
runtime logs.

## Settings audit

No new user-facing settings exposed in this PR. Two settings would be
candidates if the project grows a real settings layer:

- "Preferred news sources" (multi-select).
- "Refresh interval" (15m / 1h / off).

We deliberately don't expose either now: the project has no settings
layer yet and a one-off knob just for news would land in the wrong
place. Re-evaluate when a global settings page lands.

## Open questions

- Do we want to log a `news.click` analytic event when a user opens a
  story? Out of scope for this PR; can be added when we have any other
  client analytics infrastructure.
