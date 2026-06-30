"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { execFirstRow, execRows } from "@/db/helpers";
import { liveGenRuns, settings } from "@/db/schema";
import { getUser } from "@/lib/supabase/auth";
import { hasPermission } from "@/lib/admin";
import { getDeadlineContext } from "@/lib/deadlines";
import { liveStakeCap } from "@/lib/odds-normalize";
import { generateSuggestions, type FixtureContext } from "@/lib/bets/suggest/generate";
import { buildUserPrompt, MAX_GUIDANCE_CHARS } from "@/lib/bets/suggest/prompt";
import { DEFAULT_SUGGESTION_COUNT } from "@/lib/bets/suggest/count";
import {
  buildMatchDossier,
  renderDossier,
  buildDayDossier,
  renderDayDossier,
  type DossierInput,
} from "@/lib/bets/suggest/dossier";
import { suggestionToDraft } from "@/lib/bets/suggest/transform";
import { buildCategoryEvGuidance } from "@/lib/bets/category-history";
import type { GradingConfig } from "@/lib/bets/types";
import { getLiveBetCategoryHistory, listFixturesForDate } from "@/db/admin-queries";
import { SUGGEST_MODELS } from "@/lib/bets/suggest/models";
import { notifyUsers } from "@/lib/notifications";
import { createCustomBet } from "../../bets/actions";

// Server actions for the admin "Live bet suggestions" page.
//
// The page is AI-driven: the admin asks the LLM for a batch of live bets
// (per fixture or per matchday) and reviews the resulting drafts before
// publishing. These actions own that generation flow plus the model /
// auto-generation settings the page exposes.

type Err =
  | "unauth"
  | "forbidden"
  | "match_not_found"
  | "match_locked"
  | "invalid_input"
  | "db";

// ─── AI suggestion generation ─────────────────────────────────────
//
// Ask the LLM for a batch of live bets for one fixture, price each via the
// shared probability→odds pipeline, and insert them as DRAFTS through
// createCustomBet (which re-validates + re-derives payouts). Nothing
// publishes — the admin reviews the drafts in /admin/bets and publishes the
// ones they like.
//
// Runs in the BACKGROUND: with the dossier + focused web search a batch takes
// up to ~2 minutes, well past any sane synchronous wait (and past the old 60s
// function ceiling that was killing generations mid-flight). The action does
// the cheap validation synchronously, schedules the heavy work via `after()`,
// and returns immediately. When the drafts are ready (or the run fails) the
// admin gets an in-app + push notification. This is the "background + notify"
// execution the user chose. See
// _plans/2026-06-13-live-bet-suggestions-enrichment.md (clarification 5).
export type GenerateAiResult =
  | { ok: true; started: true }
  | { ok: false; error: Err | "no_key" | "match_started" };

// ─── Generation run log (live_gen_runs) ───────────────────────────
//
// One row per generation, surfaced inline on the suggestions page so the admin
// sees progress, errors, and exactly how many bets were produced — no digging
// through server logs. A 'running' row is inserted synchronously when a run is
// scheduled (so it shows up immediately), then finalized by the background
// task to 'done'/'failed' with the model + counts + token usage.

// Open a run row and return its id (best-effort — a logging failure must never
// block generation, so this swallows errors and the run just goes untracked).
async function startGenRun(input: {
  scope: "match" | "day";
  subjectHe: string;
  requested?: number;
  startedBy: string;
}): Promise<string | null> {
  try {
    const [row] = await db
      .insert(liveGenRuns)
      .values({
        scope: input.scope,
        subjectHe: input.subjectHe,
        requested: input.requested ?? null,
        startedBy: input.startedBy,
        status: "running",
      })
      .returning({ id: liveGenRuns.id });
    return row?.id ?? null;
  } catch (err) {
    console.error("[live-gen run start failed]", { err });
    return null;
  }
}

type FinishGenRunInput = {
  status: "done" | "failed";
  model?: string;
  returned?: number;
  valid?: number;
  created?: number;
  failed?: number;
  searchRequests?: number;
  inputTokens?: number;
  outputTokens?: number;
  error?: string;
};

