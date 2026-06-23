"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { execFirstRow } from "@/db/helpers";
import {
  betGradingAudit,
  customBets,
  matches as matchesTable,
  groups,
  settings,
  userCustomBetPicks,
} from "@/db/schema";
import { getUser } from "@/lib/supabase/auth";
import { hasPermission } from "@/lib/admin";
import { notifyUsers } from "@/lib/notifications";
import { listOpenLiveBetsForPush } from "@/db/admin-queries";
import {
  buildLiveBetPushText,
  liveBetAnchor,
  type LiveBetPushAnchor,
} from "@/lib/bets/live-bet-push";
import type {
  AnswerConfig,
  GradingConfig,
  ResolvedValue,
} from "@/lib/bets/types";
import { gradedPickPoints } from "@/lib/bets/payout";
import { reopenBlockedReason } from "@/lib/bets/reopen";
import {
  repriceAnswerConfigFromOdds,
  validateLiveOddsConfig,
} from "@/lib/bets/price-options";
import { liveStakeCap, type OddsNormConfig } from "@/lib/odds-normalize";

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
  // Anchor IDs - exactly the set required by `scope` must be provided.
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
  // Bookmaker decimal odds — required for live (match/day) bets so the
  // variable-stake submit path can recompute payout exactly per the
  // player's chosen stake; ignored (forced null) for free-pick scopes
  // (tournament/stage/group). Optional on input for backward compat with
  // legacy bets that pre-date the variable-stake feature; when omitted
  // for live scope the bet falls back to the linear-scale path in
  // write-core. See _plans/2026-06-11-variable-live-bet-stake.md.
  decimalOdds?: number | null;

  gradingSource: "auto_api_football" | "auto_football_data" | "manual";
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
  if (!(await hasPermission(user.id, "liveBets"))) {
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
  // decimal_odds is allowed only for live (match/day) scope and must be > 1
  // when supplied. Free-pick scopes (tournament/stage/group) must not carry
  // it — their per-option pricing comes from the outright curve and a
  // value here would mislead anyone reading the row later.
  if (input.decimalOdds != null) {
    if (input.scope !== "match" && input.scope !== "day") {
      return { ok: false, error: "invalid_stake_payout" };
    }
    if (!Number.isFinite(input.decimalOdds) || input.decimalOdds <= 1) {
      return { ok: false, error: "invalid_stake_payout" };
    }
  }

  // 4) Answer config shape ↔ answer type.
  if (!validateAnswerConfig(input.answerType, input.answerConfig)) {
    return { ok: false, error: "invalid_answer_config" };
  }
  // 4b) Any captured per-choice live odds must be real decimals (> 1).
  if (!validateLiveOddsConfig(input.answerConfig)) {
    return { ok: false, error: "invalid_answer_config" };
  }

  // 5) Grading config shape ↔ grading source.
  if (!validateGradingConfig(input.gradingSource, input.gradingConfig)) {
    return { ok: false, error: "invalid_grading_config" };
  }

  // 5b) Re-derive per-choice payouts from the odds server-side so a stale
  // or tampered client payout can never be the stored value. The odds are
  // the trusted input; the payout integers + bet-level snapshot are
  // recomputed from the canonical live pricing config.
  const priced = await repriceLiveBet(input);

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
        answerConfig: priced.answerConfig,
        stakeSnapshot: priced.stakeSnapshot,
        payoutSnapshot: priced.payoutSnapshot,
        // drizzle's `numeric` maps to JS string; store with 2dp to match
        // the column precision (see migration 0047). Only live scopes
        // get a value — validated above.
        decimalOdds:
          input.decimalOdds != null ? input.decimalOdds.toFixed(2) : null,
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

// Update an existing custom_bets row. Restricted to status='draft' so we
// never silently change a bet that friends have already picked on (the
// social contract is "the question stayed the same"). For open bets the
// admin's recourse is cancel + recreate, which makes the rewrite explicit.
export type UpdateCustomBetResult =
  | { ok: true }
  | { ok: false; error: Err };

export async function updateCustomBet(
  id: string,
  input: CreateCustomBetInput,
): Promise<UpdateCustomBetResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauth" };
  if (!(await hasPermission(user.id, "liveBets"))) {
    console.warn("[bet update denied]", { userId: user.id, id });
    return { ok: false, error: "forbidden" };
  }

  // Mirror create-side validation so the same form payload can be reused.
  const v = validateScopeAnchors(input);
  if (v !== "ok") return { ok: false, error: v };
  if (input.questionHe.trim().length === 0 || input.questionEn.trim().length === 0) {
    return { ok: false, error: "invalid_question" };
  }
  if (input.gradingRuleHe.trim().length < 3 || input.gradingRuleEn.trim().length < 3) {
    return { ok: false, error: "invalid_grading_rule" };
  }
  if (
    !Number.isInteger(input.stakeSnapshot) ||
    !Number.isInteger(input.payoutSnapshot) ||
    input.stakeSnapshot < 0 ||
    input.payoutSnapshot <= 0
  ) {
    return { ok: false, error: "invalid_stake_payout" };
  }
  // Same decimal_odds gate as create — scope must be match/day; value > 1.
  if (input.decimalOdds != null) {
    if (input.scope !== "match" && input.scope !== "day") {
      return { ok: false, error: "invalid_stake_payout" };
    }
    if (!Number.isFinite(input.decimalOdds) || input.decimalOdds <= 1) {
      return { ok: false, error: "invalid_stake_payout" };
    }
  }
  if (!validateAnswerConfig(input.answerType, input.answerConfig)) {
    return { ok: false, error: "invalid_answer_config" };
  }
  if (!validateLiveOddsConfig(input.answerConfig)) {
    return { ok: false, error: "invalid_answer_config" };
  }
  if (!validateGradingConfig(input.gradingSource, input.gradingConfig)) {
    return { ok: false, error: "invalid_grading_config" };
  }
  const priced = await repriceLiveBet(input);
  const lockAtDate = new Date(input.lockAt);
  if (Number.isNaN(lockAtDate.getTime()) || lockAtDate.getTime() <= Date.now()) {
    return { ok: false, error: "invalid_lock_at" };
  }

  // Status gate.
  try {
    const [existing] = await db
      .select({ status: customBets.status })
      .from(customBets)
      .where(eq(customBets.id, id))
      .limit(1);
    if (!existing) return { ok: false, error: "bet_not_found" };
    if (existing.status !== "draft") {
      return { ok: false, error: "invalid_status" };
    }
  } catch (err) {
    console.error("[bet update] read failed:", err);
    return { ok: false, error: "db" };
  }

  // Resolve anchor exactly like create does.
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
    console.error("[bet update] anchor resolve failed:", err);
    return { ok: false, error: "db" };
  }

  try {
    await db
      .update(customBets)
      .set({
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
        answerConfig: priced.answerConfig,
        stakeSnapshot: priced.stakeSnapshot,
        payoutSnapshot: priced.payoutSnapshot,
        decimalOdds:
          input.decimalOdds != null ? input.decimalOdds.toFixed(2) : null,
        gradingSource: input.gradingSource,
        gradingConfig: input.gradingConfig,
        lockAt: lockAtDate,
        updatedAt: new Date(),
      })
      .where(and(eq(customBets.id, id), eq(customBets.status, "draft")));

    console.info("[bet update]", {
      id,
      scope: input.scope,
      answerType: input.answerType,
      stake: input.stakeSnapshot,
      payout: input.payoutSnapshot,
      gradingSource: input.gradingSource,
      by: user.id,
    });

    revalidatePath("/[lang]/admin/bets", "page");
    revalidatePath(`/[lang]/admin/bets/${id}`, "page");
    return { ok: true };
  } catch (err) {
    console.error("[bet update] write failed:", err);
    return { ok: false, error: "db" };
  }
}

