"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  customBets,
  matches as matchesTable,
  groups,
} from "@/db/schema";
import { getUser } from "@/lib/supabase/auth";
import { isAdmin } from "@/lib/admin";
import type {
  AnswerConfig,
  GradingConfig,
} from "@/lib/bets/types";

// Discriminated result so the client can branch on the error string.
type Err =
  | "unauth"
  | "forbidden"
  | "invalid_scope_anchor"
  | "invalid_question"
  | "invalid_grading_rule"
  | "invalid_stake_payout"
  | "invalid_answer_config"
  | "invalid_grading_config"
  | "invalid_lock_at"
  | "match_not_found"
  | "group_not_found"
  | "bet_not_found"
  | "invalid_status"
  | "db";

export type CreateCustomBetInput = {
  scope: "match" | "day" | "stage" | "group" | "tournament";
  // Anchor IDs — exactly the set required by `scope` must be provided.
  matchId?: string | null;
  // Day-scope can either anchor on a YYYY-MM-DD date (Asia/Jerusalem) or
  // on the matchday derived from `matchId` (server figures it out).
  matchdayDate?: string | null;
  stage?: "group" | "r32" | "r16" | "qf" | "sf" | "third_place" | "final" | null;
  groupId?: string | null;

  questionHe: string;
  questionEn: string;
  gradingRuleHe: string;
  gradingRuleEn: string;

  answerType: "yes_no" | "number" | "multi_choice" | "free_text";
  answerConfig: AnswerConfig;

  stakeSnapshot: number;
  payoutSnapshot: number;

  gradingSource: "auto_balldontlie" | "auto_football_data" | "manual";
  gradingConfig: GradingConfig;

  lockAt: string; // ISO 8601
};

export type CreateCustomBetResult =
  | { ok: true; id: string }
  | { ok: false; error: Err };

export async function createCustomBet(
  input: CreateCustomBetInput,
): Promise<CreateCustomBetResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauth" };
  if (!(await isAdmin(user.id))) {
    console.warn("[bet create denied]", { userId: user.id });
    return { ok: false, error: "forbidden" };
  }

  // 1) Scope ↔ anchor consistency. Mirrors the DB CHECK constraint so we
  // can return a clean error before the constraint fires.
  const v = validateScopeAnchors(input);
  if (v !== "ok") return { ok: false, error: v };

  // 2) Plain-text fields. The CHECK enforces ≥3 chars on grading rule and
  // ≥1 on question, but we want a friendlier client error.
  if (input.questionHe.trim().length === 0 || input.questionEn.trim().length === 0) {
    return { ok: false, error: "invalid_question" };
  }
  if (input.gradingRuleHe.trim().length < 3 || input.gradingRuleEn.trim().length < 3) {
    return { ok: false, error: "invalid_grading_rule" };
  }

  // 3) Pricing.
  if (
    !Number.isInteger(input.stakeSnapshot) ||
    !Number.isInteger(input.payoutSnapshot) ||
    input.stakeSnapshot < 0 ||
    input.payoutSnapshot <= 0
  ) {
    return { ok: false, error: "invalid_stake_payout" };
  }

  // 4) Answer config shape ↔ answer type.
  if (!validateAnswerConfig(input.answerType, input.answerConfig)) {
    return { ok: false, error: "invalid_answer_config" };
  }

  // 5) Grading config shape ↔ grading source.
  if (!validateGradingConfig(input.gradingSource, input.gradingConfig)) {
    return { ok: false, error: "invalid_grading_config" };
  }

  // 6) lockAt must be a parseable date and in the future.
  const lockAtDate = new Date(input.lockAt);
  if (Number.isNaN(lockAtDate.getTime()) || lockAtDate.getTime() <= Date.now()) {
    return { ok: false, error: "invalid_lock_at" };
  }

  // 7) Resolve matchday for match / day scopes.
  let matchdayId: string | null = null;
  try {
    if (input.scope === "match" && input.matchId) {
      const [m] = await db
        .select({ id: matchesTable.id, kickoff: matchesTable.kickoffAt })
        .from(matchesTable)
        .where(eq(matchesTable.id, input.matchId))
        .limit(1);
      if (!m) return { ok: false, error: "match_not_found" };
      matchdayId = await upsertMatchdayFromKickoff(m.kickoff);
    } else if (input.scope === "day" && input.matchdayDate) {
      matchdayId = await upsertMatchdayByDate(input.matchdayDate);
    } else if (input.scope === "group" && input.groupId) {
      const [g] = await db
        .select({ id: groups.id })
        .from(groups)
        .where(eq(groups.id, input.groupId))
        .limit(1);
      if (!g) return { ok: false, error: "group_not_found" };
    }
  } catch (err) {
    console.error("[bet create] anchor resolve failed:", err);
    return { ok: false, error: "db" };
  }

  // 8) Insert.
  try {
    const [row] = await db
      .insert(customBets)
      .values({
        scope: input.scope,
        matchdayId,
        matchId: input.scope === "match" ? input.matchId : null,
        stage: input.scope === "stage" ? input.stage : null,
        groupId: input.scope === "group" ? input.groupId : null,
        questionHe: input.questionHe.trim(),
        questionEn: input.questionEn.trim(),
        gradingRuleHe: input.gradingRuleHe.trim(),
        gradingRuleEn: input.gradingRuleEn.trim(),
        answerType: input.answerType,
        answerConfig: input.answerConfig,
        stakeSnapshot: input.stakeSnapshot,
        payoutSnapshot: input.payoutSnapshot,
        gradingSource: input.gradingSource,
        gradingConfig: input.gradingConfig,
        status: "draft",
        lockAt: lockAtDate,
        createdBy: user.id,
      })
      .returning({ id: customBets.id });

    console.info("[bet create]", {
      id: row.id,
      scope: input.scope,
      answerType: input.answerType,
      stake: input.stakeSnapshot,
      payout: input.payoutSnapshot,
      gradingSource: input.gradingSource,
      createdBy: user.id,
    });

    revalidatePath("/[lang]/admin/bets", "page");
    return { ok: true, id: row.id };
  } catch (err) {
    console.error("[bet create] insert failed:", err);
    return { ok: false, error: "db" };
  }
}