// Finalize a run row. No-op when the row was never opened.
async function finishGenRun(
  runId: string | null,
  p: FinishGenRunInput,
): Promise<void> {
  if (!runId) return;
  try {
    await db
      .update(liveGenRuns)
      .set({
        status: p.status,
        model: p.model ?? null,
        returned: p.returned ?? null,
        valid: p.valid ?? null,
        created: p.created ?? null,
        failed: p.failed ?? null,
        searchRequests: p.searchRequests ?? null,
        inputTokens: p.inputTokens ?? null,
        outputTokens: p.outputTokens ?? null,
        error: p.error ?? null,
        finishedAt: new Date(),
      })
      .where(eq(liveGenRuns.id, runId));
  } catch (err) {
    console.error("[live-gen run finish failed]", { runId, err });
  }
}

export type GenRunRow = {
  id: string;
  scope: string;
  subjectHe: string;
  model: string | null;
  requested: number | null;
  status: string;
  returned: number | null;
  valid: number | null;
  created: number | null;
  failed: number | null;
  searchRequests: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
};

// Recent generation runs for the inline log panel. Admin-gated; returns [] for
// anyone without the liveBets permission so the panel simply stays empty.
export async function listRecentGenRuns(limit = 12): Promise<GenRunRow[]> {
  const user = await getUser();
  if (!user) return [];
  if (!(await hasPermission(user.id, "liveBets"))) return [];
  const take = Math.min(50, Math.max(1, Math.round(limit)));
  const rows = await db
    .select()
    .from(liveGenRuns)
    .orderBy(desc(liveGenRuns.startedAt))
    .limit(take);
  return rows.map((r) => ({
    id: r.id,
    scope: r.scope,
    subjectHe: r.subjectHe,
    model: r.model,
    requested: r.requested,
    status: r.status,
    returned: r.returned,
    valid: r.valid,
    created: r.created,
    failed: r.failed,
    searchRequests: r.searchRequests,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    error: r.error,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
  }));
}

export async function generateAiSuggestions(
  matchId: string,
  opts?: { count?: number; instructions?: string },
): Promise<GenerateAiResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauth" };
  if (!(await hasPermission(user.id, "liveBets"))) {
    console.warn("[live-gen denied]", { userId: user.id, matchId });
    return { ok: false, error: "forbidden" };
  }
  // Fail fast on a missing key rather than scheduling work that can't run.
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, error: "no_key" };

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

  const adminId = user.id;
  const lockAtIso = lockAt.toISOString();
  // Open the run row up front so the inline log shows "running" immediately.
  const runId = await startGenRun({
    scope: "match",
    subjectHe: `${fx.context.homeNameHe} נגד ${fx.context.awayNameHe}`,
    requested: opts?.count,
    startedBy: adminId,
  });
  after(() =>
    runMatchGeneration({
      matchId,
      fx,
      adminId,
      lockAtIso,
      runId,
      count: opts?.count,
      instructions: opts?.instructions,
    }),
  );
  console.info("[live-gen started]", { adminId, matchId, runId });
  return { ok: true, started: true };
}

// The heavy half of generateAiSuggestions, run after the response is sent.
// Owns the dossier + LLM call + draft inserts, then notifies the admin with
// the outcome. Never throws out of `after()` — every exit path notifies so
// the admin is never left waiting on a silent failure.
type MatchGenArgs = {
  matchId: string;
  fx: NonNullable<Awaited<ReturnType<typeof loadFixtureContext>>>;
  adminId: string;
  lockAtIso: string;
  runId: string | null;
  count?: number;
  instructions?: string;
};

