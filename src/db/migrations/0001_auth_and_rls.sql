-- Wire profiles.id to Supabase auth.users and set up Row Level Security.
-- Hand-written follow-up to the Drizzle-generated 0000 migration.

-- 1) profiles.id references auth.users(id)
ALTER TABLE "profiles"
  ADD CONSTRAINT "profiles_id_auth_users_fk"
  FOREIGN KEY ("id") REFERENCES auth.users(id) ON DELETE CASCADE;
--> statement-breakpoint

-- 2) Auto-create a profile row when a new user signs up.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, phone)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.phone, NEW.raw_user_meta_data->>'phone', '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
--> statement-breakpoint

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();
--> statement-breakpoint

-- 3) Helper: is the current request from an admin?
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;
--> statement-breakpoint

-- 4) Settings is a singleton - enforce id = 1.
ALTER TABLE "settings" ADD CONSTRAINT settings_singleton CHECK (id = 1);
--> statement-breakpoint

-- 5) Enable RLS on every public table.
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "groups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "teams" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "matches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "match_bets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "group_predictions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bracket_predictions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "settings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- 6) profiles policies
CREATE POLICY "profiles read all" ON "profiles"
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles update own" ON "profiles"
  FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY "profiles admin all" ON "profiles"
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
--> statement-breakpoint

-- 7) Reference tables: public read, admin write.
CREATE POLICY "groups read" ON "groups" FOR SELECT TO authenticated USING (true);
CREATE POLICY "groups admin write" ON "groups"
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "teams read" ON "teams" FOR SELECT TO authenticated USING (true);
CREATE POLICY "teams admin write" ON "teams"
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "matches read" ON "matches" FOR SELECT TO authenticated USING (true);
CREATE POLICY "matches admin write" ON "matches"
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "settings read" ON "settings" FOR SELECT TO authenticated USING (true);
CREATE POLICY "settings admin write" ON "settings"
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
--> statement-breakpoint

-- 8) match_bets: read all, write own, cannot edit once locked or scored.
CREATE POLICY "match_bets read all" ON "match_bets"
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "match_bets insert own" ON "match_bets"
  FOR INSERT TO authenticated WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.matches m, public.settings s
      WHERE m.id = match_bets.match_id
        AND m.status = 'scheduled'
        AND m.kickoff_at > now() + (s.bet_lock_minutes || ' minutes')::interval
    )
  );

CREATE POLICY "match_bets update own unlocked" ON "match_bets"
  FOR UPDATE TO authenticated USING (
    user_id = auth.uid()
    AND locked = false
    AND points_earned IS NULL
  ) WITH CHECK (
    user_id = auth.uid()
    AND locked = false
  );

CREATE POLICY "match_bets admin all" ON "match_bets"
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
--> statement-breakpoint

-- 9) group_predictions: read all, write own before tournament start.
CREATE POLICY "group_pred read all" ON "group_predictions"
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "group_pred write own" ON "group_predictions"
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "group_pred admin all" ON "group_predictions"
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
--> statement-breakpoint

-- 10) bracket_predictions
CREATE POLICY "bracket_pred read all" ON "bracket_predictions"
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "bracket_pred write own" ON "bracket_predictions"
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "bracket_pred admin all" ON "bracket_predictions"
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
--> statement-breakpoint

-- 11) payments: users read & insert own, admins manage all.
CREATE POLICY "payments read own" ON "payments"
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "payments insert own" ON "payments"
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "payments admin all" ON "payments"
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
--> statement-breakpoint

-- 12) Seed singleton settings row so app reads never fail.
INSERT INTO "settings" (id, recipient_phone)
VALUES (1, '054-1234567')
ON CONFLICT (id) DO NOTHING;