export type PublishCustomBetResult =
  | { ok: true }
  | { ok: false; error: Err };

// Flip a bet from draft → open so players can see + pick it. Idempotent on
// already-open bets (no-op + ok). Anything past 'open' (locked, graded,
// etc.) is rejected so the admin can't "un-lock" a live bet by accident.
export async function publishCustomBet(
  id: string,
): Promise<PublishCustomBetResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauth" };
  if (!(await isAdmin(user.id))) {
    console.warn("[bet publish denied]", { userId: user.id, id });
    return { ok: false, error: "forbidden" };
  }

  try {
    const [row] = await db
      .select({ status: customBets.status, lockAt: customBets.lockAt })
      .from(customBets)
      .where(eq(customBets.id, id))
      .limit(1);
    if (!row) return { ok: false, error: "bet_not_found" };
    if (row.status === "open") return { ok: true };
    if (row.status !== "draft") {
      return { ok: false, error: "invalid_status" };
    }

    await db
      .update(customBets)
      .set({
        status: "open",
        publishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(customBets.id, id), eq(customBets.status, "draft")));

    console.info("[bet publish]", { id, lockAt: row.lockAt, by: user.id });
    revalidatePath("/[lang]/admin/bets", "page");
    return { ok: true };
  } catch (err) {
    console.error("[bet publish] failed:", err);
    return { ok: false, error: "db" };
  }
}

// Soft-cancel a bet. If it was draft → moves straight to cancelled.
// If it was open/locked with picks → also moves to cancelled; the grading
// pass should refund stakes when it sees status='cancelled'. (Refund loop
// lands with the grading pipeline in a follow-up commit.)
export async function cancelCustomBet(
  id: string,
): Promise<{ ok: true } | { ok: false; error: Err }> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauth" };
  if (!(await isAdmin(user.id))) {
    console.warn("[bet cancel denied]", { userId: user.id, id });
    return { ok: false, error: "forbidden" };
  }

  try {
    const [row] = await db
      .select({ status: customBets.status })
      .from(customBets)
      .where(eq(customBets.id, id))
      .limit(1);
    if (!row) return { ok: false, error: "bet_not_found" };
    if (row.status === "graded" || row.status === "cancelled") {
      return { ok: false, error: "invalid_status" };
    }

    await db
      .update(customBets)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(customBets.id, id));

    console.info("[bet cancel]", { id, prevStatus: row.status, by: user.id });
    revalidatePath("/[lang]/admin/bets", "page");
    return { ok: true };
  } catch (err) {
    console.error("[bet cancel] failed:", err);
    return { ok: false, error: "db" };
  }
}