async function runMatchGeneration(args: MatchGenArgs): Promise<void> {
  const { matchId, fx, adminId, lockAtIso, runId } = args;
  const subjectHe = `${fx.context.homeNameHe} נגד ${fx.context.awayNameHe}`;
  let model: string | undefined;
  try {
    const [modelRow] = await db
      .select({
        suggestModel: settings.suggestModel,
        guidance: settings.suggestGuidanceMatch,
      })
      .from(settings)
      .where(eq(settings.id, 1))
      .limit(1);
    model = modelRow?.suggestModel;

    // Assemble the match dossier (real API-Football data) + the questions
    // already live for this fixture (anti-repetition). Both feed the prompt;
    // a dossier failure is non-fatal — the generator falls back to a thin
    // prompt rather than blocking generation.
    const [dossierResult, existingQuestions, categoryHistory] = await Promise.all([
      buildMatchDossier({
        matchId,
        homeCode: fx.homeCode,
        homeNameHe: fx.context.homeNameHe,
        homeNameEn: fx.context.homeNameEn,
        awayCode: fx.awayCode,
        awayNameHe: fx.context.awayNameHe,
        awayNameEn: fx.context.awayNameEn,
      }).catch((err) => {
        console.error("[live-gen dossier failed]", { matchId, err });
        return null;
      }),
      loadExistingQuestions(matchId),
      // Selection steer from the pool's own settled history (poor-value
      // categories). Non-fatal — an empty steer just adds nothing.
      getLiveBetCategoryHistory().catch((err) => {
        console.error("[live-gen category history failed]", { matchId, err });
        return [];
      }),
    ]);
    const dataGuidance = buildCategoryEvGuidance(categoryHistory);
    console.info("[live-gen data steer]", {
      matchId,
      drainCategories: categoryHistory.filter((s) => s.meetsSampleGate && (s.evPct ?? 0) <= -15).map((s) => s.category),
      applied: dataGuidance.length > 0,
    });

    const label =
      `${fx.context.homeNameEn} (HE: ${fx.context.homeNameHe}) vs ` +
      `${fx.context.awayNameEn} (HE: ${fx.context.awayNameHe}). ` +
      `Stage: ${fx.context.stage}. Kickoff: ${fx.context.kickoffLabel}.`;

    const gen = await generateSuggestions({ scope: "match", label }, modelRow?.suggestModel, {
      count: args.count,
      instructions: args.instructions,
      guidance: modelRow?.guidance ?? undefined,
      dataGuidance,
      dossierText: dossierResult ? renderDossier(dossierResult.dossier) : undefined,
      validPlayerIds: dossierResult?.validPlayerIds,
      existingQuestions,
      // The user chose focused web search (1-3). 3 is the clamp ceiling; the
      // model searches only when the request actually needs current info.
      webSearchMaxUses: 3,
    });
    if (!gen.ok) {
      console.warn("[live-gen bg gen failed]", { matchId, error: gen.error });
      await finishGenRun(runId, {
        status: "failed",
        model,
        returned: gen.stats?.returned,
        valid: gen.stats?.valid,
        searchRequests: gen.stats?.searchRequests,
        inputTokens: gen.stats?.inputTokens,
        outputTokens: gen.stats?.outputTokens,
        error: gen.error,
      });
      await notifyGenerationDone(adminId, { subjectHe, created: 0, failed: 0, failedGen: true });
      return;
    }

    const pricingConfig = await loadLivePricingConfig();
    let created = 0;
    let failed = 0;
    for (const suggestion of gen.suggestions) {
      const draft = suggestionToDraft(suggestion, pricingConfig);
      if ("error" in draft) {
        failed += 1;
        console.warn("[live-gen draft skip]", { reason: draft.error, q: suggestion.questionEn });
        continue;
      }
      const gradingSource = draft.grading == null ? "manual" : draft.grading.source;
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
      if (res.ok) created += 1;
      else {
        failed += 1;
        console.warn("[live-gen create failed]", { error: res.error, q: draft.questionEn });
      }
    }

    console.info("[live-gen persisted]", { adminId, matchId, created, failed, total: gen.suggestions.length });
    await finishGenRun(runId, {
      status: "done",
      model,
      returned: gen.stats.returned,
      valid: gen.stats.valid,
      created,
      failed,
      searchRequests: gen.stats.searchRequests,
      inputTokens: gen.stats.inputTokens,
      outputTokens: gen.stats.outputTokens,
    });
    revalidatePath("/[lang]/admin/bets", "page");
    revalidatePath("/[lang]/admin/live-bets/suggestions", "page");
    await notifyGenerationDone(adminId, { subjectHe, created, failed, failedGen: false });
  } catch (err) {
    console.error("[live-gen bg crashed]", { matchId, err });
    await finishGenRun(runId, { status: "failed", model, error: "crashed" });
    await notifyGenerationDone(adminId, { subjectHe, created: 0, failed: 0, failedGen: true });
  }
}

