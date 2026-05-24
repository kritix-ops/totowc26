ALTER TABLE "matches" ADD COLUMN "api_fixture_id" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "matches_api_fixture_uniq" ON "matches" USING btree ("api_fixture_id");