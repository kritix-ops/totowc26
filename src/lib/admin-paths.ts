// Pure data + helpers for the admin path catalog. Kept separate from
// src/lib/admin.ts so unit tests can import without dragging in the
// Supabase client (which throws when env vars are absent in the test
// runner). See _plans/2026-06-12-live-bets-admin-role.md (revision 2).

import {
  ADMIN_PERMISSION_KEYS,
  type AdminPermissionKey,
} from "@/db/schema";

// Re-export so callers don't need a second import path.
export { ADMIN_PERMISSION_KEYS, type AdminPermissionKey };

// Maps each permission to the admin path prefixes it grants. A path is
// the segment AFTER /[locale]/admin/ — e.g. "bets", "bets/new", "live-bets/suggestions".
// Sub-paths under each prefix are also granted (e.g. "bets/new" is
// covered by "bets"). The bare "" path (the admin landing page) is
// granted to anyone with at least one permission.
//
// New permissions: add a key here AND to ADMIN_PERMISSION_KEYS in
// src/db/schema.ts. Forgetting one half is a type error.
export const PERMISSION_PATHS: Record<AdminPermissionKey, readonly string[]> = {
  liveBets: ["bets", "bets-overview", "live-bets", "deadlines"],
  tournamentBets: ["tournament-suggestions"],
  tournamentOdds: ["tournament-odds"],
};

// User-facing labels for the checkbox list. Kept here (next to the
// schema) so adding a permission is a one-place change.
export const PERMISSION_LABELS: Record<
  AdminPermissionKey,
  { he: string; en: string; help: { he: string; en: string } }
> = {
  liveBets: {
    he: "הימורי לייב",
    en: "Live bets",
    help: {
      he: "יצירה, עריכה, ניקוד וביטול של הימורי לייב; הצעות יום משחקים; מצב הימורי כולם; הגדרת מועדי סגירה.",
      en: "Author, edit, grade, cancel live bets; matchday suggestions; everyone's bets; lock deadlines.",
    },
  },
  tournamentBets: {
    he: "הימורי טורניר",
    en: "Tournament bets",
    help: {
      he: "יצירה ועריכה של הימורי שלב/בית/טורניר (לא לייב).",
      en: "Author and edit stage / group / tournament bets (non-live).",
    },
  },
  tournamentOdds: {
    he: "יחסי טורניר / outright",
    en: "Tournament odds / outright",
    help: {
      he: "קביעת יחסים לזוכי הטורניר, נבחרות, מסיימת במקום 1–3 ועוד.",
      en: "Set odds for tournament winners, finalists, podium finishers, etc.",
    },
  },
};

export type AdminPermissions = Partial<Record<AdminPermissionKey, boolean>>;

export function hasAnyPermission(p: AdminPermissions): boolean {
  return ADMIN_PERMISSION_KEYS.some((k) => p[k] === true);
}

// Returns the set of granted path prefixes for a permission set, plus
// the bare "" path if any permission is present. The order of the
// result is not stable — callers should treat it as a set.
export function grantedPathsFor(p: AdminPermissions): readonly string[] {
  const out: string[] = [];
  if (hasAnyPermission(p)) out.push("");
  for (const k of ADMIN_PERMISSION_KEYS) {
    if (p[k]) out.push(...PERMISSION_PATHS[k]);
  }
  return out;
}

// True if `pathAfterAdmin` (no leading slash) is reachable with the
// given permission set. Sub-paths under a granted prefix are reachable.
// A "betsx" path with no slash is NOT reachable through "bets" — we
// match on whole-segment boundaries to be fail-closed.
export function isPermittedPath(
  p: AdminPermissions,
  pathAfterAdmin: string,
): boolean {
  if (!hasAnyPermission(p)) return false;
  if (pathAfterAdmin === "") return true;
  const granted = grantedPathsFor(p);
  return granted.some((g) => {
    if (g === "") return false;
    return pathAfterAdmin === g || pathAfterAdmin.startsWith(`${g}/`);
  });
}

// Validate that an unknown permissions object stored on profiles is
// well-formed. Used both at write time (admin updates a user) and as a
// runtime guard when reading (a hand-edited row can still parse cleanly
// even if it has stray keys; we just drop the strays).
export function normalizePermissions(raw: unknown): AdminPermissions {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const src = raw as Record<string, unknown>;
  const out: AdminPermissions = {};
  for (const k of ADMIN_PERMISSION_KEYS) {
    if (src[k] === true) out[k] = true;
  }
  return out;
}