// Notify the admin who triggered a background generation that it finished.
// In-app feed row + push (best-effort). The url drops them straight into the
// draft review queue. Kind 'custom' reuses the existing notification channel.
async function notifyGenerationDone(
  adminId: string,
  p: { subjectHe: string; created: number; failed: number; failedGen: boolean },
): Promise<void> {
  const title = p.failedGen
    ? "ייצור ההצעות נכשל"
    : p.created > 0
      ? "טיוטות AI מוכנות לעיון"
      : "הייצור הסתיים בלי טיוטות";
  const body = p.failedGen
    ? `לא הצלחנו לייצר הצעות ל${p.subjectHe}. נסה שוב.`
    : p.created > 0
      ? `נוצרו ${p.created} טיוטות ל${p.subjectHe}${p.failed ? ` (${p.failed} נכשלו)` : ""}. הקש לעיון ופרסום.`
      : `לא נוצרו טיוטות ל${p.subjectHe}. נסה שוב.`;
  try {
    await notifyUsers(
      { kind: "user", userId: adminId },
      { kind: "custom", title, body, url: "/he/admin/bets", push: true, createdBy: adminId },
    );
  } catch (err) {
    console.error("[live-gen notify failed]", { adminId, err });
  }
}

// Day-scope sibling of generateAiSuggestions: ask the LLM for a batch of
// bets that span a whole matchday (cross-fixture day markets + per-fixture
// ideas), seeded with a dossier assembled across every schedulable fixture
// that day. Inserts as DRAFTS at scope 'day'. Day bets anchor to the matchday,
// not a single fixture, so they grade MANUALLY (the events grader needs a
// matchId) — the prompt already tells the model day markets settle by hand.
// Like generateAiSuggestions, this runs in the BACKGROUND (after()) and
// notifies the admin when the day's drafts are ready.
export async function generateDaySuggestions(
  date: string,
  opts?: { count?: number; instructions?: string },
): Promise<GenerateAiResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauth" };
  if (!(await hasPermission(user.id, "liveBets"))) {
    console.warn("[live-gen-day denied]", { userId: user.id, date });
    return { ok: false, error: "forbidden" };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "invalid_input" };
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, error: "no_key" };

  // Only fixtures that can still take bets anchor the day; a day whose games
  // have all kicked off can't take a new day bet.
  const fixtures = await listFixturesForDate(date);
  const schedulable = fixtures.filter(
    (f) => f.status === "scheduled" && new Date(f.kickoffAt).getTime() > Date.now(),
  );
  if (schedulable.length === 0) return { ok: false, error: "match_started" };

  // Day lock = earliest remaining kickoff minus the custom_day offset (same
  // single source of truth as a hand-authored day bet).
  const earliestKickoff = new Date(
    Math.min(...schedulable.map((f) => new Date(f.kickoffAt).getTime())),
  );
  const lockAt = await resolveSuggestionLockAt(earliestKickoff, "custom_day");
  if (lockAt.getTime() <= Date.now()) return { ok: false, error: "match_started" };

  const adminId = user.id;
  const lockAtIso = lockAt.toISOString();
  // Snapshot the fixtures the background task needs so it doesn't re-query.
  const fixturesSnapshot: DayGenFixture[] = schedulable.map((f) => ({
    id: f.id,
    homeCode: f.homeCode,
    homeNameHe: f.homeNameHe,
    homeNameEn: f.homeNameEn,
    awayCode: f.awayCode,
    awayNameHe: f.awayNameHe,
    awayNameEn: f.awayNameEn,
  }));
  const runId = await startGenRun({
    scope: "day",
    subjectHe: `יום המשחקים ${date}`,
    requested: opts?.count,
    startedBy: adminId,
  });
  after(() =>
    runDayGeneration({
      date,
      fixtures: fixturesSnapshot,
      adminId,
      lockAtIso,
      runId,
      count: opts?.count,
      instructions: opts?.instructions,
    }),
  );
  console.info("[live-gen-day started]", { adminId, date, fixtures: schedulable.length, runId });
  return { ok: true, started: true };
}

type DayGenFixture = {
  id: string;
  homeCode: string;
  homeNameHe: string;
  homeNameEn: string;
  awayCode: string;
  awayNameHe: string;
  awayNameEn: string;
};

