import "server-only";

import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { execFirstRow, execRows } from "@/db/helpers";
import { customBets, profiles, settings } from "@/db/schema";
import { getDeadlineContext } from "@/lib/deadlines";
import { liveStakeCap, type OddsNormConfig } from "@/lib/odds-normalize";
import { generateSuggestions, type FixtureContext } from "./generate";
import { suggestionToDraft } from "./transform";

// Rules engine for the live-bet generator. A daily cron calls
// runLiveAutogen(); when the admin has switched the rule on, it finds every
// upcoming match inside the lead window that has NO custom bets yet and
// queues a batch of AI-generated DRAFTS for it. Nothing is published — the
// admin still approves each bet in /admin/bets.
//
// This is a server-only library (NOT a "use server" action) so the
// expensive LLM trigger can't be invoked from a browser; only the
// CRON_SECRET-gated route reaches it. custom_bets.created_by is NOT NULL,
// so system drafts are attributed to the earliest admin account.
//
// Idempotent: the "no existing custom bets for this match" filter means a
// re-run never double-seeds, and it leaves any match the admin has already
// touched (manually or via the Generate button) alone.

export type AutogenReport = {
  enabled: boolean;
  matchesEligible: number;
  matchesSeeded: number;
  matchesDeferred: number;
  draftsCreated: number;
  draftsFailed: number;
};

// A single generation takes ~30s (output-token bound). With the route's
// 60s function ceiling we can only finish one or two matches per run, so we
// stop seeding once this much wall-clock is spent and defer the rest to the
// next cron firing rather than risk the function being killed mid-insert.
const RUN_BUDGET_MS = 45_000;

export async function runLiveAutogen(): Promise<AutogenReport> {
  const startedAt = Date.now();
  const cfg = await loadAutogenConfig();
  if (!cfg.enabled) {
    console.info("[live-autogen] disabled");
    return { enabled: false, matchesEligible: 0, matchesSeeded: 0, matchesDeferred: 0, draftsCreated: 0, draftsFailed: 0 };
  }

  // custom_bets.created_by is NOT NULL; attribute system drafts to the
  // earliest admin. If there's no admin yet, there's no one to own or
  // approve the drafts — bail rather than guess.
  const createdBy = await firstAdminId();
  if (!createdBy) {
    console.warn("[live-autogen] no admin account to own drafts; skipping");
    return { enabled: true, matchesEligible: 0, matchesSeeded: 0, matchesDeferred: 0, draftsCreated: 0, draftsFailed: 0 };
  }

  const eligible = await listEligibleMatches(cfg.leadHours);
  let seeded = 0;
  let deferred = 0;
  let created = 0;
  let failed = 0;

  for (let i = 0; i < eligible.length; i += 1) {
    if (Date.now() - startedAt > RUN_BUDGET_MS) {
      // Out of wall-clock for this run; the soonest-first ordering means
      // we've covered the most urgent matches. The remaining ones are still
      // eligible (no bets yet) and get picked up on the next firing.
      deferred = eligible.length - i;
      console.warn("[live-autogen deferred]", { deferred, reason: "run budget exhausted" });
      break;
    }
    const res = await generateAndQueueForMatch(eligible[i], cfg.model, cfg.pricing, createdBy);
    if (res.created > 0) seeded += 1;
    created += res.created;
    failed += res.failed;
  }

  const report: AutogenReport = {
    enabled: true,
    matchesEligible: eligible.length,
    matchesSeeded: seeded,
    matchesDeferred: deferred,
    draftsCreated: created,
    draftsFailed: failed,
  };
  console.info("[live-autogen summary]", report);
  return report;
}

type EligibleMatch = {
  matchId: string;
  kickoffAt: Date;
  context: FixtureContext;
};

// Upcoming, not-yet-started matches inside the lead window that carry no
// custom bets at all. Ordered soonest-first so a capped run still covers
// the most imminent fixtures.
async function listEligibleMatches(leadHours: number): Promise<EligibleMatch[]> {
  const rows = await execRows<{
    matchId: string;
    kickoffAt: string;
    stage: string | null;
    homeNameHe: string;
    homeNameEn: string;
    awayNameHe: string;
    awayNameEn: string;
  }>(sql`
    select
      m.id::text         as "matchId",
      m.kickoff_at::text as "kickoffAt",
      m.stage::text      as "stage",
      ht.name_he         as "homeNameHe",
      ht.name_en         as "homeNameEn",
      at.name_he         as "awayNameHe",
      at.name_en         as "awayNameEn"
    from public.matches m
    join public.teams ht on ht.code = m.home_team
    join public.teams at on at.code = m.away_team
    where m.status = 'scheduled'
      and m.kickoff_at > now()
      and m.kickoff_at <= now() + (${leadHours} || ' hours')::interval
      and not exists (
        select 1 from public.custom_bets cb where cb.match_id = m.id
      )
    order by m.kickoff_at asc
  `);
  return rows.map((r) => ({
    matchId: r.matchId,
    kickoffAt: new Date(r.kickoffAt),
    context: {
      homeNameHe: r.homeNameHe,
      homeNameEn: r.homeNameEn,
      awayNameHe: r.awayNameHe,
      awayNameEn: r.awayNameEn,
      stage: r.stage ?? "Group Stage",
      kickoffLabel: formatKickoff(new Date(r.kickoffAt)),
    },
  }));
}

