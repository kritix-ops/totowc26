-- Admin-editable copy overrides. The default Hebrew and English
-- strings live in src/app/[lang]/dictionaries/{he,en}.json and stay
-- in git. This table only stores values the admin edited from
-- /admin/content. The dictionary loader merges any rows here on top
-- of the JSON, so an empty table = ship the JSON as-is.
--
-- See _plans/2026-05-28-admin-content-editor.md.

CREATE TABLE IF NOT EXISTS "content_overrides" (
  "key" text NOT NULL,
  "locale" text NOT NULL,
  "value" text NOT NULL,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_by" uuid REFERENCES "profiles"("id") ON DELETE SET NULL,
  CONSTRAINT "content_overrides_pkey" PRIMARY KEY ("key", "locale")
);

-- Append-only audit. Every save writes a row. "Reset to default"
-- writes a row with new_value = null. We never delete from here.
CREATE TABLE IF NOT EXISTS "content_override_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "key" text NOT NULL,
  "locale" text NOT NULL,
  "old_value" text,
  "new_value" text,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_by" uuid REFERENCES "profiles"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "content_override_history_key_locale_idx"
  ON "content_override_history" ("key", "locale", "updated_at");