type DayGenArgs = {
  date: string;
  fixtures: DayGenFixture[];
  adminId: string;
  lockAtIso: string;
  runId: string | null;
  count?: number;
  instructions?: string;
};

// Decide how a day-scope suggestion settles. Day scope auto-grades only the
// shapes that aggregate across the whole slate without a single fixture
// anchor: total goals (auto_football_data total_goals / ht_total) and any
// per-stat day total (auto_api_football sum_day). Everything else — event
// timelines, first-event-window distributions, per-match stats, player props,
// or an absent config — has no day-scope resolver, so it settles manually.
// Mirrors resolveDayScope / resolveDayScopeApiFootball in src/lib/sync.ts.
function dayScopeGrading(grading: GradingConfig): {
  gradingSource: "auto_football_data" | "auto_api_football" | "manual";
  gradingConfig: GradingConfig;
} {
  if (
    grading?.source === "auto_football_data" &&
    (grading.field === "total_goals" || grading.field === "ht_total")
  ) {
    return { gradingSource: "auto_football_data", gradingConfig: grading };
  }
  if (
    grading?.source === "auto_api_football" &&
    "stat" in grading &&
    grading.aggregate === "sum_day"
  ) {
    return { gradingSource: "auto_api_football", gradingConfig: grading };
  }
  return { gradingSource: "manual", gradingConfig: null };
}

// The heavy half of generateDaySuggestions, run after the response is sent.
async function runDayGeneration(args: DayGenArgs): Promise<void> {
  const { date, fixtures, adminId, lockAtIso, runId } = args;
  const subjectHe = `יום המשחקים ${date}`;
  let model: string | undefined;
  try {
    const [modelRow] = await db
      .select({
        suggestModel: settings.suggestModel,
        guidance: settings.suggestGuidanceDay,
      })
      .from(settings)
      .where(eq(settings.id, 1))
      .limit(1);
    model = modelRow?.suggestModel;

    const dossierInputs: DossierInput[] = fixtures.map((f) => ({
      matchId: f.id,
      homeCode: f.homeCode,
      homeNameHe: f.homeNameHe,
      homeNameEn: f.homeNameEn,
      awayCode: f.awayCode,
      awayNameHe: f.awayNameHe,
      awayNameEn: f.awayNameEn,
    }));

    const [dayDossier, existingQuestions, categoryHistory] = await Promise.all([
      buildDayDossier(dossierInputs).catch((err) => {
        console.error("[live-gen day dossier failed]", { date, err });
        return null;
      }),
      loadExistingDayQuestions(date),
      getLiveBetCategoryHistory().catch((err) => {
        console.error("[live-gen day category history failed]", { date, err });
        return [];
      }),
    ]);
    const dataGuidance = buildCategoryEvGuidance(categoryHistory);
    console.info("[live-gen-day data steer]", {
      date,
      drainCategories: categoryHistory.filter((s) => s.meetsSampleGate && (s.evPct ?? 0) <= -15).map((s) => s.category),
      applied: dataGuidance.length > 0,
    });

    const fixtureList = fixtures.map((f) => `${f.homeNameEn} vs ${f.awayNameEn}`).join(", ");
    const label =
      `All ${fixtures.length} matches on ${formatDayLabel(date)} (Asia/Jerusalem): ${fixtureList}.`;

    const gen = await generateSuggestions({ scope: "day", label }, modelRow?.suggestModel, {
      count: args.count,
      instructions: args.instructions,
      guidance: modelRow?.guidance ?? undefined,
      dataGuidance,
      dossierText: dayDossier ? renderDayDossier(dayDossier.fixtures) : undefined,
      validPlayerIds: dayDossier?.validPlayerIds,
      existingQuestions,
      webSearchMaxUses: 3,
    });
    if (!gen.ok) {
      console.warn("[live-gen-day bg gen failed]", { date, error: gen.error });
      await finishGenRun(runId, {
        status: "failed",
        model,
        returned: gen.stats?.returned,
        valid: gen.stats?.valid,
        searchRequests: gen.stats?.searchRequests,
        inputTokens: gen.stats?.inputTokens,
        outputTokens: gen.stats?.outputTokens,
        error: gen.error,
      });
      await notifyGenerationDone(adminId, { subjectHe, created: 0, failed: 0, failedGen: true });
      return;
    }

    const pricingConfig = await loadLivePricingConfig();
    let created = 0;
    let failed = 0;
    for (const suggestion of gen.suggestions) {
      const draft = suggestionToDraft(suggestion, pricingConfig);
      if ("error" in draft) {
        failed += 1;
        console.warn("[live-gen-day draft skip]", { reason: draft.error, q: suggestion.questionEn });
        continue;
      }
      // Day scope auto-grades the shapes that aggregate across the whole
      // slate without a single matchId (total goals via total_goals/ht_total,
      // and any sum_day stat). Event-timeline / first-event-window / per-match
      // shapes can't anchor at day scope, so those fall back to manual.
      const dayGrade = dayScopeGrading(draft.grading);
      const res = await createCustomBet({
        scope: "day",
        matchdayDate: date,
        questionHe: draft.questionHe,
        questionEn: draft.questionEn,
        gradingRuleHe: draft.gradingRuleHe,
        gradingRuleEn: draft.gradingRuleEn,
        answerType: draft.answerType,
        answerConfig: draft.answerConfig,
        stakeSnapshot: draft.stakeSnapshot,
        payoutSnapshot: draft.payoutSnapshot,
        decimalOdds: null,
        gradingSource: dayGrade.gradingSource,
        gradingConfig: dayGrade.gradingConfig,
        lockAt: lockAtIso,
      });
      if (res.ok) created += 1;
      else {
        failed += 1;
        console.warn("[live-gen-day create failed]", { error: res.error, q: draft.questionEn });
      }
    }

    console.info("[live-gen-day persisted]", {
      adminId,
      date,
      fixtures: fixtures.length,
      created,
      failed,
      total: gen.suggestions.length,
    });
    await finishGenRun(runId, {
      status: "done",
      model,
      returned: gen.stats.returned,
      valid: gen.stats.valid,
      created,
      failed,
      searchRequests: gen.stats.searchRequests,
      inputTokens: gen.stats.inputTokens,
      outputTokens: gen.stats.outputTokens,
    });
    revalidatePath("/[lang]/admin/bets", "page");
    revalidatePath("/[lang]/admin/live-bets/suggestions", "page");
    await notifyGenerationDone(adminId, { subjectHe, created, failed, failedGen: false });
  } catch (err) {
    console.error("[live-gen-day bg crashed]", { date, err });
    await finishGenRun(runId, { status: "failed", model, error: "crashed" });
    await notifyGenerationDone(adminId, { subjectHe, created: 0, failed: 0, failedGen: true });
  }
}