export type SetTemplateArchivedResult =
  | { ok: true }
  | { ok: false; error: Err };

// Flip a bet's template_archived flag so it stops surfacing in the
// template picker / quick-add chip strips. Does NOT touch the bet's
// status, score, picks or any player-visible field — purely admin-side
// catalog hygiene. Setting it back to false un-archives.
export async function setTemplateArchived(
  id: string,
  archived: boolean,
): Promise<SetTemplateArchivedResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauth" };
  if (!(await hasPermission(user.id, "liveBets"))) {
    console.warn("[template archive denied]", { userId: user.id, id });
    return { ok: false, error: "forbidden" };
  }

  try {
    const updated = await db
      .update(customBets)
      .set({ templateArchived: archived, updatedAt: new Date() })
      .where(eq(customBets.id, id))
      .returning({ id: customBets.id });
    if (updated.length === 0) return { ok: false, error: "bet_not_found" };

    console.info("[template archive]", { id, archived, by: user.id });

    // The picker mounts on /admin/bets/new + /admin/live-bets/suggestions
    // + /admin/bets/quick-add; bust all three so the flag flip is
    // visible without a hard refresh. The detail page revalidates so the
    // button label flips immediately.
    revalidatePath("/[lang]/admin/bets", "page");
    revalidatePath("/[lang]/admin/bets/new", "page");
    revalidatePath("/[lang]/admin/bets/quick-add", "page");
    revalidatePath("/[lang]/admin/live-bets/suggestions", "page");
    revalidatePath(`/[lang]/admin/bets/${id}`, "page");
    return { ok: true };
  } catch (err) {
    console.error("[template archive] update failed:", err);
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
  if (!(await hasPermission(user.id, "liveBets"))) {
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

// Soft-cancel a bet. Draft → straight to cancelled. open/locked with picks
// → cancelled AND every pick's stake is refunded in the same transaction by
// setting points_earned = stake_paid, so the pick nets to zero in every
// bank/leaderboard sum (all of which compute points_earned - stake_paid).
// Without this a cancelled bet silently kept the pickers' stake.
export async function cancelCustomBet(
  id: string,
): Promise<{ ok: true } | { ok: false; error: Err }> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauth" };
  if (!(await hasPermission(user.id, "liveBets"))) {
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

    await db.transaction(async (tx) => {
      await tx
        .update(customBets)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(eq(customBets.id, id));
      // Refund the stake on every still-ungraded pick (points_earned null).
      // points_earned = stake_paid nets the pick to zero everywhere the bank
      // is summed, so the picker is made whole without a separate pipeline.
      await tx
        .update(userCustomBetPicks)
        .set({ pointsEarned: sql`${userCustomBetPicks.stakePaid}`, updatedAt: new Date() })
        .where(
          and(
            eq(userCustomBetPicks.customBetId, id),
            sql`${userCustomBetPicks.pointsEarned} is null`,
          ),
        );
    });

    console.info("[bet cancel]", { id, prevStatus: row.status, by: user.id });
    // Every surface that filters on status in ('open','locked') needs to drop
    // the cancelled row. Without these, router.refresh() returns cached RSC
    // output and the row "comes back" for one frame before the next manual
    // navigation.
    revalidatePath("/[lang]/admin/bets", "page");
    revalidatePath("/[lang]/admin/bets/duplicates", "page");
    revalidatePath("/[lang]/admin", "page");
    revalidatePath("/[lang]/bets/tournament", "page");
    return { ok: true };
  } catch (err) {
    console.error("[bet cancel] failed:", err);
    return { ok: false, error: "db" };
  }
}

export type VoidCustomBetResult =
  | { ok: true; picksRefunded: number; recipients: number }
  | { ok: false; error: GradeErr };

// Cancel a live bet and refund the stake to EVERY picker — including when the
// bet was already graded. The driving case: a player prop ("will X score")
// where the player never took the field, so the auto cron already graded it
// "no" and paid the wrong side. One click unwinds the whole thing: refund all
// picks, write an audit row, close the bet as cancelled, and drop a feed
// notice to each picker.
//
// Difference from cancelCustomBet: that one is the list's quick, no-reason
// cancel and is ungraded-only (it rejects 'graded'). This one requires a
// reason and accepts a graded bet — it is the corrective action surfaced on
// the bet detail page.
//
// Refund mechanic (same primitive cancelCustomBet uses, applied to ALL picks):
// set points_earned = stake_paid on every pick. The bank formula sums
// points_earned - stake_paid, so each pick nets to exactly zero and the picker
// is made whole, win or lose, graded or not. No pick row is ever deleted —
// "user bets are SACRED".
export async function voidCustomBet(
  id: string,
  reason: string,
): Promise<VoidCustomBetResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauth" };
  if (!(await hasPermission(user.id, "liveBets"))) {
    console.warn("[bet void denied]", { userId: user.id, id });
    return { ok: false, error: "forbidden" };
  }

  const trimmedReason = reason.trim();
  if (trimmedReason.length < 3) {
    return { ok: false, error: "invalid_reason" };
  }

  try {
    const result = await db.transaction(async (tx) => {
      const [bet] = await tx
        .select({
          status: customBets.status,
          resolvedValue: customBets.resolvedValue,
          questionHe: customBets.questionHe,
        })
        .from(customBets)
        .where(eq(customBets.id, id))
        .limit(1);

      if (!bet) return { ok: false as const, error: "bet_not_found" as const };
      // Already cancelled → nothing to void. Every other status (draft / open /
      // locked / graded / reversed) is a valid void target.
      if (bet.status === "cancelled") {
        return { ok: false as const, error: "invalid_status" as const };
      }

      // Refund every pick. Setting points_earned = stake_paid nets the pick to
      // zero in the bank formula; it also overwrites a graded pick's payout, so
      // a wrongly auto-graded prop is fully unwound for both sides.
      const refunded = await tx
        .update(userCustomBetPicks)
        .set({
          pointsEarned: sql`${userCustomBetPicks.stakePaid}`,
          updatedAt: new Date(),
        })
        .where(eq(userCustomBetPicks.customBetId, id))
        .returning({ userId: userCustomBetPicks.userId });

      await tx.insert(betGradingAudit).values({
        customBetId: id,
        action: "cancel",
        previousStatus: bet.status,
        newStatus: "cancelled",
        previousResolvedValue: bet.resolvedValue as unknown,
        newResolvedValue: null,
        reason: trimmedReason,
        performedBy: user.id,
      });

      await tx
        .update(customBets)
        .set({
          status: "cancelled",
          resolvedValue: null,
          gradedAt: null,
          gradedBy: null,
          updatedAt: new Date(),
        })
        .where(eq(customBets.id, id));

      // One pick per (user, bet) by unique index, so distinct users == picks.
      return {
        ok: true as const,
        prevStatus: bet.status,
        questionHe: bet.questionHe,
        pickerIds: [...new Set(refunded.map((r) => r.userId))],
      };
    });

    if (!result.ok) return result;

    // Feed-only notice to each picker, AFTER the refund has committed. Strictly
    // best-effort: the refund is the contract, the notice is a courtesy, so a
    // notify failure is logged and swallowed and never rolls the refund back.
    // push:false per the agreed scope — a cancellation does not buzz phones.
    let recipients = 0;
    if (result.pickerIds.length > 0) {
      try {
        const notice = await notifyUsers(
          { kind: "users", userIds: result.pickerIds },
          {
            kind: "bet_cancelled",
            title: "הימור בוטל",
            body: `ההימור "${result.questionHe}" בוטל והנקודות שהימרת הוחזרו לך.`,
            url: "/he/bets/live",
            push: false,
            createdBy: user.id,
          },
        );
        recipients = notice.inserted;
      } catch (err) {
        console.error(
          "[bet void] notify failed (refund already committed):",
          err,
        );
      }
    }

    console.info("[bet void]", {
      id,
      prevStatus: result.prevStatus,
      picksRefunded: result.pickerIds.length,
      recipients,
      by: user.id,
    });
    revalidatePath("/[lang]/admin/bets", "page");
    revalidatePath(`/[lang]/admin/bets/${id}`, "page");
    revalidatePath("/[lang]/play", "layout");
    revalidatePath("/[lang]/leaderboard", "page");
    revalidatePath("/[lang]/bets/tournament", "page");
    return {
      ok: true,
      picksRefunded: result.pickerIds.length,
      recipients,
    };
  } catch (err) {
    console.error("[bet void] failed:", err);
    return { ok: false, error: "db" };
  }
}

