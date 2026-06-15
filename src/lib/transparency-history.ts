// Pure types + reducers for the per-user betting-history view on
// /transparency (the "Player history" mode added in
// _plans/2026-06-15-per-user-bet-history.md).
//
// The SQL lives in src/db/queries.ts (getUserBetHistory /
// getUserHeadToHead). Everything that turns those raw, already
// lock-filtered rows into a summary or a head-to-head comparison is pure
// data manipulation, so it lives here and is covered by unit tests.
// Mirrors the split already used by transparency-group.ts.
//
// Net semantics are normalised in SQL so this layer never has to know
// per-type accounting: every row carries one signed `net` (null while
// pending) and one `isPending` flag. A row is "won" when net > 0, "lost"
// when net < 0, and a "push" when a settled bet nets exactly 0.

import type { TransparencyCategory } from "./transparency-group";

// History reuses the same five surfaces the transparency feed already
// understands, so the category type is shared rather than re-declared.
export type UserHistoryCategory = TransparencyCategory;

export const HISTORY_CATEGORIES: UserHistoryCategory[] = [
  "match",
  "live",
  "tournament",
  "group",
  "duel",
];

export type UserHistoryRow = {
  category: UserHistoryCategory;
  // match_id / custom_bet_id / duel_id. Unique per category, used both as
  // the React key and to intersect two players' rows in head-to-head.
  refId: string;
  question: string; // localised
  // Secondary context line: "BRA vs GER" for a match-scoped bet, the
  // opponent name for a duel, otherwise null.
  contextLabel: string | null;
  // Canonical chronological anchor (ISO string). The SQL picks the right
  // timestamp per surface so the merged timeline orders correctly.
  sortTs: string;
  pickLabel: string; // what this user picked, localised
  resultLabel: string | null; // actual outcome once known; null while pending
  stake: number; // points put at risk
  net: number | null; // signed net points; null while pending
  isPending: boolean;
  // Duels only — lets head-to-head isolate the two players' shared duels.
  opponentId: string | null;
  opponentName: string | null;
  // True for a point-adjustment row (manual credit/debit, e.g. the opener
  // live-bet refund). These render as their own timeline card and are
  // deliberately excluded from every betting tally in summarizeHistory —
  // a correction is not a bet. `category` carries a filler value only to
  // satisfy the type; it is never read for adjustment rows.
  isAdjustment?: boolean;
};

export type CategoryTotals = { net: number; count: number };

export type UserHistorySummary = {
  totalBets: number;
  settledCount: number;
  pendingCount: number;
  wins: number;
  losses: number;
  pushes: number;
  totalStaked: number;
  totalWon: number; // sum of positive nets
  totalLost: number; // magnitude (positive number) of negative nets
  net: number; // totalWon - totalLost
  byCategory: Record<UserHistoryCategory, CategoryTotals>;
};

function emptyByCategory(): Record<UserHistoryCategory, CategoryTotals> {
  return {
    match: { net: 0, count: 0 },
    live: { net: 0, count: 0 },
    tournament: { net: 0, count: 0 },
    group: { net: 0, count: 0 },
    duel: { net: 0, count: 0 },
  };
}

// Fold a player's history rows into the headline summary. Pending rows
// count toward totalBets / pendingCount / totalStaked (the stake is
// already at risk) but never toward win/loss/net, so the summary always
// reconciles with the settled rows the timeline shows: net === totalWon -
// totalLost. Adjustment rows are skipped entirely (a correction is not a
// bet); they live only in the timeline, so the bet invariant is preserved.
export function summarizeHistory(
  rows: ReadonlyArray<UserHistoryRow>,
): UserHistorySummary {
  const byCategory = emptyByCategory();
  let totalBets = 0;
  let settledCount = 0;
  let pendingCount = 0;
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let totalStaked = 0;
  let totalWon = 0;
  let totalLost = 0;

  for (const r of rows) {
    if (r.isAdjustment) continue;
    totalBets += 1;
    byCategory[r.category].count += 1;
    totalStaked += r.stake;
    if (r.isPending) {
      pendingCount += 1;
      continue;
    }
    settledCount += 1;
    const n = r.net ?? 0;
    byCategory[r.category].net += n;
    if (n > 0) {
      wins += 1;
      totalWon += n;
    } else if (n < 0) {
      losses += 1;
      totalLost += -n;
    } else {
      pushes += 1;
    }
  }

  return {
    totalBets,
    settledCount,
    pendingCount,
    wins,
    losses,
    pushes,
    totalStaked,
    totalWon,
    totalLost,
    net: totalWon - totalLost,
    byCategory,
  };
}