// Persist the admin's chosen suggestion model. Validated against the fixed
// catalogue so a typo or retired id can't reach the generator.
export async function setSuggestModel(
  modelId: string,
): Promise<{ ok: true } | { ok: false; error: Err }> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauth" };
  if (!(await hasPermission(user.id, "liveBets"))) {
    console.warn("[suggest-model denied]", { userId: user.id });
    return { ok: false, error: "forbidden" };
  }
  if (!SUGGEST_MODELS.some((m) => m.id === modelId)) {
    return { ok: false, error: "invalid_input" };
  }
  try {
    await db.update(settings).set({ suggestModel: modelId }).where(eq(settings.id, 1));
    console.info("[suggest-model set]", { adminId: user.id, modelId });
    revalidatePath("/[lang]/admin/live-bets/suggestions", "page");
    return { ok: true };
  } catch (err) {
    console.error("[suggest-model set] failed:", err);
    return { ok: false, error: "db" };
  }
}

// Toggle + tune the auto-generation rule (settings.live_autogen_*). When
// enabled, the daily /api/cron/live-autogen cron seeds draft suggestions
// for upcoming matches with no bets yet. Lead hours is clamped to a sane
// band so a typo can't make the cron scan the whole tournament at once.
export async function setAutogenConfig(input: {
  enabled: boolean;
  leadHours: number;
}): Promise<{ ok: true } | { ok: false; error: Err }> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauth" };
  if (!(await hasPermission(user.id, "liveBets"))) {
    console.warn("[autogen-config denied]", { userId: user.id });
    return { ok: false, error: "forbidden" };
  }
  if (typeof input.enabled !== "boolean") {
    return { ok: false, error: "invalid_input" };
  }
  const leadHours = Math.round(input.leadHours);
  if (!Number.isFinite(leadHours) || leadHours < 1 || leadHours > 72) {
    return { ok: false, error: "invalid_input" };
  }
  try {
    await db
      .update(settings)
      .set({ liveAutogenEnabled: input.enabled, liveAutogenLeadHours: leadHours })
      .where(eq(settings.id, 1));
    console.info("[autogen-config set]", { adminId: user.id, enabled: input.enabled, leadHours });
    revalidatePath("/[lang]/admin/live-bets/suggestions", "page");
    return { ok: true };
  } catch (err) {
    console.error("[autogen-config set] failed:", err);
    return { ok: false, error: "db" };
  }
}

