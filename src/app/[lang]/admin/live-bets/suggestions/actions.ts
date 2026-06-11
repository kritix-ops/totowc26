"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { execFirstRow } from "@/db/helpers";
import {
  customBets,
  matches as matchesTable,
  matchdays,
  settings,
} from "@/db/schema";
import { getUser } from "@/lib/supabase/auth";
import { isAdmin } from "@/lib/admin";
import { getDeadlineContext } from "@/lib/deadlines";
import { liveStakeCap } from "@/lib/odds-normalize";
import { generateSuggestions, type FixtureContext } from "@/lib/bets/suggest/generate";
import { suggestionToDraft } from "@/lib/bets/suggest/transform";
import { createCustomBet } from "../../bets/actions";

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

  // Match-scope lock offset comes from the deadlines context (defaults
  // table → /admin/deadlines), so admin can tune it without a code
  // change. Defaults to 5 minutes per migration 0048.
  const lockAt = await resolveSuggestionLockAt(m.kickoffAt, "custom_match");
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

  const lockAt = await resolveSuggestionLockAt(m.kickoffAt, "custom_match");
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

// ─── AI suggestion generation ─────────────────────────────────────
//
// Ask the LLM for a batch of live bets for one fixture, price each via the
// shared probability→odds pipeline, and insert them as DRAFTS through
// createCustomBet (which re-validates + re-derives payouts). Nothing
// publishes — the admin reviews the drafts in /admin/bets and publishes the
// ones they like. Per the user's decision: generation is automatic, the
// approval is a deliberate tap. See
// _plans/2026-06-12-live-bets-llm-overhaul.md Phase 2.
export type GenerateAiResult =
  | { ok: true; created: number; failed: number; total: number }
  | { ok: false; error: Err | "no_key" | "llm_failed" | "match_started" };

export async function generateAiSuggestions(
  matchId: string,
): Promise<GenerateAiResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauth" };
  if (!(await isAdmin(user.id))) {
    console.warn("[live-gen denied]", { userId: user.id, matchId });
    return { ok: false, error: "forbidden" };
  }

  // Fixture context for the prompt + the lock anchor. Only schedulable
  // (not-yet-started) matches qualify — a started match can't take new
  // live bets and createCustomBet would reject the past lockAt anyway.
  const fx = await loadFixtureContext(matchId);
  if (!fx) return { ok: false, error: "match_not_found" };
  if (fx.status !== "scheduled") return { ok: false, error: "match_started" };

  const lockAt = await resolveSuggestionLockAt(fx.kickoffAt, "custom_match");
  if (lockAt.getTime() <= Date.now()) {
    return { ok: false, error: "match_started" };
  }

  const gen = await generateSuggestions(fx.context);
  if (!gen.ok) {
    return { ok: false, error: gen.error === "no_key" ? "no_key" : "llm_failed" };
  }

  const pricingConfig = await loadLivePricingConfig();
  const lockAtIso = lockAt.toISOString();
  let created = 0;
  let failed = 0;

  for (const suggestion of gen.suggestions) {
    const draft = suggestionToDraft(suggestion, pricingConfig);
    if ("error" in draft) {
      failed += 1;
      console.warn("[live-gen draft skip]", { reason: draft.error, q: suggestion.questionEn });
      continue;
    }
    const gradingSource =
      draft.grading == null ? "manual" : draft.grading.source;
    const res = await createCustomBet({
      scope: "match",
      matchId,
      questionHe: draft.questionHe,
      questionEn: draft.questionEn,
      gradingRuleHe: draft.gradingRuleHe,
      gradingRuleEn: draft.gradingRuleEn,
      answerType: draft.answerType,
      answerConfig: draft.answerConfig,
      stakeSnapshot: draft.stakeSnapshot,
      payoutSnapshot: draft.payoutSnapshot,
      decimalOdds: null,
      gradingSource,
      gradingConfig: draft.grading,
      lockAt: lockAtIso,
    });
    if (res.ok) {
      created += 1;
    } else {
      failed += 1;
      console.warn("[live-gen create failed]", { error: res.error, q: draft.questionEn });
    }
  }

  console.info("[live-gen persisted]", {
    adminId: user.id,
    matchId,
    created,
    failed,
    total: gen.suggestions.length,
  });
  revalidatePath("/[lang]/admin/bets", "page");
  revalidatePath("/[lang]/admin/live-bets/suggestions", "page");
  return { ok: true, created, failed, total: gen.suggestions.length };
}

// Load the fixture's bilingual team names, stage and kickoff for the
// generation prompt + lock anchor.
async function loadFixtureContext(matchId: string): Promise<
  | { kickoffAt: Date; status: string; context: FixtureContext }
  | null
> {
  const row = await execFirstRow<{
    kickoffAt: string;
    status: string;
    stage: string | null;
    homeNameHe: string;
    homeNameEn: string;
    awayNameHe: string;
    awayNameEn: string;
  }>(sql`
    select
      m.kickoff_at::text as "kickoffAt",
      m.status::text     as "status",
      m.stage::text      as "stage",
      ht.name_he         as "homeNameHe",
      ht.name_en         as "homeNameEn",
      at.name_he         as "awayNameHe",
      at.name_en         as "awayNameEn"
    from public.matches m
    join public.teams ht on ht.code = m.home_team
    join public.teams at on at.code = m.away_team
    where m.id = ${matchId}::uuid
    limit 1
  `);
  if (!row) return null;
  const kickoffAt = new Date(row.kickoffAt);
  const kickoffLabel = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(kickoffAt);
  return {
    kickoffAt,
    status: row.status,
    context: {
      homeNameHe: row.homeNameHe,
      homeNameEn: row.homeNameEn,
      awayNameHe: row.awayNameHe,
      awayNameEn: row.awayNameEn,
      stage: row.stage ?? "Group Stage",
      kickoffLabel,
    },
  };
}

// Canonical live pricing config from settings (baseStake / cap / edge).
// Mirrors the same loader in admin/bets/actions.ts; the odds the suggestion
// transform derives are config-independent (1/p), but the snapshot payout
// uses these and createCustomBet re-derives from the same source.
async function loadLivePricingConfig() {
  const [s] = await db
    .select({
      baseStake: settings.liveOddsBaseStake,
      houseEdgePct: settings.liveOddsHouseEdgePct,
      ratio: settings.liveOddsMaxPayoutRatio,
      ceiling: settings.liveOddsMaxPayoutCeiling,
    })
    .from(settings)
    .where(eq(settings.id, 1))
    .limit(1);
  const baseStake = s?.baseStake ?? 3;
  return {
    baseStake,
    houseEdgePct: s?.houseEdgePct ?? 5,
    maxPayout: liveStakeCap(baseStake, {
      maxPayoutRatio: s?.ratio ?? 8,
      maxPayoutCeiling: s?.ceiling ?? 100,
    }),
  };
}

// Pull the per-type lock offset from the deadlines table (managed via
// /admin/deadlines) and translate it into the absolute lockAt for a
// suggestion publish. Same single source of truth as previewCustomBetLock,
// so a change in /admin/deadlines is reflected here without redeploy.
async function resolveSuggestionLockAt(
  kickoffAt: Date,
  typeKey: "custom_match" | "custom_day",
): Promise<Date> {
  const ctx = await getDeadlineContext();
  const offsetMinutes = ctx.defaults[typeKey];
  return new Date(kickoffAt.getTime() - offsetMinutes * 60_000);
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