// Generate + queue drafts for one match. Shared shape with the admin
// Generate button, but system-owned (created_by null). Skips silently if
// the lock has already passed or the LLM returns nothing.
export async function generateAndQueueForMatch(
  m: EligibleMatch,
  modelId: string,
  pricing: OddsNormConfig,
  createdBy: string,
): Promise<{ created: number; failed: number }> {
  const lockAt = await resolveMatchLockAt(m.kickoffAt);
  if (lockAt.getTime() <= Date.now()) return { created: 0, failed: 0 };

  const gen = await generateSuggestions(m.context, modelId);
  if (!gen.ok) {
    console.warn("[live-autogen gen failed]", { matchId: m.matchId, error: gen.error });
    return { created: 0, failed: 0 };
  }

  const matchdayId = await upsertMatchday(m.kickoffAt);
  let created = 0;
  let failed = 0;

  for (const suggestion of gen.suggestions) {
    const draft = suggestionToDraft(suggestion, pricing);
    if ("error" in draft) {
      failed += 1;
      continue;
    }
    try {
      await db.insert(customBets).values({
        scope: "match",
        matchId: m.matchId,
        matchdayId,
        questionHe: draft.questionHe,
        questionEn: draft.questionEn,
        gradingRuleHe: draft.gradingRuleHe,
        gradingRuleEn: draft.gradingRuleEn,
        answerType: draft.answerType,
        answerConfig: draft.answerConfig,
        stakeSnapshot: draft.stakeSnapshot,
        payoutSnapshot: draft.payoutSnapshot,
        decimalOdds: null,
        gradingSource: draft.grading == null ? "manual" : draft.grading.source,
        gradingConfig: draft.grading,
        status: "draft",
        lockAt,
        createdBy,
      });
      created += 1;
    } catch (err) {
      failed += 1;
      console.error("[live-autogen insert failed]", { matchId: m.matchId, err });
    }
  }

  console.info("[live-autogen seeded]", {
    matchId: m.matchId,
    created,
    failed,
    total: gen.suggestions.length,
  });
  return { created, failed };
}

// ---------- config + helpers ----------

async function loadAutogenConfig(): Promise<{
  enabled: boolean;
  leadHours: number;
  model: string;
  pricing: OddsNormConfig;
}> {
  const [s] = await db
    .select({
      enabled: settings.liveAutogenEnabled,
      leadHours: settings.liveAutogenLeadHours,
      model: settings.suggestModel,
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
    enabled: s?.enabled ?? false,
    leadHours: s?.leadHours ?? 30,
    model: s?.model ?? "claude-sonnet-4-6",
    pricing: {
      baseStake,
      houseEdgePct: s?.houseEdgePct ?? 5,
      maxPayout: liveStakeCap(baseStake, {
        maxPayoutRatio: s?.ratio ?? 8,
        maxPayoutCeiling: s?.ceiling ?? 100,
      }),
    },
  };
}

// Match-scope lock = kickoff minus the custom_match offset from the
// deadlines table (same single source of truth the admin publish path
// uses), so cron-seeded drafts lock exactly like hand-published ones.
async function resolveMatchLockAt(kickoffAt: Date): Promise<Date> {
  const ctx = await getDeadlineContext();
  const offsetMinutes = ctx.defaults.custom_match;
  return new Date(kickoffAt.getTime() - offsetMinutes * 60_000);
}

async function upsertMatchday(kickoffAt: Date): Promise<string> {
  const row = await execFirstRow<{ id: string }>(sql`
    with d as (
      select (${kickoffAt.toISOString()}::timestamptz at time zone 'Asia/Jerusalem')::date as day
    ),
    inserted as (
      insert into public.matchdays (date)
      select day from d
      on conflict (date) do nothing
      returning id::text as id
    )
    select id from inserted
    union all
    select md.id::text from public.matchdays md, d where md.date = d.day
    limit 1
  `);
  if (!row) throw new Error("upsertMatchday: no row returned");
  return row.id;
}

async function firstAdminId(): Promise<string | null> {
  const [row] = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.role, "admin"))
    .orderBy(profiles.createdAt)
    .limit(1);
  return row?.id ?? null;
}

function formatKickoff(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}