// ---------- helpers ----------

function validateScopeAnchors(input: CreateCustomBetInput): "ok" | Err {
  const has = {
    match: !!input.matchId,
    day: !!input.matchdayDate,
    stage: !!input.stage,
    group: !!input.groupId,
  };
  switch (input.scope) {
    case "match":
      // match-scope needs a matchId; matchday is derived server-side.
      return has.match && !has.stage && !has.group ? "ok" : "invalid_scope_anchor";
    case "day":
      return has.day && !has.match && !has.stage && !has.group
        ? "ok"
        : "invalid_scope_anchor";
    case "stage":
      return has.stage && !has.match && !has.day && !has.group
        ? "ok"
        : "invalid_scope_anchor";
    case "group":
      return has.group && !has.match && !has.day && !has.stage
        ? "ok"
        : "invalid_scope_anchor";
    case "tournament":
      return !has.match && !has.day && !has.stage && !has.group
        ? "ok"
        : "invalid_scope_anchor";
  }
}

function validateAnswerConfig(
  answerType: CreateCustomBetInput["answerType"],
  config: AnswerConfig,
): boolean {
  if (config.kind !== answerType) return false;
  if (config.kind === "multi_choice") {
    if (!Array.isArray(config.options) || config.options.length < 2) return false;
    // Every option must have a non-empty value + both labels.
    return config.options.every(
      (o) =>
        typeof o.value === "string" &&
        o.value.length > 0 &&
        typeof o.labelHe === "string" &&
        o.labelHe.length > 0 &&
        typeof o.labelEn === "string" &&
        o.labelEn.length > 0,
    );
  }
  return true;
}

function validateGradingConfig(
  source: CreateCustomBetInput["gradingSource"],
  config: GradingConfig,
): boolean {
  if (source === "manual") return config === null;
  if (!config) return false;
  if (source === "auto_balldontlie") {
    return (
      config.source === "auto_balldontlie" &&
      typeof config.stat === "string" &&
      config.stat.length > 0 &&
      ["sum_day", "per_match", "first_match"].includes(config.aggregate)
    );
  }
  if (source === "auto_football_data") {
    return (
      config.source === "auto_football_data" &&
      [
        "home_score",
        "away_score",
        "winner",
        "ht_score",
        "total_goals",
        "ht_total",
        "went_to_penalties",
      ].includes(config.field)
    );
  }
  return false;
}

// Find-or-create a matchday row keyed by the Asia/Jerusalem calendar date
// of the given kickoff timestamp. The PG `date` type is timezone-less, so
// we let PG do the conversion in-query rather than doing it in JS (avoids
// DST surprises).
async function upsertMatchdayFromKickoff(kickoffAt: Date): Promise<string> {
  const rows = await db.execute<{ id: string; date: string }>(sql`
    with d as (
      select (${kickoffAt.toISOString()}::timestamptz at time zone 'Asia/Jerusalem')::date as day
    ),
    inserted as (
      insert into public.matchdays (date)
      select day from d
      on conflict (date) do nothing
      returning id::text as id, date::text as date
    )
    select id, date from inserted
    union all
    select md.id::text, md.date::text
    from public.matchdays md, d
    where md.date = d.day
    limit 1
  `);
  const list = rows as unknown as Array<{ id: string; date: string }>;
  return list[0].id;
}

async function upsertMatchdayByDate(yyyymmdd: string): Promise<string> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(yyyymmdd)) {
    throw new Error(`invalid date string: ${yyyymmdd}`);
  }
  const rows = await db.execute<{ id: string }>(sql`
    with inserted as (
      insert into public.matchdays (date)
      values (${yyyymmdd}::date)
      on conflict (date) do nothing
      returning id::text as id
    )
    select id from inserted
    union all
    select md.id::text from public.matchdays md
    where md.date = ${yyyymmdd}::date
    limit 1
  `);
  const list = rows as unknown as Array<{ id: string }>;
  return list[0].id;
}
