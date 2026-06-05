// Pure tiebreaker for auto-grading group-winner bets ("מי תנצח בקבוצה X?").
// Lifted into its own file so it can be unit-tested without a DB
// connection. The DB read lives in resolveGroupScope() in sync.ts.
//
// Tiebreaker order matches what the live tables on /tournament show:
//   1. points
//   2. goal difference
//   3. goals for
//
// FIFA's full ladder adds head-to-head and fair-play points after that,
// but those are rare in practice and need data we may not have. Rather
// than guess wrong, this resolver returns null when the top two teams
// are tied across all three numeric tiebreakers, and the bet then stays
// in the manual queue for the admin to grade.

export type GroupStandingRow = {
  code: string;
  played: number;
  points: number;
  goalDiff: number;
  goalsFor: number;
};

export type GroupWinnerOutcome =
  | { kind: "winner"; code: string }
  | { kind: "not_ready"; reason: "matches_incomplete" }
  | {
      kind: "ambiguous";
      tied: Array<Pick<GroupStandingRow, "code" | "points" | "goalDiff" | "goalsFor">>;
    };

// All 6 group-stage matches must be final for the bet to be resolvable.
// Each of the 4 teams plays 3 matches, so the sum of `played` is 12.
const EXPECTED_TOTAL_PLAYED = 12;

export function pickGroupWinner(rows: GroupStandingRow[]): GroupWinnerOutcome {
  if (rows.length === 0) {
    return { kind: "not_ready", reason: "matches_incomplete" };
  }

  const totalPlayed = rows.reduce((s, r) => s + r.played, 0);
  if (totalPlayed < EXPECTED_TOTAL_PLAYED) {
    return { kind: "not_ready", reason: "matches_incomplete" };
  }

  const sorted = [...rows].sort((a, b) => {
    if (b.points !== a.points)     return b.points - a.points;
    if (b.goalDiff !== a.goalDiff) return b.goalDiff - a.goalDiff;
    if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
    return a.code.localeCompare(b.code);
  });

  const leader = sorted[0];
  const runnerUp = sorted[1];

  if (
    runnerUp &&
    runnerUp.points === leader.points &&
    runnerUp.goalDiff === leader.goalDiff &&
    runnerUp.goalsFor === leader.goalsFor
  ) {
    return {
      kind: "ambiguous",
      tied: sorted
        .filter(
          (r) =>
            r.points === leader.points &&
            r.goalDiff === leader.goalDiff &&
            r.goalsFor === leader.goalsFor,
        )
        .map((r) => ({
          code: r.code,
          points: r.points,
          goalDiff: r.goalDiff,
          goalsFor: r.goalsFor,
        })),
    };
  }

  return { kind: "winner", code: leader.code };
}
