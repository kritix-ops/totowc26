// Mirrors the bet_status pgEnum in src/db/schema.ts. Kept inline like the
// other call sites (GradeForm, admin-queries) since the project has no shared
// exported union for it.
type BetStatus =
  | "draft"
  | "open"
  | "locked"
  | "graded"
  | "reversed"
  | "cancelled";

// Why a reopen is blocked, or null when it is allowed.
export type ReopenBlock = "not_reopenable" | "no_time_left";

// Decide whether a live bet can be put back to 'open' so players can resume
// filling. Returns null when the reopen is allowed, otherwise the reason it is
// blocked. Pure + deterministic (`now` is injected), so the server action and
// the admin UI gate share one source of truth and the rule is unit-testable.
//
// Rules:
//   - Only a 'reversed' bet is reopenable. Every other status has its own
//     lifecycle move (draft → publish, open/locked are already fillable,
//     graded → reverse, cancelled is terminal). A blind flip to 'open' from
//     any of them would be a data-integrity bug, so we reject them here.
//   - There must be time left: lock_at strictly in the future. The fill
//     surfaces gate on `lock_at > now`, so reopening a bet whose lock has
//     passed cannot help — it would still be unfillable. This mirrors the
//     "as long as there's time" requirement.
export function reopenBlockedReason(
  status: BetStatus,
  lockAt: Date,
  now: Date,
): ReopenBlock | null {
  if (status !== "reversed") return "not_reopenable";
  if (lockAt.getTime() <= now.getTime()) return "no_time_left";
  return null;
}

// Convenience boolean for the UI: should the "Reopen for filling" control show?
export function canReopen(status: BetStatus, lockAt: Date, now: Date): boolean {
  return reopenBlockedReason(status, lockAt, now) === null;
}
