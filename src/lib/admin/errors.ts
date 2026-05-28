// Shared error-translation helper for admin forms.
//
// Server actions in the admin tree return `{ ok: false, error: "<key>" }`
// where the key is a stable machine-readable code. The UI surfaces a
// localized message for each known code, and falls back to echoing the
// raw key for unknown ones (so a new server error surfaces visibly
// during development instead of being silently swallowed).
//
// Every admin form used to ship its own near-identical `translateError`
// function; this module is the single source of truth. Each form
// composes the COMMON map with its own domain-specific codes via
// `{ ...COMMON_ADMIN_ERRORS, ...mySpecificErrors }`.

export type LocalizedTuple = readonly [hebrew: string, english: string];

// Codes that every admin server action might return. Imported and spread
// into the per-form map so domain-specific codes layer on top.
export const COMMON_ADMIN_ERRORS = {
  unauth: ["יש להתחבר", "Sign in required"],
  forbidden: ["אין הרשאות אדמין", "Admin role required"],
  invalid: ["ערך לא תקין", "Invalid value"],
  db: ["שגיאת שמירה", "Save failed"],
} as const satisfies Record<string, LocalizedTuple>;

// Translate a server-action error `code` against the supplied `map`.
// Returns the Hebrew or English string per `isHebrew`, or the raw `code`
// if the map has no entry (visible-by-design for unknown codes).
export function translateAdminError(
  code: string,
  map: Record<string, LocalizedTuple>,
  isHebrew: boolean,
): string {
  const tuple = map[code];
  return tuple ? tuple[isHebrew ? 0 : 1] : code;
}
