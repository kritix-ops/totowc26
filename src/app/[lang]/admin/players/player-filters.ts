// Pure filter logic for /admin/players, shared by the board, the
// filter bar, and the count computation. No React, no DOM access —
// keeps the surface unit-testable and lets the board's useMemo
// recompute counts in a single pass.

import type { AdminPlayerReviewRow } from "@/db/admin-queries";

export type PlayerVerdictKey =
  | "all"
  | "reject"
  | "flag"
  | "unreviewed"
  | "approved";

export type PlayerLockKey = "any" | "locked" | "unlocked";

// Source / position get an "any" sentinel for "filter inactive" and
// fall back to "none" when the admin specifically wants rows with a
// NULL value. Position is rarely null in practice but kept defensive.
export type PlayerSourceKey =
  | "any"
  | "wikidata"
  | "llm_claude"
  | "llm_reviewer"
  | "manual"
  | "none";

export type PlayerPositionKey =
  | "any"
  | "goalkeeper"
  | "defender"
  | "midfielder"
  | "attacker"
  | "none";

export type PlayerFilters = {
  search: string;          // free-text, case-insensitive
  verdict: PlayerVerdictKey;
  team: string | null;     // team_code (3-letter ISO) or null = any
  source: PlayerSourceKey;
  position: PlayerPositionKey;
  lock: PlayerLockKey;
};

export const EMPTY_FILTERS: PlayerFilters = {
  search: "",
  verdict: "all",
  team: null,
  source: "any",
  position: "any",
  lock: "any",
};

// True when at least one dimension is restricting the view. Used by
// the board to decide whether to render the "Clear all" button.
export function hasAnyFilter(f: PlayerFilters): boolean {
  return (
    f.search.trim() !== "" ||
    f.verdict !== "all" ||
    f.team !== null ||
    f.source !== "any" ||
    f.position !== "any" ||
    f.lock !== "any"
  );
}

// Per-dimension predicates. Kept separate so the count computation
// can call them à-la-carte ("apply every filter EXCEPT verdict").
function passesSearch(row: AdminPlayerReviewRow, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  if (row.nameEn.toLowerCase().includes(needle)) return true;
  if (row.nameHe?.toLowerCase().includes(needle)) return true;
  if (row.teamNameEn.toLowerCase().includes(needle)) return true;
  if (row.teamNameHe.toLowerCase().includes(needle)) return true;
  if (row.teamCode.toLowerCase().includes(needle)) return true;
  if (row.position?.toLowerCase().includes(needle)) return true;
  if (String(row.apiFootballId).includes(needle)) return true;
  if (row.jerseyNumber != null && String(row.jerseyNumber).includes(needle)) return true;
  return false;
}

function passesVerdict(row: AdminPlayerReviewRow, v: PlayerVerdictKey): boolean {
  if (v === "all") return true;
  if (v === "unreviewed") return row.nameHeReviewVerdict === null;
  return row.nameHeReviewVerdict === v;
}

function passesTeam(row: AdminPlayerReviewRow, t: string | null): boolean {
  if (t === null) return true;
  return row.teamCode === t;
}

function passesSource(row: AdminPlayerReviewRow, s: PlayerSourceKey): boolean {
  if (s === "any") return true;
  if (s === "none") return row.nameHeSource === null;
  return row.nameHeSource === s;
}

function passesPosition(row: AdminPlayerReviewRow, p: PlayerPositionKey): boolean {
  if (p === "any") return true;
  if (p === "none") return row.position === null;
  // API returns canonical strings like "Goalkeeper" / "Attacker".
  return row.position?.toLowerCase() === p;
}

function passesLock(row: AdminPlayerReviewRow, l: PlayerLockKey): boolean {
  if (l === "any") return true;
  if (l === "locked") return row.nameHeAdminLocked === true;
  return row.nameHeAdminLocked === false;
}