// Announce one or more freshly-published live bets to the players via
// push. Manual / batch only — there is no auto-on-publish path. The
// admin selects open live bets in the composer; this builds a single
// "match name + count" push grouped per anchor and fans it out to every
// push-opted-in player. Gated to the liveBets permission (admins
// included), same as publish / cancel above.
export type SendLiveBetPushResult =
  | { ok: true; recipients: number; pushSent: number }
  | {
      ok: false;
      error: "unauth" | "forbidden" | "invalid_input" | "no_valid_bets" | "db";
    };

export async function sendLiveBetPush(
  betIds: string[],
  locale: "he" | "en" = "he",
): Promise<SendLiveBetPushResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauth" };
  if (!(await hasPermission(user.id, "liveBets"))) {
    console.warn("[live bet push denied]", { userId: user.id });
    return { ok: false, error: "forbidden" };
  }

  // Cap the selection so a tampered request can't fan a 10k-line body out
  // to every device. 50 covers any realistic matchday.
  if (!Array.isArray(betIds) || betIds.length === 0 || betIds.length > 50) {
    return { ok: false, error: "invalid_input" };
  }
  const wanted = new Set(
    betIds.filter((id) => typeof id === "string" && id.length > 0),
  );
  if (wanted.size === 0) return { ok: false, error: "invalid_input" };

  try {
    // Re-read the canonical open-live list and keep only the selected
    // ids. This is the authorization boundary for WHAT can be pushed:
    // a draft / locked / tournament / duel id simply won't be in the set,
    // so it can never ride into the announcement.
    const open = await listOpenLiveBetsForPush(200);
    const selected = open.filter((b) => wanted.has(b.id));
    if (selected.length === 0) return { ok: false, error: "no_valid_bets" };

    const anchors: LiveBetPushAnchor[] = selected.map((b) =>
      liveBetAnchor(
        {
          scope: b.scope,
          matchId: b.matchId,
          homeName: locale === "he" ? b.homeNameHe : b.homeNameEn,
          awayName: locale === "he" ? b.awayNameHe : b.awayNameEn,
          matchdayDate: b.matchdayDate,
        },
        locale,
      ),
    );

    const text = buildLiveBetPushText(anchors, locale);
    if (!text) return { ok: false, error: "no_valid_bets" };

    const res = await notifyUsers(
      { kind: "all-opted-in" },
      {
        kind: "live_bet",
        title: text.title,
        body: text.body,
        url: `/${locale}/bets/live`,
        push: true,
        createdBy: user.id,
      },
    );
    console.info("[live bet push]", {
      by: user.id,
      bets: selected.length,
      recipients: res.recipients,
      pushSent: res.pushSent,
    });
    return { ok: true, recipients: res.recipients, pushSent: res.pushSent };
  } catch (err) {
    console.error("[live bet push] failed:", err);
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
  if (source === "auto_api_football") {
    if (config.source !== "auto_api_football") return false;
    // Three shapes share this source: the stats path (stat + aggregate), the
    // event-timeline path (events spec), and the first-event-window
    // distribution (firstEventWindow spec). Discriminate on which is set.
    if ("events" in config && config.events) {
      return validateEventSpec(config.events);
    }
    if ("firstEventWindow" in config && config.firstEventWindow) {
      return validateFirstEventWindowSpec(config.firstEventWindow);
    }
    if ("comeback" in config && config.comeback) {
      return validateComebackSpec(config.comeback);
    }
    if ("stat" in config) {
      return (
        typeof config.stat === "string" &&
        config.stat.length > 0 &&
        ["sum_day", "per_match", "first_match"].includes(config.aggregate)
      );
    }
    return false;
  }
  if (source === "auto_football_data") {
    // Must stay in sync with AutoFootballDataConfig.field in
    // src/lib/bets/types.ts and the resolver branches in
    // src/lib/sync.ts (coerceMatchField). Adding a field in only one
    // place quietly rejects every bet that uses it as
    // "invalid_grading_config", which is exactly what just happened on
    // 2026-06-11 when btts/over_X/halves/clean_sheet were added to the
    // type + resolver + form but not here.
    return (
      config.source === "auto_football_data" &&
      [
        // Raw values from the final match row.
        "home_score",
        "away_score",
        "winner",
        "ht_score",
        "total_goals",
        "ht_total",
        "went_to_penalties",
        // Derived yes/no fields.
        "btts",
        "home_scored",
        "away_scored",
        "clean_sheet_home",
        "clean_sheet_away",
        "first_half_goal",
        "second_half_goal",
        "both_halves_scored",
        "over_0_5_goals",
        "over_1_5_goals",
        "over_2_5_goals",
        "over_3_5_goals",
        "over_4_5_goals",
        // Derived numeric fields.
        "winning_margin",
        "second_half_total",
      ].includes(config.field)
    );
  }
  return false;
}

