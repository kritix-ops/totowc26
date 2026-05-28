-- News archive for the tournament News tab.
--
-- Today /[lang]/tournament?tab=news fetches Walla/Ynet/BBC live on every
-- render, cached for 15 min — which means "today only" by accident: the
-- upstream feeds drop items off their window within hours and we have no
-- store. This migration adds the table the new cron writes into and the
-- read endpoint reads from, so the tab can scroll back through every day
-- of the tournament.
--
-- Scope decision per _plans/2026-05-29-news-archive-and-lazy-load.md:
-- archive starts from 2026-06-11 (kickoff). Pre-tournament news is not
-- backfilled — the in-memory feed has covered May fine and there is no
-- asset to recover.
--
-- news_items: one row per article, dedup'd by canonical link.
--   link UNIQUE is both the natural key (RSS guid frequently is the URL)
--   and the cron's ON CONFLICT target — we never overwrite an existing
--   row, so first-seen title/summary win. Editorial corrections upstream
--   are accepted as-is at the upstream; replaying them here would let a
--   stale cache shadow them and confuse readers.
--
-- news_sync_cursors: per-source HTTP cache state (Last-Modified / ETag).
--   Walla and BBC honour conditional GETs; storing the last-seen values
--   lets the cron return early on 304 without parsing the body, which
--   cuts our share of upstream bandwidth and keeps function durations
--   tight. Ynet is HTML scrape — no reliable validators — so its row
--   exists but stays empty.

CREATE TABLE IF NOT EXISTS "news_items" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "source"       text NOT NULL,
  "lang"         text NOT NULL,
  "link"         text NOT NULL,
  "title"        text NOT NULL,
  "summary"      text NOT NULL DEFAULT '',
  "image_url"    text,
  "published_at" timestamptz NOT NULL,
  "fetched_at"   timestamptz NOT NULL DEFAULT now(),
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "news_items_link_uniq" UNIQUE ("link")
);
--> statement-breakpoint

-- Composite index for the read path: WHERE lang = $1 AND published_at <
-- $2 ORDER BY published_at DESC LIMIT $3. The DESC matches the keyset
-- scan direction so Postgres reads the index forwards instead of doing
-- a sort node.
CREATE INDEX IF NOT EXISTS "news_items_lang_published_idx"
  ON "news_items" ("lang", "published_at" DESC);
--> statement-breakpoint

ALTER TABLE "news_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- News headlines are public on the upstream sites; mirror that here.
-- Anonymous + authenticated reads both pass.
CREATE POLICY "news_items public read" ON "news_items"
  FOR SELECT TO anon, authenticated USING (true);
--> statement-breakpoint

-- Only admins can mutate via the dashboard (manual cleanup). The cron
-- writes with the service role and bypasses RLS entirely.
CREATE POLICY "news_items admin all" ON "news_items"
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "news_sync_cursors" (
  "source"          text PRIMARY KEY,
  "last_modified"   text,
  "etag"            text,
  "last_fetched_at" timestamptz,
  "last_status"     smallint,
  "updated_at"      timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

ALTER TABLE "news_sync_cursors" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Cursors are internal sync bookkeeping — no public read. Admin can
-- inspect, cron writes via service role.
CREATE POLICY "news_sync_cursors admin all" ON "news_sync_cursors"
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
