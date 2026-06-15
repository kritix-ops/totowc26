"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { execFirstRow, execRows } from "@/db/helpers";
import { settings } from "@/db/schema";
import { getUser } from "@/lib/supabase/auth";
import { hasPermission } from "@/lib/admin";
import { getDeadlineContext } from "@/lib/deadlines";
import { liveStakeCap } from "@/lib/odds-normalize";
import { generateSuggestions, type FixtureContext } from "@/lib/bets/suggest/generate";
import {
  buildMatchDossier,
  renderDossier,
  buildDayDossier,
  renderDayDossier,
  type DossierInput,
} from "@/lib/bets/suggest/dossier";
import { suggestionToDraft } from "@/lib/bets/suggest/transform";
import { listFixturesForDate } from "@/db/admin-queries";
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
  after(() =>
    runMatchGeneration({
      matchId,
      fx,
      adminId,
      lockAtIso,
      count: opts?.count,
      instructions: opts?.instructions,
    }),
  );
  console.info("[live-gen started]", { adminId, matchId });
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
  count?: number;
  instructions?: string;
};

async function runMatchGeneration(args: MatchGenArgs): Promise<void> {
  const { matchId, fx, adminId, lockAtIso } = args;
  const subjectHe = `${fx.context.homeNameHe} נגד ${fx.context.awayNameHe}`;
  try {
    const [modelRow] = await db
      .select({ suggestModel: settings.suggestModel })
      .from(settings)
      .where(eq(settings.id, 1))
      .limit(1);

    // Assemble the match dossier (real API-Football data) + the questions
    // already live for this fixture (anti-repetition). Both feed the prompt;
    // a dossier failure is non-fatal — the generator falls back to a thin
    // prompt rather than blocking generation.
    const [dossierResult, existingQuestions] = await Promise.all([
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
    ]);

    const label =
      `${fx.context.homeNameEn} (HE: ${fx.context.homeNameHe}) vs ` +
      `${fx.context.awayNameEn} (HE: ${fx.context.awayNameHe}). ` +
      `Stage: ${fx.context.stage}. Kickoff: ${fx.context.kickoffLabel}.`;

    const gen = await generateSuggestions({ scope: "match", label }, modelRow?.suggestModel, {
      count: args.count,
      instructions: args.instructions,
      dossierText: dossierResult ? renderDossier(dossierResult.dossier) : undefined,
      validPlayerIds: dossierResult?.validPlayerIds,
      existingQuestions,
      // The user chose focused web search (1-3). 3 is the clamp ceiling; the
      // model searches only when the request actually needs current info.
      webSearchMaxUses: 3,
    });
    if (!gen.ok) {
      console.warn("[live-gen bg gen failed]", { matchId, error: gen.error });
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
    revalidatePath("/[lang]/admin/bets", "page");
    revalidatePath("/[lang]/admin/live-bets/suggestions", "page");
    await notifyGenerationDone(adminId, { subjectHe, created, failed, failedGen: false });
  } catch (err) {
    console.error("[live-gen bg crashed]", { matchId, err });
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
  after(() =>
    runDayGeneration({
      date,
      fixtures: fixturesSnapshot,
      adminId,
      lockAtIso,
      count: opts?.count,
      instructions: opts?.instructions,
    }),
  );
  console.info("[live-gen-day started]", { adminId, date, fixtures: schedulable.length });
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
  count?: number;
  instructions?: string;
};

// The heavy half of generateDaySuggestions, run after the response is sent.
async function runDayGeneration(args: DayGenArgs): Promise<void> {
  const { date, fixtures, adminId, lockAtIso } = args;
  const subjectHe = `יום המשחקים ${date}`;
  try {
    const [modelRow] = await db
      .select({ suggestModel: settings.suggestModel })
      .from(settings)
      .where(eq(settings.id, 1))
      .limit(1);

    const dossierInputs: DossierInput[] = fixtures.map((f) => ({
      matchId: f.id,
      homeCode: f.homeCode,
      homeNameHe: f.homeNameHe,
      homeNameEn: f.homeNameEn,
      awayCode: f.awayCode,
      awayNameHe: f.awayNameHe,
      awayNameEn: f.awayNameEn,
    }));

    const [dayDossier, existingQuestions] = await Promise.all([
      buildDayDossier(dossierInputs).catch((err) => {
        console.error("[live-gen day dossier failed]", { date, err });
        return null;
      }),
      loadExistingDayQuestions(date),
    ]);

    const fixtureList = fixtures.map((f) => `${f.homeNameEn} vs ${f.awayNameEn}`).join(", ");
    const label =
      `All ${fixtures.length} matches on ${formatDayLabel(date)} (Asia/Jerusalem): ${fixtureList}.`;

    const gen = await generateSuggestions({ scope: "day", label }, modelRow?.suggestModel, {
      count: args.count,
      instructions: args.instructions,
      dossierText: dayDossier ? renderDayDossier(dayDossier.fixtures) : undefined,
      validPlayerIds: dayDossier?.validPlayerIds,
      existingQuestions,
      webSearchMaxUses: 3,
    });
    if (!gen.ok) {
      console.warn("[live-gen-day bg gen failed]", { date, error: gen.error });
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
        // Day scope can't anchor the events grader (no single matchId), so it
        // settles manually regardless of what the model proposed.
        gradingSource: "manual",
        gradingConfig: null,
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
    revalidatePath("/[lang]/admin/bets", "page");
    revalidatePath("/[lang]/admin/live-bets/suggestions", "page");
    await notifyGenerationDone(adminId, { subjectHe, created, failed, failedGen: false });
  } catch (err) {
    console.error("[live-gen-day bg crashed]", { date, err });
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