// Validate an event-timeline grading spec (red-in-half, goal-in-window).
// Mirrors the shape in src/lib/bets/events-grade.ts so a malformed spec is
// rejected at author time rather than silently skipped at grade time.
function validateEventSpec(spec: unknown): boolean {
  if (!spec || typeof spec !== "object") return false;
  const s = spec as {
    metric?: unknown;
    window?: unknown;
    op?: unknown;
    value?: unknown;
    team?: unknown;
  };
  const metrics = ["red_card", "yellow_card", "card", "goal", "penalty", "substitution", "var"];
  const ops = [">=", ">", "=", "<=", "<"];
  if (typeof s.metric !== "string" || !metrics.includes(s.metric)) return false;
  if (typeof s.op !== "string" || !ops.includes(s.op)) return false;
  if (typeof s.value !== "number" || !Number.isFinite(s.value)) return false;
  if (s.team !== undefined && !["home", "away", "any"].includes(s.team as string)) {
    return false;
  }
  const w = s.window;
  if (w === "1H" || w === "2H" || w === "FT") return true;
  if (typeof w === "object" && w !== null) {
    const o = w as { fromMinute?: unknown; toMinute?: unknown };
    return typeof o.fromMinute === "number" && typeof o.toMinute === "number";
  }
  return false;
}

