import "server-only";

import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { matchBets, matches, settings, teams } from "@/db/schema";
import { notifyUsers } from "@/lib/notifications";
import {
  gradeCanceledGuess,
  type CancelResolution,
  type CancelResolutionConfig,
} from "./cancel";

// Settle the 1/X/2 guesses on a single canceled match according to the
// admin-chosen resolution. Sister to scoreFinalMatches() in sync.ts, sharing
// its idempotency contract: only ungraded picks (points_earned IS NULL) are
// touched, so re-running — whether from the resolve action or the next sync
// sweep — never rewrites history. A no-op unless the match is actually
// canceled AND a resolution has been chosen (a pending cancel scores nothing).
//
// Returns how many guesses were graded so the caller can log/report it.
export async function scoreCanceledMatch(matchId: string): Promise<number> {
  const [m] = await db
    .select({
      status: matches.status,
      resolution: matches.cancelResolution,
      config: matches.cancelResolutionConfig,
      homeTeam: matches.homeTeam,
      awayTeam: matches.awayTeam,
    })
    .from(matches)
    .where(eq(matches.id, matchId))
    .limit(1);

  if (!m) return 0;
  // Pending cancel (no resolution yet) or any non-canceled status: no scoring.
  if (m.status !== "canceled" || m.resolution === null) return 0;

  const resolution = m.resolution as CancelResolution;
  const config = m.config as CancelResolutionConfig;

  const [s] = await db
    .select({
      scoringExact: settings.scoringExact,
      scoringOutcome: settings.scoringOutcome,
    })
    .from(settings)
    .where(eq(settings.id, 1));
  if (!s) return 0;

  const bets = await db
    .select({
      id: matchBets.id,
      userId: matchBets.userId,
      homeScore: matchBets.homeScore,
      awayScore: matchBets.awayScore,
    })
    .from(matchBets)
    .where(and(eq(matchBets.matchId, matchId), isNull(matchBets.pointsEarned)));

  if (bets.length === 0) return 0;

  // Team names for the feed notice. One small lookup keyed by code rather
  // than a self-join with aliases.
  const teamRows = await db
    .select({ code: teams.code, nameHe: teams.nameHe })
    .from(teams)
    .where(inArray(teams.code, [m.homeTeam, m.awayTeam]));
  const nameByCode = new Map(teamRows.map((t) => [t.code, t.nameHe]));
  const homeName = nameByCode.get(m.homeTeam) ?? m.homeTeam;
  const awayName = nameByCode.get(m.awayTeam) ?? m.awayTeam;

  let scored = 0;
  for (const b of bets) {
    const grade = gradeCanceledGuess({
      resolution,
      config,
      guessHome: b.homeScore,
      guessAway: b.awayScore,
      scoringExact: s.scoringExact,
      scoringOutcome: s.scoringOutcome,
    });

    await db
      .update(matchBets)
      .set({
        pointsEarned: grade.points,
        wasExact: grade.wasExact,
        wasCorrectOutcome: grade.wasCorrectOutcome,
        locked: true,
      })
      .where(eq(matchBets.id, b.id));
    scored += 1;

    console.info("[score canceled]", {
      userId: b.userId,
      matchId,
      resolution,
      pointsEarned: grade.points,
      exact: grade.wasExact,
      direction: grade.wasCorrectOutcome,
    });

    // Feed-only notice (no push) per affected picker. Best-effort: a notify
    // failure is logged and swallowed, never rolling back the grade.
    try {
      const body = bodyForResolution({
        resolution,
        config,
        points: grade.points,
        guessHome: b.homeScore,
        guessAway: b.awayScore,
      });
      await notifyUsers(
        { kind: "user", userId: b.userId },
        {
          kind: "match_canceled",
          title: `${homeName} נגד ${awayName} — בוטל`,
          body,
          url: `/he/match/${matchId}`,
          push: false,
        },
      );
    } catch (err) {
      console.warn("[score canceled notify failed]", {
        userId: b.userId,
        matchId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return scored;
}

// Sweep every canceled+resolved match with ungraded guesses. Called from the
// sync orchestrator as a safety net so a resolve action interrupted mid-grade
// still completes on the next cron pass.
export async function scoreCanceledMatchesSweep(): Promise<{
  scoredMatches: number;
  scoredBets: number;
}> {
  const rows = await db
    .select({ id: matches.id })
    .from(matches)
    .where(
      and(
        eq(matches.status, "canceled"),
        isNotNull(matches.cancelResolution),
      ),
    );

  let scoredMatches = 0;
  let scoredBets = 0;
  for (const r of rows) {
    const n = await scoreCanceledMatch(r.id);
    if (n > 0) {
      scoredMatches += 1;
      scoredBets += n;
    }
  }
  return { scoredMatches, scoredBets };
}

function bodyForResolution(args: {
  resolution: CancelResolution;
  config: CancelResolutionConfig;
  points: number;
  guessHome: number;
  guessAway: number;
}): string {
  const { resolution, config, points, guessHome, guessAway } = args;
  const yourPick = `${guessHome}–${guessAway}`;

  if (resolution === "void") {
    return `המשחק בוטל. הניחוש שלך (${yourPick}) בוטל והנקודות לא הושפעו.`;
  }
  if (resolution === "split") {
    return `המשחק בוטל. כל המנחשים קיבלו ${points} נקודות.`;
  }
  // awarded
  const score = config && config.kind === "awarded" ? `${config.home}–${config.away}` : "";
  return points > 0
    ? `המשחק בוטל ונקבעה תוצאה טכנית (${score}). הניחוש שלך (${yourPick}) זיכה אותך ב-${points} נקודות.`
    : `המשחק בוטל ונקבעה תוצאה טכנית (${score}). הניחוש שלך (${yourPick}) לא תאם.`;
}
