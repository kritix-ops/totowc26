// Re-exports the shared error-translation surface for admin forms.
//
// Kept as its own module so the admin tree's imports stay stable
// (`@/lib/admin/errors`) even though the underlying helper lives in
// `@/lib/error-i18n` next to the player-facing COMMON_PLAYER_ERRORS
// map. New admin-specific error catalogs can land here without
// touching player-side imports.
export {
  COMMON_ADMIN_ERRORS,
  translateError as translateAdminError,
  type LocalizedTuple,
} from "@/lib/error-i18n";
