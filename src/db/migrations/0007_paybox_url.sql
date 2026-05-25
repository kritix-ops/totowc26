-- Paybox group link as an admin-controlled setting. Replaces the
-- NEXT_PUBLIC_PAYBOX_URL env-var fallback so the organiser can change
-- the link from the admin UI without a redeploy.
--
-- Nullable: while null, the UI falls back to a hard-coded marketing link
-- so the button is never dead. The admin clears the field to "revert to
-- default", or pastes the real Paybox group URL to publish it.

ALTER TABLE "settings"
  ADD COLUMN IF NOT EXISTS "paybox_url" text;
