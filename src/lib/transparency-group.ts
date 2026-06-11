// Pure post-SQL transforms for /transparency.
//
// The DB layer in src/db/queries.ts (getTransparencyByQuestion) hands
// us a flat picker-row list. Everything that happens between that flat
// list and the page rendering — grouping by question, computing
// non-bettors against the paid pool, scoping to a single user filter,
// truncating to a limit — is pure data manipulation, so it lives here
// and gets covered by unit tests. The DB function calls these helpers
// after its query returns.

// The five bet surfaces a /transparency tab can show. Defined here (the
// server-neutral lib) rather than in the server-only db/queries module
// so client components — the tab list and search — can import the type
// without pulling a `server-only` guard into the client bundle.
export type TransparencyCategory =
  | "match"
  | "live"
  | "tournament"
  | "group"
  | "duel";

export type TransparencyPicker = {
  userId: string;
  displayName: string;
  pickLabel: string;
  stake: number;
  pointsEarned: number | null;
  status: string;
};

export type TransparencyQuestionRow = {
  questionId: string;
  question: string;
  eventTime: string;
  pickers: TransparencyPicker[];
  nonBettors: Array<{ userId: string; displayName: string }>;
};

export type TransparencyPickerRow = TransparencyPicker & {
  questionId: string;
  question: string;
  eventTime: string;
};

// Fold a flat picker-row list into one row per question. Insertion
// order is preserved, so the caller should sort the SQL output in the
// desired display order (we use reverse-chronological by event time).
export function groupPickerRows(
  rows: ReadonlyArray<TransparencyPickerRow>,
): TransparencyQuestionRow[] {
  const byQuestion = new Map<string, TransparencyQuestionRow>();
  for (const r of rows) {
    let row = byQuestion.get(r.questionId);
    if (!row) {
      row = {
        questionId: r.questionId,
        question: r.question,
        eventTime: r.eventTime,
        pickers: [],
        nonBettors: [],
      };
      byQuestion.set(r.questionId, row);
    }
    row.pickers.push({
      userId: r.userId,
      displayName: r.displayName,
      pickLabel: r.pickLabel,
      stake: r.stake,
      pointsEarned: r.pointsEarned,
      status: r.status,
    });
  }
  return Array.from(byQuestion.values());
}

// For each question, attach the set of paid-pool users who did not bet
// on it. Mutates each row in place and returns the array for chaining.
// Duel rows should not pass through this — duels are 1v1 by design and
// "didn't bet" is meaningless there.
export function attachNonBettors(
  rows: TransparencyQuestionRow[],
  paidPool: ReadonlyArray<{ userId: string; displayName: string }>,
): TransparencyQuestionRow[] {
  for (const row of rows) {
    const pickerIds = new Set(row.pickers.map((pk) => pk.userId));
    row.nonBettors = paidPool
      .filter((u) => !pickerIds.has(u.userId))
      .map((u) => ({ userId: u.userId, displayName: u.displayName }));
  }
  return rows;
}

// Scope the result to a single user: drop questions where that user
// did not bet, and inside the kept questions show only their pick.
// nonBettors is cleared because the absence list is not meaningful
// once we are looking at one specific player.
export function filterToUser(
  rows: ReadonlyArray<TransparencyQuestionRow>,
  userId: string,
): TransparencyQuestionRow[] {
  return rows
    .filter((row) => row.pickers.some((pk) => pk.userId === userId))
    .map((row) => ({
      ...row,
      pickers: row.pickers.filter((pk) => pk.userId === userId),
      nonBettors: [],
    }));
}

// Free-text search used by the per-tab search box (TransparencyList).
// Two intents share one query, resolved per row:
//   * the query matches the QUESTION text  -> keep the whole card, every
//     picker (e.g. searching a team/match name).
//   * otherwise it matches PICKER names    -> keep the card but only the
//     matching people's rows, and drop nonBettors (the "didn't bet" list
//     is a pool-wide answer that does not apply once narrowed to a name).
// Case-insensitive substring; an empty/whitespace query returns the rows
// unchanged. Rows that match neither the question nor any picker are
// dropped entirely.
export function filterRowsByQuery(
  rows: ReadonlyArray<TransparencyQuestionRow>,
  query: string,
): TransparencyQuestionRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows as TransparencyQuestionRow[];
  const out: TransparencyQuestionRow[] = [];
  for (const row of rows) {
    if (row.question.toLowerCase().includes(q)) {
      out.push(row);
      continue;
    }
    const pickers = row.pickers.filter((pk) =>
      pk.displayName.toLowerCase().includes(q),
    );
    if (pickers.length > 0) {
      out.push({ ...row, pickers, nonBettors: [] });
    }
  }
  return out;
}