// Full predicate — every dimension active. Used to compute the
// filtered row list the board renders.
export function matchesPlayerFilters(
  row: AdminPlayerReviewRow,
  f: PlayerFilters,
): boolean {
  return (
    passesSearch(row, f.search) &&
    passesVerdict(row, f.verdict) &&
    passesTeam(row, f.team) &&
    passesSource(row, f.source) &&
    passesPosition(row, f.position) &&
    passesLock(row, f.lock)
  );
}

// Predicate with one dimension skipped. Lets us compute per-bucket
// counts that respect every OTHER active filter (faceted counts).
function matchesExcept(
  row: AdminPlayerReviewRow,
  f: PlayerFilters,
  skip:
    | "search"
    | "verdict"
    | "team"
    | "source"
    | "position"
    | "lock",
): boolean {
  if (skip !== "search"   && !passesSearch(row, f.search))     return false;
  if (skip !== "verdict"  && !passesVerdict(row, f.verdict))   return false;
  if (skip !== "team"     && !passesTeam(row, f.team))         return false;
  if (skip !== "source"   && !passesSource(row, f.source))     return false;
  if (skip !== "position" && !passesPosition(row, f.position)) return false;
  if (skip !== "lock"     && !passesLock(row, f.lock))         return false;
  return true;
}

// Faceted counts. For each filter dimension, returns the count of
// matching rows broken down by that dimension's possible values,
// against the OTHER active filters. So if verdict=reject is on, the
// "team" counts show how many rejects each team has — not the
// global team breakdown.
export type FilterCounts = {
  verdict: Record<PlayerVerdictKey, number>;
  team:    Map<string, number>;        // team_code -> count
  source:  Record<PlayerSourceKey, number>;
  position: Record<PlayerPositionKey, number>;
  lock:    Record<PlayerLockKey, number>;
};

export function filterCounts(
  rows: AdminPlayerReviewRow[],
  f: PlayerFilters,
): FilterCounts {
  const out: FilterCounts = {
    verdict:  { all: 0, reject: 0, flag: 0, unreviewed: 0, approved: 0 },
    team:     new Map<string, number>(),
    source:   { any: 0, wikidata: 0, llm_claude: 0, llm_reviewer: 0, manual: 0, none: 0 },
    position: { any: 0, goalkeeper: 0, defender: 0, midfielder: 0, attacker: 0, none: 0 },
    lock:     { any: 0, locked: 0, unlocked: 0 },
  };

  for (const row of rows) {
    if (matchesExcept(row, f, "verdict")) {
      out.verdict.all += 1;
      const v = row.nameHeReviewVerdict;
      if (v === "reject")        out.verdict.reject += 1;
      else if (v === "flag")     out.verdict.flag += 1;
      else if (v === "approved") out.verdict.approved += 1;
      else                       out.verdict.unreviewed += 1;
    }
    if (matchesExcept(row, f, "team")) {
      out.team.set(row.teamCode, (out.team.get(row.teamCode) ?? 0) + 1);
    }
    if (matchesExcept(row, f, "source")) {
      out.source.any += 1;
      const s = row.nameHeSource;
      if (s === "wikidata")          out.source.wikidata += 1;
      else if (s === "llm_claude")   out.source.llm_claude += 1;
      else if (s === "llm_reviewer") out.source.llm_reviewer += 1;
      else if (s === "manual")       out.source.manual += 1;
      else                           out.source.none += 1;
    }
    if (matchesExcept(row, f, "position")) {
      out.position.any += 1;
      const p = row.position?.toLowerCase() ?? null;
      if      (p === "goalkeeper")  out.position.goalkeeper += 1;
      else if (p === "defender")    out.position.defender += 1;
      else if (p === "midfielder")  out.position.midfielder += 1;
      else if (p === "attacker")    out.position.attacker += 1;
      else                          out.position.none += 1;
    }
    if (matchesExcept(row, f, "lock")) {
      out.lock.any += 1;
      if (row.nameHeAdminLocked) out.lock.locked += 1;
      else                       out.lock.unlocked += 1;
    }
  }
  return out;
}