// Validate a first-event-window grading spec (which window did the first
// goal/card/substitution fall in). The windows live in the bet's
// multi_choice options, so the spec itself only carries the metric and
// optional team/player narrowing. Mirrors FirstEventWindowSpec in
// src/lib/bets/events-grade.ts.
function validateFirstEventWindowSpec(spec: unknown): boolean {
  if (!spec || typeof spec !== "object") return false;
  const s = spec as {
    metric?: unknown;
    team?: unknown;
    playerApiId?: unknown;
    byAssist?: unknown;
  };
  const metrics = ["goal", "yellow_card", "red_card", "card", "penalty", "substitution"];
  if (typeof s.metric !== "string" || !metrics.includes(s.metric)) return false;
  if (s.team !== undefined && !["home", "away", "any"].includes(s.team as string)) {
    return false;
  }
  if (
    s.playerApiId !== undefined &&
    (typeof s.playerApiId !== "number" || !Number.isInteger(s.playerApiId) || s.playerApiId < 1)
  ) {
    return false;
  }
  if (s.byAssist !== undefined && typeof s.byAssist !== "boolean") return false;
  return true;
}

// Validate a comeback grading spec (lead-then-lose). Only an optional team
// narrowing. Mirrors ComebackSpec in src/lib/bets/events-grade.ts.
function validateComebackSpec(spec: unknown): boolean {
  if (!spec || typeof spec !== "object") return false;
  const s = spec as { team?: unknown };
  if (s.team !== undefined && !["home", "away", "any"].includes(s.team as string)) {
    return false;
  }
  return true;
}

// Re-derive a live bet's per-choice payouts from its captured odds using
// the canonical pricing config, returning the rewritten answer config plus
// the bet-level stake/payout snapshot. Non-live scopes and bets without
// captured odds pass through untouched. Centralises the "server owns the
// payout math" rule (rule 13) so the manual form, the suggestions page,
// and the future LLM path all persist the same numbers.
async function repriceLiveBet(input: CreateCustomBetInput): Promise<{
  answerConfig: AnswerConfig;
  stakeSnapshot: number;
  payoutSnapshot: number;
}> {
  const isLive = input.scope === "match" || input.scope === "day";
  const cfg = input.answerConfig;
  const hasOdds =
    (cfg.kind === "multi_choice" && !!cfg.decimalOddsByValue) ||
    (cfg.kind === "yes_no" &&
      (cfg.decimalOddsYes !== undefined || cfg.decimalOddsNo !== undefined));
  if (!isLive || !hasOdds) {
    return {
      answerConfig: input.answerConfig,
      stakeSnapshot: input.stakeSnapshot,
      payoutSnapshot: input.payoutSnapshot,
    };
  }
  const pricing = await loadLivePricingConfig();
  const { config, maxPayout } = repriceAnswerConfigFromOdds(input.answerConfig, pricing);
  return {
    answerConfig: config,
    stakeSnapshot: maxPayout != null ? pricing.baseStake : input.stakeSnapshot,
    payoutSnapshot: maxPayout ?? input.payoutSnapshot,
  };
}

