CREATE TYPE "public"."bracket_slot" AS ENUM('champion', 'runner_up', 'third', 'fourth');--> statement-breakpoint
CREATE TYPE "public"."match_status" AS ENUM('scheduled', 'live', 'final');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('bit', 'paybox');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('player', 'admin');--> statement-breakpoint
CREATE TYPE "public"."stage" AS ENUM('group', 'r32', 'r16', 'qf', 'sf', 'third_place', 'final');--> statement-breakpoint
CREATE TABLE "bracket_predictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"slot" "bracket_slot" NOT NULL,
	"team_code" varchar(3) NOT NULL,
	"points_earned" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_predictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"group_id" varchar(2) NOT NULL,
	"team_code" varchar(3) NOT NULL,
	"predicted_rank" smallint NOT NULL,
	"points_earned" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" varchar(2) PRIMARY KEY NOT NULL,
	"display_order" smallint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match_bets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"home_score" smallint NOT NULL,
	"away_score" smallint NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"points_earned" smallint,
	"was_exact" boolean,
	"was_correct_outcome" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"home_team" varchar(3) NOT NULL,
	"away_team" varchar(3) NOT NULL,
	"kickoff_at" timestamp with time zone NOT NULL,
	"stage" "stage" NOT NULL,
	"group_id" varchar(2),
	"venue" text,
	"status" "match_status" DEFAULT 'scheduled' NOT NULL,
	"home_score" smallint,
	"away_score" smallint,
	"finalized_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"method" "payment_method" NOT NULL,
	"amount_ils" integer NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"phone" text NOT NULL,
	"role" "role" DEFAULT 'player' NOT NULL,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"entry_fee_ils" integer DEFAULT 100 NOT NULL,
	"recipient_phone" text NOT NULL,
	"bet_lock_minutes" smallint DEFAULT 5 NOT NULL,
	"scoring_exact" smallint DEFAULT 15 NOT NULL,
	"scoring_outcome" smallint DEFAULT 3 NOT NULL,
	"scoring_group_perfect" smallint DEFAULT 20 NOT NULL,
	"scoring_champion" smallint DEFAULT 25 NOT NULL,
	"scoring_runner_up" smallint DEFAULT 15 NOT NULL,
	"scoring_third" smallint DEFAULT 8 NOT NULL,
	"scoring_fourth" smallint DEFAULT 5 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"code" varchar(3) PRIMARY KEY NOT NULL,
	"name_he" text NOT NULL,
	"name_en" text NOT NULL,
	"flag" text NOT NULL,
	"group_id" varchar(2)
);
--> statement-breakpoint
ALTER TABLE "bracket_predictions" ADD CONSTRAINT "bracket_predictions_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bracket_predictions" ADD CONSTRAINT "bracket_predictions_team_code_teams_code_fk" FOREIGN KEY ("team_code") REFERENCES "public"."teams"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_predictions" ADD CONSTRAINT "group_predictions_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_predictions" ADD CONSTRAINT "group_predictions_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_predictions" ADD CONSTRAINT "group_predictions_team_code_teams_code_fk" FOREIGN KEY ("team_code") REFERENCES "public"."teams"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_bets" ADD CONSTRAINT "match_bets_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_bets" ADD CONSTRAINT "match_bets_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_home_team_teams_code_fk" FOREIGN KEY ("home_team") REFERENCES "public"."teams"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_away_team_teams_code_fk" FOREIGN KEY ("away_team") REFERENCES "public"."teams"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_decided_by_profiles_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bracket_pred_user_slot_uniq" ON "bracket_predictions" USING btree ("user_id","slot");--> statement-breakpoint
CREATE UNIQUE INDEX "group_pred_user_group_team_uniq" ON "group_predictions" USING btree ("user_id","group_id","team_code");--> statement-breakpoint
CREATE UNIQUE INDEX "group_pred_user_group_rank_uniq" ON "group_predictions" USING btree ("user_id","group_id","predicted_rank");--> statement-breakpoint
CREATE UNIQUE INDEX "match_bets_user_match_uniq" ON "match_bets" USING btree ("user_id","match_id");--> statement-breakpoint
CREATE INDEX "match_bets_user_idx" ON "match_bets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "match_bets_match_idx" ON "match_bets" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "matches_kickoff_idx" ON "matches" USING btree ("kickoff_at");--> statement-breakpoint
CREATE INDEX "matches_stage_idx" ON "matches" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "matches_status_idx" ON "matches" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payments_user_idx" ON "payments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "payments_status_idx" ON "payments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "teams_group_idx" ON "teams" USING btree ("group_id");