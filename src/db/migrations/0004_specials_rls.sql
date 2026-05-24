-- RLS for the two new tables added by 0003.

ALTER TABLE "special_bets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tournament_results" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- special_bets: read all (so leaderboard / friends' picks are visible),
-- write own, admins can do anything.
CREATE POLICY "special_bets read all" ON "special_bets"
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "special_bets write own" ON "special_bets"
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "special_bets admin all" ON "special_bets"
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
--> statement-breakpoint

-- tournament_results: read all, admin-only write.
CREATE POLICY "tournament_results read" ON "tournament_results"
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "tournament_results admin write" ON "tournament_results"
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
--> statement-breakpoint

-- Singleton row constraint for tournament_results.
ALTER TABLE "tournament_results"
  ADD CONSTRAINT tournament_results_singleton CHECK (id = 1);
--> statement-breakpoint

-- Seed the singleton row so future SELECTs always have a row to grade against.
INSERT INTO "tournament_results" (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