// Load the canonical live pricing config (baseStake / cap / house edge)
// from settings. Mirrors the cap math the user-facing bet card uses, so
// the snapshot payout the server stores equals what a player sees at the
// default stake pill.
async function loadLivePricingConfig(): Promise<OddsNormConfig> {
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

// Find-or-create a matchday row keyed by the Asia/Jerusalem calendar date
// of the given kickoff timestamp. The PG `date` type is timezone-less, so
// we let PG do the conversion in-query rather than doing it in JS (avoids
// DST surprises).
async function upsertMatchdayFromKickoff(kickoffAt: Date): Promise<string> {
  const row = await execFirstRow<{ id: string; date: string }>(sql`
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
  if (!row) {
    throw new Error("upsertMatchdayFromKickoff: no row returned from CTE");
  }
  return row.id;
}

// ---------- grading ----------

type GradeErr =
  | "unauth"
  | "forbidden"
  | "bet_not_found"
  | "invalid_status"
  | "invalid_resolved_value"
  | "invalid_reason"
  | "db";

export type GradeCustomBetResult =
  | { ok: true; picksGraded: number; winners: number }
  | { ok: false; error: GradeErr };

// Manually grade a bet. Atomic:
//   1. Verify status is open / locked / reversed (NOT draft / graded / cancelled).
//   2. Validate resolved_value shape against answer_type + config.
//   3. Insert bet_grading_audit row (action='grade').
//   4. For each pick: set points_earned (payoutSnapshot if correct, else 0)
//      and was_correct. The grading rules per answer type:
//        yes_no       → pick.value === resolved.value (boolean)
//        number       → pick.value === resolved.value (exact integer)
//        multi_choice → pick.value === resolved.value (string)
//        free_text    → pick.value.trim().toLowerCase() === resolved.value.trim().toLowerCase()
//   5. Flip custom_bets.status='graded', set resolved_value + graded_at + graded_by.
//
// The pick payouts land in user_custom_bet_picks.points_earned, which the
// bank formula already reads. No second hop needed.
export async function gradeCustomBet(
  id: string,
  resolvedValue: ResolvedValue,
  reason: string,
): Promise<GradeCustomBetResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauth" };
  if (!(await hasPermission(user.id, "liveBets"))) {
    console.warn("[bet grade denied]", { userId: user.id, id });
    return { ok: false, error: "forbidden" };
  }

  const trimmedReason = reason.trim();
  if (trimmedReason.length < 3) {
    return { ok: false, error: "invalid_reason" };
  }

  try {
    const result = await db.transaction(async (tx) => {
      const [bet] = await tx
        .select({
          id: customBets.id,
          status: customBets.status,
          answerType: customBets.answerType,
          answerConfig: customBets.answerConfig,
          payoutSnapshot: customBets.payoutSnapshot,
          resolvedValue: customBets.resolvedValue,
        })
        .from(customBets)
        .where(eq(customBets.id, id))
        .limit(1);

      if (!bet) return { ok: false as const, error: "bet_not_found" as const };
      if (
        bet.status !== "open" &&
        bet.status !== "locked" &&
        bet.status !== "reversed"
      ) {
        return { ok: false as const, error: "invalid_status" as const };
      }
      if (!validateResolvedValue(bet.answerType, bet.answerConfig as unknown, resolvedValue)) {
        return { ok: false as const, error: "invalid_resolved_value" as const };
      }

      // Audit BEFORE the data flip so we keep a record even if a later
      // statement fails and rolls back.
      await tx.insert(betGradingAudit).values({
        customBetId: id,
        action: "grade",
        previousStatus: bet.status,
        newStatus: "graded",
        previousResolvedValue: bet.resolvedValue as unknown,
        newResolvedValue: resolvedValue,
        reason: trimmedReason,
        performedBy: user.id,
      });

      // Credit picks. We pull them inside the txn so a pick written
      // between SELECT and UPDATE still gets graded (advisory locks on
      // submission already serialise concurrent writes per user).
      //
      // payoutSnapshot pulled per-pick: outright bets price each option
      // individually (Mbappé pays 7, longshot pays 25). Pre-migration
      // rows have NULL payoutSnapshot — gradedPickPoints falls back to
      // the bet-level payout for those.
      const picks = await tx
        .select({
          id: userCustomBetPicks.id,
          answer: userCustomBetPicks.answer,
          payoutSnapshot: userCustomBetPicks.payoutSnapshot,
        })
        .from(userCustomBetPicks)
        .where(eq(userCustomBetPicks.customBetId, id));

      let winners = 0;
      for (const pk of picks) {
        const correct = isPickCorrect(
          bet.answerType,
          pk.answer as unknown,
          resolvedValue,
        );
        if (correct) winners += 1;
        const points = gradedPickPoints({
          correct,
          pickPayoutSnapshot: pk.payoutSnapshot,
          betLevelPayout: bet.payoutSnapshot,
        });
        await tx
          .update(userCustomBetPicks)
          .set({
            pointsEarned: points,
            wasCorrect: correct,
            locked: true,
            updatedAt: new Date(),
          })
          .where(eq(userCustomBetPicks.id, pk.id));
      }

      await tx
        .update(customBets)
        .set({
          status: "graded",
          resolvedValue,
          gradedAt: new Date(),
          gradedBy: user.id,
          updatedAt: new Date(),
        })
        .where(eq(customBets.id, id));

      return {
        ok: true as const,
        picksGraded: picks.length,
        winners,
      };
    });

    if (result.ok) {
      console.info("[grading manual]", {
        id,
        picksGraded: result.picksGraded,
        winners: result.winners,
        by: user.id,
      });
      revalidatePath("/[lang]/admin/bets", "page");
      revalidatePath("/[lang]/play", "layout");
      revalidatePath("/[lang]/leaderboard", "page");
      return { ok: true, picksGraded: result.picksGraded, winners: result.winners };
    }
    return result;
  } catch (err) {
    console.error("[grading manual] failed:", err);
    return { ok: false, error: "db" };
  }
}

export type ReverseGradingResult =
  | { ok: true; picksReverted: number }
  | { ok: false; error: GradeErr };

// Undo a grading. Sets each pick's points_earned back to NULL (and clears
// was_correct), flips bet status → 'reversed', clears resolved_value, and
// inserts an audit row. The picks' stake_paid is preserved - only the
// payout is reversed - so the bank formula naturally re-debits the stakes
// when payouts disappear.
export async function reverseCustomBetGrading(
  id: string,
  reason: string,
): Promise<ReverseGradingResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauth" };
  if (!(await hasPermission(user.id, "liveBets"))) {
    console.warn("[bet reverse denied]", { userId: user.id, id });
    return { ok: false, error: "forbidden" };
  }

  const trimmedReason = reason.trim();
  if (trimmedReason.length < 3) {
    return { ok: false, error: "invalid_reason" };
  }

  try {
    const result = await db.transaction(async (tx) => {
      const [bet] = await tx
        .select({
          id: customBets.id,
          status: customBets.status,
          resolvedValue: customBets.resolvedValue,
        })
        .from(customBets)
        .where(eq(customBets.id, id))
        .limit(1);

      if (!bet) return { ok: false as const, error: "bet_not_found" as const };
      if (bet.status !== "graded") {
        return { ok: false as const, error: "invalid_status" as const };
      }

      await tx.insert(betGradingAudit).values({
        customBetId: id,
        action: "reverse",
        previousStatus: "graded",
        newStatus: "reversed",
        previousResolvedValue: bet.resolvedValue as unknown,
        newResolvedValue: null,
        reason: trimmedReason,
        performedBy: user.id,
      });

      const updated = await tx
        .update(userCustomBetPicks)
        .set({
          pointsEarned: null,
          wasCorrect: null,
          locked: false,
          updatedAt: new Date(),
        })
        .where(eq(userCustomBetPicks.customBetId, id))
        .returning({ id: userCustomBetPicks.id });

      await tx
        .update(customBets)
        .set({
          status: "reversed",
          resolvedValue: null,
          gradedAt: null,
          gradedBy: null,
          updatedAt: new Date(),
        })
        .where(eq(customBets.id, id));

      return { ok: true as const, picksReverted: updated.length };
    });

    if (result.ok) {
      console.info("[grading reverse]", {
        id,
        picksReverted: result.picksReverted,
        by: user.id,
      });
      revalidatePath("/[lang]/admin/bets", "page");
      revalidatePath("/[lang]/play", "layout");
      revalidatePath("/[lang]/leaderboard", "page");
    }
    return result;
  } catch (err) {
    console.error("[grading reverse] failed:", err);
    return { ok: false, error: "db" };
  }
}

export type ReopenCustomBetResult =
  | { ok: true }
  | { ok: false; error: GradeErr | "no_time_left" };

// Reopen a bet that was reversed by mistake so players can resume filling.
// The driving case: an admin clicks an answer in the grade form and grades,
// then "reverses" it — leaving status='reversed', which removes the bet from
// every player fill surface (they gate on status='open'). If the match has
// not started yet there is no reason it should be closed.
//
// Atomic + guarded:
//   1. Re-read status + lock_at inside the txn.
//   2. reopenBlockedReason enforces: must be 'reversed' AND lock_at in the
//      future. (A reverse already reset every pick to ungraded, so flipping
//      back to 'open' is clean — existing pickers keep their pick, new players
//      can fill.)
//   3. Audit row (action='reopen'), then status → 'open'.
//
// No resolved_value is touched (reverse already cleared it). No reason input is
// required from the admin — this is a one-click correction — so we store a
// fixed, descriptive audit reason that satisfies the non-empty CHECK.
export async function reopenCustomBet(
  id: string,
): Promise<ReopenCustomBetResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauth" };
  if (!(await hasPermission(user.id, "liveBets"))) {
    console.warn("[bet reopen denied]", { userId: user.id, id });
    return { ok: false, error: "forbidden" };
  }

  try {
    const result = await db.transaction(async (tx) => {
      const [bet] = await tx
        .select({ status: customBets.status, lockAt: customBets.lockAt })
        .from(customBets)
        .where(eq(customBets.id, id))
        .limit(1);

      if (!bet) return { ok: false as const, error: "bet_not_found" as const };

      const blocked = reopenBlockedReason(bet.status, bet.lockAt, new Date());
      if (blocked === "not_reopenable") {
        return { ok: false as const, error: "invalid_status" as const };
      }
      if (blocked === "no_time_left") {
        return { ok: false as const, error: "no_time_left" as const };
      }

      await tx.insert(betGradingAudit).values({
        customBetId: id,
        action: "reopen",
        previousStatus: "reversed",
        newStatus: "open",
        previousResolvedValue: null,
        newResolvedValue: null,
        reason: "Reopened for filling (was reversed before kickoff)",
        performedBy: user.id,
      });

      await tx
        .update(customBets)
        .set({ status: "open", updatedAt: new Date() })
        .where(and(eq(customBets.id, id), eq(customBets.status, "reversed")));

      return { ok: true as const };
    });

    if (result.ok) {
      console.info("[bet reopen]", { id, by: user.id });
      // Bust every surface that filters on status='open': the admin list +
      // detail, the player play/live fill pages, the leaderboard, and the
      // tournament page. The live fill pages are auth-dynamic, but the
      // admin segments are cached, so revalidate to flip the UI immediately.
      revalidatePath("/[lang]/admin/bets", "page");
      revalidatePath(`/[lang]/admin/bets/${id}`, "page");
      revalidatePath("/[lang]/play", "layout");
      revalidatePath("/[lang]/bets/live", "layout");
      revalidatePath("/[lang]/leaderboard", "page");
    }
    return result;
  } catch (err) {
    console.error("[bet reopen] failed:", err);
    return { ok: false, error: "db" };
  }
}

function validateResolvedValue(
  answerType: "yes_no" | "number" | "multi_choice" | "free_text",
  config: unknown,
  resolved: ResolvedValue,
): boolean {
  if (resolved.type !== answerType) return false;
  if (resolved.type === "yes_no") {
    return typeof resolved.value === "boolean";
  }
  if (resolved.type === "number") {
    if (typeof resolved.value !== "number" || !Number.isFinite(resolved.value)) {
      return false;
    }
    const c = config as { min?: number; max?: number } | null | undefined;
    if (c?.min !== undefined && resolved.value < c.min) return false;
    if (c?.max !== undefined && resolved.value > c.max) return false;
    return true;
  }
  if (resolved.type === "multi_choice") {
    if (typeof resolved.value !== "string" || resolved.value.length === 0) {
      return false;
    }
    const c = config as { options?: Array<{ value: string }> } | null | undefined;
    return !!c?.options?.some((o) => o.value === resolved.value);
  }
  if (typeof resolved.value !== "string") return false;
  return resolved.value.length > 0 && resolved.value.length <= 200;
}

function isPickCorrect(
  answerType: "yes_no" | "number" | "multi_choice" | "free_text",
  pickAnswer: unknown,
  resolved: ResolvedValue,
): boolean {
  if (!pickAnswer || typeof pickAnswer !== "object") return false;
  const a = pickAnswer as { type?: string; value?: unknown };
  if (a.type !== answerType) return false;
  switch (resolved.type) {
    case "yes_no":
      return a.value === resolved.value;
    case "number":
      return typeof a.value === "number" && a.value === resolved.value;
    case "multi_choice":
      return a.value === resolved.value;
    case "free_text":
      // Loose match: trimmed + case-insensitive so "messi" === "Messi ".
      // Admin can still pre-normalise if they want stricter behaviour.
      return (
        typeof a.value === "string" &&
        a.value.trim().toLowerCase() === resolved.value.trim().toLowerCase()
      );
  }
}

async function upsertMatchdayByDate(yyyymmdd: string): Promise<string> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(yyyymmdd)) {
    throw new Error(`invalid date string: ${yyyymmdd}`);
  }
  const row = await execFirstRow<{ id: string }>(sql`
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
  if (!row) {
    throw new Error(`upsertMatchdayByDate: no row returned for ${yyyymmdd}`);
  }
  return row.id;
}