// ─── Prompt transparency + guidance ───────────────────────────────
//
// The admin can SEE the full prompt the LLM receives and tune a SAFE guidance
// block (separate for match and day scope). The guidance is fenced inside the
// system prompt and explicitly subordinated to the hard rules (see
// buildSystemPrompt) so it can never break the format/schema/grading contract.

export type PromptScopeInfo = {
  scope: "match" | "day";
  // The current saved guidance ("" when none). The client recomputes the full
  // system prompt live from this via the same buildSystemPrompt the generator
  // uses, so the read-only preview always reflects unsaved edits too.
  guidance: string;
  // The auto-computed data steer (poor-value categories from the pool's own
  // history) the generator injects this run, or "" when no category clears the
  // drain bar. Read-only — shown so the admin sees exactly what data-derived
  // selection nudge the model receives. Same for both scopes.
  dataGuidance: string;
  // A faithful sample of the user prompt, with placeholders where the real
  // run injects the dossier / anti-repetition list / admin request.
  userPromptSample: string;
};

// Assemble the read-only prompt view for one scope. The sample user prompt
// uses placeholders for the parts that are filled in per run (the dossier, the
// already-live questions, the free-text request) so the admin sees the real
// shape without needing a live fixture.
function buildScopeInfo(
  scope: "match" | "day",
  guidance: string,
  dataGuidance: string,
): PromptScopeInfo {
  const label =
    scope === "match"
      ? "<דוגמה: Argentina (HE: ארגנטינה) vs Mexico (HE: מקסיקו). Stage: Group Stage. Kickoff: ...>"
      : "<דוגמה: All matches today (Asia/Jerusalem): ...>";
  const userPromptSample = buildUserPrompt({ scope, label }, DEFAULT_SUGGESTION_COUNT, {
    dossierText:
      "<כאן נדחס דוסייה אמיתי לכל ריצה: כוח אדם, פציעות, שחקני מפתח עם מזהים, הסתברויות הניצחון, תוצאות אחרונות>",
    existingQuestions: [
      "<ההימורים שכבר קיימים למשחק/ליום מוזרקים כאן כדי שה-AI לא יחזור עליהם>",
    ],
    instructions: "<הבקשה החופשית מכפתור 'אפשרויות' תופיע כאן, אם תמלא אותה>",
  });
  return { scope, guidance, dataGuidance, userPromptSample };
}

// Full prompt + current guidance for both scopes, for the inline prompt panel.
export async function getPromptInfo(): Promise<
  { ok: true; scopes: PromptScopeInfo[] } | { ok: false; error: Err }
> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauth" };
  if (!(await hasPermission(user.id, "liveBets"))) {
    return { ok: false, error: "forbidden" };
  }
  const [[s], categoryHistory] = await Promise.all([
    db
      .select({
        match: settings.suggestGuidanceMatch,
        day: settings.suggestGuidanceDay,
      })
      .from(settings)
      .where(eq(settings.id, 1))
      .limit(1),
    getLiveBetCategoryHistory().catch(() => []),
  ]);
  // Same data steer the generator computes — scope-independent (the history is
  // pool-wide), so both scopes show the identical block.
  const dataGuidance = buildCategoryEvGuidance(categoryHistory);
  return {
    ok: true,
    scopes: [
      buildScopeInfo("match", s?.match ?? "", dataGuidance),
      buildScopeInfo("day", s?.day ?? "", dataGuidance),
    ],
  };
}

