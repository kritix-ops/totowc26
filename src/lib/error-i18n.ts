// Generic error-translation helper shared by every form (admin AND
// player) in the app.
//
// Server actions return `{ ok: false, error: "<key>" }` where the key
// is a stable machine-readable code. The UI surfaces a localized
// message for each known code, and falls back to echoing the raw key
// for unknown ones — that way a new server error surfaces visibly
// during development instead of being silently swallowed.
//
// Each caller composes a `Record<code, [hebrew, english]>` map and
// passes it to `translateError(code, map, isHebrew)`. Common error
// codes that show up across many forms live next to the helper as
// shared maps (COMMON_PLAYER_ERRORS, COMMON_ADMIN_ERRORS) and are
// spread into the per-form map at the top — that way "unauth" /
// "db" / "invalid" wording stays consistent across surfaces.

export type LocalizedTuple = readonly [hebrew: string, english: string];

// Codes that every player-side server action might return. Spread into
// the per-form map (`{ ...COMMON_PLAYER_ERRORS, ...mySpecificErrors }`)
// so domain-specific codes layer on top.
export const COMMON_PLAYER_ERRORS = {
  unauth: ["יש להתחבר", "Sign in required"],
  not_paid: [
    "התשלום שלך לא אושר עדיין",
    "Your entry payment is not approved yet",
  ],
  invalid: ["ערכים לא תקינים", "Invalid values"],
  locked: ["ההימור נעול", "Bet is locked"],
  not_found: ["לא נמצא", "Not found"],
  db: ["שגיאת שמירה", "Save failed"],
} as const satisfies Record<string, LocalizedTuple>;

// Codes that every admin server action might return.
export const COMMON_ADMIN_ERRORS = {
  unauth: ["יש להתחבר", "Sign in required"],
  forbidden: ["אין הרשאות אדמין", "Admin role required"],
  invalid: ["ערך לא תקין", "Invalid value"],
  db: ["שגיאת שמירה", "Save failed"],
} as const satisfies Record<string, LocalizedTuple>;

// Translate a server-action error `code` against the supplied `map`.
// Returns the Hebrew or English string per `isHebrew`, or the raw
// `code` if the map has no entry (visible-by-design for unknown codes
// so a new server-side error doesn't silently disappear).
export function translateError(
  code: string,
  map: Record<string, LocalizedTuple>,
  isHebrew: boolean,
): string {
  const tuple = map[code];
  return tuple ? tuple[isHebrew ? 0 : 1] : code;
}
