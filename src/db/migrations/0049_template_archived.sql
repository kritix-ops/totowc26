-- Per-row "hide from the template picker" flag on custom_bets.
--
-- Background: every past custom_bet becomes a template candidate on
-- /admin/bets/new and /admin/live-bets/suggestions. As the tournament
-- progresses the list grows, and questions tied to a specific opener
-- ("Will Mexico finish 1st in Group A?") stop being useful templates.
-- Rather than keep the picker noisy or wedge a complicated retention
-- rule, the admin can now flag a bet's "stop offering as a template".
--
-- Boolean, default false, NOT NULL. Flipping it does not affect any
-- player-facing surface — the bet itself stays open / locked / graded
-- exactly as it was; this column only governs whether the bet shows
-- up in the template picker / quick-add chip strips. See the matching
-- listBetTemplates query in src/db/admin-queries.ts and the toggle on
-- /admin/bets/[id]/page.tsx.

ALTER TABLE "custom_bets"
  ADD COLUMN IF NOT EXISTS "template_archived" boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN "custom_bets"."template_archived" IS
  'When true, excludes this row from listBetTemplates so it stops appearing as a quick-add option. Player-facing surfaces ignore the column.';