// Save the admin guidance for one scope. Empty/whitespace clears it (null).
// Length-capped to MAX_GUIDANCE_CHARS so it can't blow the token budget.
export async function setSuggestGuidance(
  scope: "match" | "day",
  text: string,
): Promise<{ ok: true } | { ok: false; error: Err }> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauth" };
  if (!(await hasPermission(user.id, "liveBets"))) {
    console.warn("[suggest-guidance denied]", { userId: user.id, scope });
    return { ok: false, error: "forbidden" };
  }
  if (scope !== "match" && scope !== "day") {
    return { ok: false, error: "invalid_input" };
  }
  const trimmed = (text ?? "").slice(0, MAX_GUIDANCE_CHARS);
  const value = trimmed.trim().length === 0 ? null : trimmed;
  try {
    await db
      .update(settings)
      .set(
        scope === "match"
          ? { suggestGuidanceMatch: value }
          : { suggestGuidanceDay: value },
      )
      .where(eq(settings.id, 1));
    console.info("[suggest-guidance set]", {
      adminId: user.id,
      scope,
      chars: value?.length ?? 0,
    });
    revalidatePath("/[lang]/admin/live-bets/suggestions", "page");
    return { ok: true };
  } catch (err) {
    console.error("[suggest-guidance set] failed:", err);
    return { ok: false, error: "db" };
  }
}

// Count fixtures still to be played (scheduled, kickoff in the future).
// Drives the end-of-tournament cost projection on the AI model card.
export async function countRemainingMatches(): Promise<number> {
  const row = await execFirstRow<{ n: number }>(sql`
    select count(*)::int as "n"
    from public.matches
    where status = 'scheduled' and kickoff_at > now()
  `);
  return row?.n ?? 0;
}

// Load the fixture's bilingual team names, stage and kickoff for the
// generation prompt + lock anchor.
async function loadFixtureContext(matchId: string): Promise<
  | { kickoffAt: Date; status: string; homeCode: string; awayCode: string; context: FixtureContext }
  | null
> {
  const row = await execFirstRow<{
    kickoffAt: string;
    status: string;
    stage: string | null;
    homeCode: string;
    awayCode: string;
    homeNameHe: string;
    homeNameEn: string;
    awayNameHe: string;
    awayNameEn: string;
  }>(sql`
    select
      m.kickoff_at::text as "kickoffAt",
      m.status::text     as "status",
      m.stage::text      as "stage",
      m.home_team        as "homeCode",
      m.away_team        as "awayCode",
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
    homeCode: row.homeCode,
    awayCode: row.awayCode,
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

// Questions already attached to this fixture (draft or open), so the
// generator can be told not to re-propose them. Both languages are handed
// over since the model writes both. Capped at the prompt's own slice() so a
// fixture with a huge backlog can't bloat the request.
async function loadExistingQuestions(matchId: string): Promise<string[]> {
  const rows = await execRows<{ questionEn: string; questionHe: string }>(sql`
    select question_en as "questionEn", question_he as "questionHe"
    from public.custom_bets
    where match_id = ${matchId}::uuid
      and status in ('draft', 'open')
    order by created_at desc
    limit 40
  `);
  return rows.map((r) => `${r.questionEn} / ${r.questionHe}`);
}

// Day-scope sibling of loadExistingQuestions: questions already attached to
// this matchday (draft or open), keyed via the matchdays date, so the day
// generator does not re-propose them.
async function loadExistingDayQuestions(date: string): Promise<string[]> {
  const rows = await execRows<{ questionEn: string; questionHe: string }>(sql`
    select cb.question_en as "questionEn", cb.question_he as "questionHe"
    from public.custom_bets cb
    join public.matchdays md on md.id = cb.matchday_id
    where cb.scope = 'day'
      and md.date = ${date}::date
      and cb.status in ('draft', 'open')
    order by cb.created_at desc
    limit 40
  `);
  return rows.map((r) => `${r.questionEn} / ${r.questionHe}`);
}

// "Sat 14 Jun" in Asia/Jerusalem from a YYYY-MM-DD date. Noon UTC anchors the
// calendar day safely (no midnight TZ slip in either direction).
function formatDayLabel(date: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(`${date}T12:00:00Z`));
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
