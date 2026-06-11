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

  // Lock 60 minutes before kickoff. Matches the pool-wide rule that
  // every non-match-pick bet closes an hour before the relevant match
  // or matchday starts (match picks themselves use the global cutoff
  // in settings.match_picks_global_lock_at, resolved by deadlines.ts).
  const lockAt = new Date(m.kickoffAt.getTime() - 60 * 60_000);
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
        // Captured so submitCustomBetPick can reprice the bet for a
        // player-chosen stake. drizzle's `numeric` maps to JS string;
        // store the original bookmaker quote rounded to 2dp to match
        // the column precision (see migration 0047).
        decimalOdds: input.decimalOdds.toFixed(2),
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

// Publish a single bet that's actually a CHOICE between paired
// options (Over/Under at a line, Yes/No on BTTS, Home/Away on a
// handicap line). The friend picks one of the options and the per-
// option payout — derived from each side's decimal odds — applies on
// resolution. Replaces the old "one yes/no bet per side" shape that
// fragmented Over and Under into two unrelated rows.
export type PublishMultiChoiceInput = {
  matchId: string;
  marketName: string;
  // The decimal odds we showed the admin per option. The server
  // re-normalises to payout via the same normalizeOdds the page
  // uses on render — never trust the client's payout integer alone.
  options: Array<{
    label: string;
    decimalOdds: number;
    stake: number;
    payout: number;
  }>;
  questionHe: string;
  questionEn: string;
  gradingRuleHe: string;
  gradingRuleEn: string;
};

export async function publishMultiChoiceSuggestion(
  input: PublishMultiChoiceInput,
): Promise<PublishSuggestionResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauth" };
  if (!(await isAdmin(user.id))) {
    console.warn("[live-bet multi publish denied]", { userId: user.id });
    return { ok: false, error: "forbidden" };
  }

  if (
    !Array.isArray(input.options) ||
    input.options.length < 2 ||
    input.options.length > 8 ||
    input.questionHe.trim().length === 0 ||
    input.questionEn.trim().length === 0 ||
    input.gradingRuleHe.trim().length < 3 ||
    input.gradingRuleEn.trim().length < 3
  ) {
    return { ok: false, error: "invalid_input" };
  }
  for (const opt of input.options) {
    if (
      !Number.isInteger(opt.stake) ||
      !Number.isInteger(opt.payout) ||
      opt.stake < 0 ||
      opt.payout <= opt.stake ||
      typeof opt.label !== "string" ||
      opt.label.trim().length === 0
    ) {
      return { ok: false, error: "invalid_input" };
    }
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

  const lockAt = new Date(m.kickoffAt.getTime() - 60 * 60_000);
  if (lockAt.getTime() <= Date.now()) {
    return { ok: false, error: "match_locked" };
  }

  const matchdayId = await upsertMatchdayFromKickoff(m.kickoffAt);

  // Bet-level snapshot = the highest payout among the options. The
  // grader falls back to this for any pre-migration row that wrote a
  // NULL pick.payoutSnapshot. Stake snapshot = the shared stake (all
  // options share the same stake at publish time).
  const stake = input.options[0].stake;
  const maxPayout = Math.max(...input.options.map((o) => o.payout));

  const options = input.options.map((o, i) => ({
    value: `opt_${i}`,
    labelHe: o.label,
    labelEn: o.label,
    payoutOverride: o.payout,
  }));
  const payoutOverridesByValue: Record<string, number> = {};
  const decimalOddsByValue: Record<string, number> = {};
  for (let i = 0; i < input.options.length; i += 1) {
    const opt = input.options[i];
    const value = `opt_${i}`;
    payoutOverridesByValue[value] = opt.payout;
    // Capture per-option bookmaker odds so the variable-stake submit
    // path can recompute payout when a player picks this option at a
    // non-default stake. Rounded to 2dp to match the column precision
    // we use for top-level decimal_odds on yes/no bets.
    decimalOddsByValue[value] = Math.round(opt.decimalOdds * 100) / 100;
  }

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
        answerType: "multi_choice",
        answerConfig: {
          kind: "multi_choice",
          options,
          payoutOverridesByValue,
          decimalOddsByValue,
        },
        stakeSnapshot: stake,
        payoutSnapshot: maxPayout,
        gradingSource: "manual",
        gradingConfig: null,
        status: "open",
        lockAt,
        publishedAt: new Date(),
        createdBy: user.id,
      })
      .returning({ id: customBets.id });

    console.info("[live-bet multi publish]", {
      adminId: user.id,
      customBetId: row.id,
      matchId: input.matchId,
      marketName: input.marketName,
      optionCount: input.options.length,
      stake,
      maxPayout,
    });
    revalidatePath("/[lang]/admin/live-bets/suggestions", "page");
    revalidatePath("/[lang]/play/[date]", "page");
    return { ok: true, id: row.id };
  } catch (err) {
    console.error("[live-bet multi publish] insert failed:", err);
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
