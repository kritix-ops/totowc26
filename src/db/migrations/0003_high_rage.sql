CREATE TYPE "public"."special_bet_type" AS ENUM('top_scorer', 'final_penalties');--> statement-breakpoint
CREATE TABLE "special_bets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"bet_type" "special_bet_type" NOT NULL,
	"value" text NOT NULL,
	"points_earned" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tournament_results" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"top_scorer" text,
	"final_went_to_penalties" boolean,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "match_bets" ADD COLUMN "bet_btts" boolean;--> statement-breakpoint
ALTER TABLE "match_bets" ADD COLUMN "bet_over_25" boolean;--> statement-breakpoint
ALTER TABLE "match_bets" ADD COLUMN "bet_ht_home" smallint;--> statement-breakpoint
ALTER TABLE "match_bets" ADD COLUMN "bet_ht_away" smallint;--> statement-breakpoint
ALTER TABLE "match_bets" ADD COLUMN "points_btts" smallint;--> statement-breakpoint
ALTER TABLE "match_bets" ADD COLUMN "points_over_25" smallint;--> statement-breakpoint
ALTER TABLE "match_bets" ADD COLUMN "points_ht" smallint;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "ht_home_score" smallint;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "ht_away_score" smallint;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "went_to_penalties" boolean;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "scoring_btts" smallint DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "scoring_over_25" smallint DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "scoring_ht_exact" smallint DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "scoring_ht_outcome" smallint DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "scoring_top_scorer" smallint DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "scoring_final_penalties" smallint DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "special_bets" ADD CONSTRAINT "special_bets_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "special_bets_user_type_uniq" ON "special_bets" USING btree ("user_id","bet_type");