-- Admin-editable WhatsApp group invite URL. Surfaced on the profile
-- page as a single tappable card. Null hides the card so the admin
-- can take the link down without a deploy if the group is rotated.
--
-- Seeded with the current hardcoded link so existing deployments
-- don't lose the card during the migration window.

ALTER TABLE "settings"
  ADD COLUMN IF NOT EXISTS "whatsapp_group_url" text;

UPDATE "settings"
   SET "whatsapp_group_url" = 'https://chat.whatsapp.com/Ixy10PR5oIQ4iEZ6wsusVU'
 WHERE "id" = 1
   AND "whatsapp_group_url" IS NULL;
