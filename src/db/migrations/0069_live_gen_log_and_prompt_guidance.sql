-- Live-bet AI suggestions: a persistent generation-run log + editable per-scope
-- prompt guidance. Both surface inline on /admin/live-bets/suggestions so the
-- admin never has to leave the page to see what the LLM did or to tune it.
-- See _plans/2026-06-28-live-bet-suggestions-log-prompt-publish.md.

-- Admin "house guidance" appended (safely, fenced) to the suggestion system
-- prompt, kept separately for match scope and day scope. Null = no extra
-- steer. It can shape wording/selection but never overrides the hard
-- format/schema/grading/bilingual rules baked into the code prompt.
ALTER TABLE "settings"
  ADD COLUMN IF NOT EXISTS "suggest_guidance_match" text;
--> statement-breakpoint
ALTER TABLE "settings"
  ADD COLUMN IF NOT EXISTS "suggest_guidance_day" text;
--> statement-breakpoint

COMMENT ON COLUMN "settings"."suggest_guidance_match" IS
  'Admin house guidance appended to the match-scope AI suggestion system prompt. Steers selection/wording only; cannot override the hard rules.';
--> statement-breakpoint
COMMENT ON COLUMN "settings"."suggest_guidance_day" IS
  'Admin house guidance appended to the day-scope AI suggestion system prompt. Steers selection/wording only; cannot override the hard rules.';
--> statement-breakpoint

-- One row per AI generation run, written by the server actions in
-- src/app/[lang]/admin/live-bets/suggestions/actions.ts. Inserted 'running'
-- when generation is scheduled, finalized to 'done'/'failed' by the background
-- task. Read-only to admins in the UI; writes go through the service-role pool
-- (which bypasses RLS), and client roles can never mutate it.
CREATE TABLE IF NOT EXISTS "live_gen_runs" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "scope"            text NOT NULL,
  "subject_he"       text NOT NULL,
  "model"            text,
  "requested"        smallint,
  "status"           text NOT NULL DEFAULT 'running',
  "returned"         smallint,
  "valid"            smallint,
  "created"          smallint,
  "failed"           smallint,
  "search_requests"  smallint,
  "input_tokens"     integer,
  "output_tokens"    integer,
  "error"            text,
  "started_by"       uuid NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
  "started_at"       timestamptz NOT NULL DEFAULT now(),
  "finished_at"      timestamptz
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "live_gen_runs_time_idx"
  ON "live_gen_runs" ("started_at" DESC);
--> statement-breakpoint

ALTER TABLE "live_gen_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Admins read all; everyone else sees nothing. service_role (the server-action
-- pool) bypasses RLS, so the actions always have full read/write.
DO $$ BEGIN
  CREATE POLICY "live_gen_runs admin read" ON "live_gen_runs"
    FOR SELECT TO authenticated USING (public.is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- Physical immutability for client roles. The run rows are written only by the
-- service-role pool inside the generation flow.
REVOKE INSERT, UPDATE, DELETE ON "live_gen_runs" FROM authenticated;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON "live_gen_runs" FROM anon;
