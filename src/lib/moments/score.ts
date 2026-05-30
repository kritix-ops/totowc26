import type { Moment } from "./types";

// Pure scoring helpers + the diversity-aware top-N selector. Kept
// dependency-free so the unit tests don't have to mock a DB.
//
// See _plans/2026-05-30-smart-reminders.md §3.2.

// Boost a critical-urgency moment as the lock window tightens. The
// numbers below are the only place "what counts as imminent" is
// quantified - tweak here, not in generators.
export function urgencyBoost(minutesToLock: number | null): number {
  if (minutesToLock === null) return 0;
  if (minutesToLock <= 60) return 20;
  if (minutesToLock <= 240) return 10;
  return 0;
}

// Personal-impact boost for catch-up moments when the user is in the
// bottom half of the table. Caller passes already-evaluated booleans
// so generators don't all repeat the rank lookup.
export function catchUpBoost(isBottomHalf: boolean, isCatchUpType: boolean): number {
  return isBottomHalf && isCatchUpType ? 10 : 0;
}

// Diversity penalty applied while we walk the sorted list. After a
// type is selected, subsequent moments of the same type get a fixed
// penalty so the Hub mixes shapes instead of stacking three
// unpicked-match rows.
const DIVERSITY_PENALTY = 15;

// Pick the top N moments after applying diversity penalties as we go.
// Stable order: highest adjusted score first; ties broken by original
// insertion order to keep the result deterministic across renders.
export function rankAndPick(candidates: Moment[], limit: number): Moment[] {
  if (candidates.length === 0 || limit <= 0) return [];

  // Preserve insertion order for tie-breaks via an index sidecar.
  const indexed = candidates.map((m, i) => ({ m, i }));
  const picked: Moment[] = [];
  const seenTypes = new Map<string, number>();

  while (picked.length < limit && indexed.length > 0) {
    // Recompute the adjusted score for each remaining candidate based
    // on how many of its type we have already picked. This is O(N×k)
    // for N candidates and k picked - trivial at the catalog sizes
    // we target (≤ 12).
    let bestIdx = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < indexed.length; i += 1) {
      const { m } = indexed[i];
      const usedCount = seenTypes.get(m.type) ?? 0;
      const adjusted = m.score - usedCount * DIVERSITY_PENALTY;
      if (
        adjusted > bestScore ||
        (adjusted === bestScore &&
          bestIdx !== -1 &&
          indexed[i].i < indexed[bestIdx].i)
      ) {
        bestScore = adjusted;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) break;
    const chosen = indexed.splice(bestIdx, 1)[0]!.m;
    picked.push(chosen);
    seenTypes.set(chosen.type, (seenTypes.get(chosen.type) ?? 0) + 1);
  }
  return picked;
}