// Split a player's rows into the two display buckets the UI renders:
// pending first (awaiting result), then settled newest-first. Both keep
// the SQL's reverse-chronological order. Duels with no joiner yet are
// pending like any other unresolved bet.
export function splitPendingSettled(rows: ReadonlyArray<UserHistoryRow>): {
  pending: UserHistoryRow[];
  settled: UserHistoryRow[];
} {
  const pending: UserHistoryRow[] = [];
  const settled: UserHistoryRow[] = [];
  for (const r of rows) (r.isPending ? pending : settled).push(r);
  return { pending, settled };
}

// ---------- Head-to-head ----------

export type SharedQuestionWinner = "a" | "b" | "tie" | null;

export type SharedQuestion = {
  category: UserHistoryCategory;
  refId: string;
  question: string;
  contextLabel: string | null;
  sortTs: string;
  aPick: string;
  aNet: number | null;
  aPending: boolean;
  bPick: string;
  bNet: number | null;
  bPending: boolean;
  // null when either side is still pending (no fair comparison yet).
  winner: SharedQuestionWinner;
};

export type DuelRecord = { aWins: number; bWins: number; total: number };

// Questions both players bet on (same match score pick or same custom
// bet). Duels are excluded here — they are a direct contest tallied
// separately by computeDuelRecord. Returned newest-first.
export function computeSharedQuestions(
  aRows: ReadonlyArray<UserHistoryRow>,
  bRows: ReadonlyArray<UserHistoryRow>,
): SharedQuestion[] {
  const key = (r: UserHistoryRow) => `${r.category}|${r.refId}`;
  const bByKey = new Map<string, UserHistoryRow>();
  for (const r of bRows) {
    if (r.category === "duel" || r.isAdjustment) continue;
    bByKey.set(key(r), r);
  }

  const out: SharedQuestion[] = [];
  for (const a of aRows) {
    if (a.category === "duel" || a.isAdjustment) continue;
    const b = bByKey.get(key(a));
    if (!b) continue;
    const bothSettled = !a.isPending && !b.isPending;
    let winner: SharedQuestionWinner = null;
    if (bothSettled) {
      const an = a.net ?? 0;
      const bn = b.net ?? 0;
      winner = an > bn ? "a" : bn > an ? "b" : "tie";
    }
    out.push({
      category: a.category,
      refId: a.refId,
      question: a.question,
      contextLabel: a.contextLabel,
      sortTs: a.sortTs,
      aPick: a.pickLabel,
      aNet: a.net,
      aPending: a.isPending,
      bPick: b.pickLabel,
      bNet: b.net,
      bPending: b.isPending,
      winner,
    });
  }
  out.sort((x, y) => (x.sortTs < y.sortTs ? 1 : x.sortTs > y.sortTs ? -1 : 0));
  return out;
}

// Tally settled duels fought directly between the two players, read from
// player A's rows (each duel row carries the opponent id and A's signed
// net, so A wins when net > 0).
export function computeDuelRecord(
  aRows: ReadonlyArray<UserHistoryRow>,
  bId: string,
): DuelRecord {
  let aWins = 0;
  let bWins = 0;
  let total = 0;
  for (const r of aRows) {
    if (r.category !== "duel" || r.opponentId !== bId || r.isPending) continue;
    total += 1;
    const n = r.net ?? 0;
    if (n > 0) aWins += 1;
    else if (n < 0) bWins += 1;
  }
  return { aWins, bWins, total };
}
