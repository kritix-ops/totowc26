// Pure data + helpers for the live-bets admin whitelist. Kept separate
// from src/lib/admin.ts so unit tests can import without dragging in
// the Supabase client (which throws when env vars are absent in the
// test runner). See _plans/2026-06-12-live-bets-admin-role.md.

// Path prefixes a `live_bets_admin` is allowed to visit under /admin.
// The admin layout uses this list to bounce them away from any other
// admin page. New admin pages added later are blocked by default —
// fail-closed.
//
// The leading "" entry represents the bare /[lang]/admin landing page
// itself; that page renders a filtered tile set for the scoped role.
export const LIVE_BETS_ADMIN_PATHS = [
  "",
  "bets",
  "bets-overview",
  "live-bets",
  "deadlines",
] as const;

export function isLiveBetsAdminPath(pathAfterAdmin: string): boolean {
  if (pathAfterAdmin === "") return true;
  return LIVE_BETS_ADMIN_PATHS.some((p) => {
    if (p === "") return false;
    return pathAfterAdmin === p || pathAfterAdmin.startsWith(`${p}/`);
  });
}
