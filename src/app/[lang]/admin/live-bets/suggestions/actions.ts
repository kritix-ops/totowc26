"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { customBets, matches as matchesTable, matchdays } from "@/db/schema";
import { getUser } from "@/lib/supabase/auth";
import { isAdmin } from "@/lib/admin";

// Server actions for the admin "Live bet suggestions" page.
//
// Two action surfaces:
//   1) publishSuggestion - turn one bookmaker market+selection into an
//      open custom_bets row. We publish straight to status='open' so the
//      bet appears on /play/[date] without a separate "publish" step.
//      Grading source is 'manual' for v1 - the admin grades the bet
//      after the match via the existing /admin/bets/[id]/grade flow.
//      Auto-grading for binary markets (BTTS, Over/Under N goals) can
//      land in a follow-up PR by extending sync.ts.
//   2) refreshOddsForFixture - bust the cached fetch in src/lib/odds.ts
//      for one fixture so the next page render pulls fresh odds.

type Err =
  | "unauth"
  | "forbidden"
  | "match_not_found"
  | "match_locked"
  | "invalid_input"
  | "db";

export type PublishSuggestionInput = {
  matchId: string;
  // Identifier for the market+selection, used in the question text.
  marketName: string;
  selectionLabel: string;
  // The decimal odds we showed the admin - kept for audit if we later
  // want to graph how published payouts diverged from book odds.
  decimalOdds: number;
  // The stake / payout the admin saw on the row. The server re-asserts
  // they are sane (positive integers, payout > stake) before insert.
  stake: number;
  payout: number;
  // Hebrew + English versions of the same question, supplied by the
  // page so the admin can lightly edit them inline before publishing.
  questionHe: string;
  questionEn: string;
  // Grading rule - same dual-locale requirement as custom_bets.
  gradingRuleHe: string;
  gradingRuleEn: string;
};

export type PublishSuggestionResult =
  | { ok: true; id: string }
  | { ok: false; error: Err };

export async function publishSuggestion(
  input: PublishSuggestionInput,
): Promise<PublishSuggestionResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauth" };
  if (!(await isAdmin(user.id))) {
    console.warn("[live-bet publish denied]", { userId: user.id });
    return { ok: false, error: "forbidden" };
  }

  if (
    !Number.isInteger(input.stake) ||
    !Number.isInteger(input.payout) ||
    input.stake < 0 ||
    input.payout <= input.stake ||
    input.questionHe.trim().length === 0 ||
    input.questionEn.trim().length === 0 ||
    input.gradingRuleHe.trim().length < 3 ||
    input.gradingRuleEn.trim().length < 3
  ) {
    return { ok: false, error: "invalid_input" };
  }

  const [m] = await db
    .select({
      id: matchesTable.id,
      kickoffAt: matchesTable.kickoffAt,
      status: matchesTable.status,
    })
    .from(matchesTable)
    .where(eq(matchesTable.id, input.matchId))
    .limit(1);
  if (!m) return { ok: false, error: "match_not_found" };
  if (m.status !== "scheduled") {
    return { ok: false, error: "match_locked" };
  }

  // Lock 5 minutes before kickoff. Mirrors the existing /bets/[matchId]
  // gate in src/app/[lang]/bets/[matchId]/actions.ts.
  const lockAt = new Date(m.kickoffAt.getTime() - 5 * 60_000);
  if (lockAt.getTime() <= Date.now()) {
    return { ok: false, error: "match_locked" };
  }

  // Resolve the matchday FK (custom_bets needs it for match-scope rows).
  const matchdayId = await upsertMatchdayFromKickoff(m.kickoffAt);

  try {
    const [row] = await db
      .insert(customBets)
      .values({
        scope: "match",
        matchId: input.matchId,
        matchdayId,
        questionHe: input.questionHe.trim(),
        questionEn: input.questionEn.trim(),
        gradingRuleHe: input.gradingRuleHe.trim(),
        gradingRuleEn: input.gradingRuleEn.trim(),
        answerType: "yes_no",
        answerConfig: { kind: "yes_no" },
        stakeSnapshot: input.stake,
        payoutSnapshot: input.payout,
        gradingSource: "manual",
        gradingConfig: null,
        status: "open",
        lockAt,
        publishedAt: new Date(),
        createdBy: user.id,
      })
      .returning({ id: customBets.id });

    console.info("[live-bet publish]", {
      adminId: user.id,
      customBetId: row.id,
      matchId: input.matchId,
      marketName: input.marketName,
      selectionLabel: input.selectionLabel,
      decimalOdds: input.decimalOdds,
      stake: input.stake,
      payout: input.payout,
    });
    revalidatePath(
      "/[lang]/admin/live-bets/suggestions",
      "page",
    );
    revalidatePath("/[lang]/play/[date]", "page");
    return { ok: true, id: row.id };
  } catch (err) {
    console.error("[live-bet publish] insert failed:", err);
    return { ok: false, error: "db" };
  }
}

// Force the page to refetch odds for one fixture. The /odds wrapper
// caches for 60s via next.revalidate; revalidatePath busts the whole
// route's fetch cache. matchId is logged for observability but not
// currently used to scope the invalidation - a future revalidateTag
// hook can tighten this when we tag the fetches per fixture.
export async function refreshOddsForFixture(
  matchId: string,
): Promise<{ ok: true } | { ok: false; error: Err }> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauth" };
  if (!(await isAdmin(user.id))) {
    return { ok: false, error: "forbidden" };
  }
  console.info("[odds refresh]", { adminId: user.id, matchId });
  revalidatePath("/[lang]/admin/live-bets/suggestions", "page");
  return { ok: true };
}

// Upsert the matchday row for a given kickoff. Same logic as the
// existing admin/bets/actions.ts helper of the same name, lifted here
// so this file can stay independent.
async function upsertMatchdayFromKickoff(kickoffAt: Date): Promise<string> {
  // Derive the Asia/Jerusalem calendar date from the UTC kickoff.
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(kickoffAt);

  const [existing] = await db
    .select({ id: matchdays.id })
    .from(matchdays)
    .where(eq(matchdays.date, date))
    .limit(1);
  if (existing) return existing.id;

  const [created] = await db
    .insert(matchdays)
    .values({ date })
    .returning({ id: matchdays.id });
  return created.id;
}
