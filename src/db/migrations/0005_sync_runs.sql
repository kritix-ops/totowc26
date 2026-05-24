-- Persistent log of every football-data sync attempt (cron or manual).
-- Stores the full SyncReport JSON, error messages, and timing so admins can
-- audit what happened without scraping Vercel logs.

CREATE TABLE IF NOT EXISTS "sync_runs" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "started_at"     timestamptz NOT NULL DEFAULT now(),
  "finished_at"    timestamptz,
  "duration_ms"    integer,
  "source"         text NOT NULL DEFAULT 'cron',  -- 'cron' | 'admin' | 'cli'
  "triggered_by"   uuid REFERENCES "profiles"("id") ON DELETE SET NULL,
  "ok"             boolean NOT NULL DEFAULT false,
  "fetched"        integer DEFAULT 0,
  "inserted"       integer DEFAULT 0,
  "updated"        integer DEFAULT 0,
  "skipped"        integer DEFAULT 0,
  "scored_bets"    integer DEFAULT 0,
  "scored_matches" integer DEFAULT 0,
  "scored_specials" integer DEFAULT 0,
  "unknown_teams"  jsonb,
  "error_message"  text,
  "error_stack"    text
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS sync_runs_started_idx
  ON "sync_runs" ("started_at" DESC);
--> statement-breakpoint

ALTER TABLE "sync_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Only admins can read sync logs. Service role bypasses RLS for inserts from
-- the cron / server actions.
CREATE POLICY "sync_runs admin read" ON "sync_runs"
  FOR SELECT TO authenticated USING (public.is_admin());

CREATE POLICY "sync_runs admin all" ON "sync_runs"
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
