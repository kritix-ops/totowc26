"use server";

import { revalidatePath } from "next/cache";
import { isAdmin } from "@/lib/admin";
import { getUser } from "@/lib/supabase/auth";
import { execRows } from "@/db/helpers";
import { sql } from "drizzle-orm";
import {
  backdateCustomPick,
  backdateMatchPick,
  backdateAdvancePick,
  clearCustomPick,
  clearMatchPick,
  clearAdvancePick,
} from "@/lib/bets/write-core";
import { scoreFinalMatches, scoreAdvanceBets } from "@/lib/sync";
import type { PickAnswer } from "@/lib/bets/types";
import type { AdminWriteResult } from "../users/[id]/bets/actions";

// Admin backdate server actions: a FULL admin correcting a pick after a match
// has started/finished (the recurring prod DB hang sometimes drops a save).
// See _plans/2026-07-05-admin-backdate-all-users-advance.md.
//
// Every action:
//   1. Gates on requireAdmin-equivalent (getUser + isAdmin full admin).
//   2. Sources the acting adminId from the live session (never the request
//      body). The TARGET user is the caller-supplied targetUserId — the admin
//      picks whose bet to fix on the backdate screen. Self-edits and other-user
//      edits both land in bet_admin_audit (backdated: true); admin_id vs
//      target_user_id keeps them distinguishable.
//   3. Forwards to a write-core backdate entrypoint that writes the pick AND an
//      immutable bet_admin_audit row atomically, then re-grades a final match.
// The action result shape matches the proxy editor's AdminWriteResult so the
// shared AdminPickEditor dialog can render either action set.

async function gate(
  targetUserId: string,
): Promise<{ adminId: string; targetUserId: string } | AdminWriteResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauthorized" };
  if (!(await isAdmin(user.id))) return { ok: false, error: "forbidden" };
  if (typeof targetUserId !== "string" || targetUserId.trim().length === 0) {
    return { ok: false, error: "invalid_input" };
  }
  return { adminId: user.id, targetUserId };
}

function validateReason(reason: string): boolean {
  return typeof reason === "string" && reason.trim().length > 0;
}

// Revalidate every surface a backdated pick can change: the backdate page
// itself, the leaderboard (points), the play surface (custom picks), and the
// match page when a score/advance pick moved.
function revalidateAfter(matchId?: string): void {
  revalidatePath("/he/admin/my-bets");
  revalidatePath("/en/admin/my-bets");
  revalidatePath("/[lang]/leaderboard", "page");
  revalidatePath("/[lang]/play", "layout");
  if (matchId) {
    revalidatePath(`/he/match/${matchId}`);
    revalidatePath(`/en/match/${matchId}`);
  }
}

export async function backdateMatchPickForUser(args: {
  targetUserId: string;
  matchId: string;
  homeScore: number;
  awayScore: number;
  reason: string;
  lockBypassed: boolean;
}): Promise<AdminWriteResult> {
  const guard = await gate(args.targetUserId);
  if ("ok" in guard) return guard;
  if (!validateReason(args.reason)) return { ok: false, error: "missing_reason" };
  if (
    !Number.isFinite(args.homeScore) ||
    !Number.isFinite(args.awayScore) ||
    args.homeScore < 0 ||
    args.awayScore < 0
  ) {
    return { ok: false, error: "invalid_input" };
  }
  const outcome = await backdateMatchPick(
    {
      kind: "admin_proxy",
      adminId: guard.adminId,
      userId: guard.targetUserId,
      reason: args.reason,
      lockBypassed: true,
    },
    { matchId: args.matchId, home: args.homeScore, away: args.awayScore },
  );
  // Grade immediately if the match is already final (idempotent no-op
  // otherwise). A live/scheduled match grades on the next sync as usual.
  if (outcome.status === "filled") {
    try {
      const res = await scoreFinalMatches();
      console.info("[admin backdate] regrade_after_match_set", res);
    } catch (err) {
      console.error("[admin backdate] regrade failed", err);
    }
  }
  revalidateAfter(args.matchId);
  return { ok: true, outcome };
}

export async function clearMatchPickForUser(args: {
  targetUserId: string;
  matchId: string;
  reason: string;
  lockBypassed: boolean;
}): Promise<AdminWriteResult> {
  const guard = await gate(args.targetUserId);
  if ("ok" in guard) return guard;
  if (!validateReason(args.reason)) return { ok: false, error: "missing_reason" };
  const outcome = await clearMatchPick(
    {
      kind: "admin_proxy",
      adminId: guard.adminId,
      userId: guard.targetUserId,
      reason: args.reason,
      lockBypassed: true,
    },
    args.matchId,
  );
  revalidateAfter(args.matchId);
  return { ok: true, outcome };
}

export async function backdateCustomBetPickForUser(args: {
  targetUserId: string;
  customBetId: string;
  answer: PickAnswer;
  reason: string;
  lockBypassed: boolean;
  // Live (match/day) stake the admin chose. write-core clamps it to the admin
  // range; free-pick scopes ignore it (always 0).
  requestedStake?: number;
}): Promise<AdminWriteResult> {
  const guard = await gate(args.targetUserId);
  if ("ok" in guard) return guard;
  if (!validateReason(args.reason)) return { ok: false, error: "missing_reason" };
  const outcome = await backdateCustomPick(
    {
      kind: "admin_proxy",
      adminId: guard.adminId,
      userId: guard.targetUserId,
      reason: args.reason,
      lockBypassed: true,
    },
    {
      customBetId: args.customBetId,
      answer: args.answer,
      requestedStake: args.requestedStake,
    },
  );
  revalidateAfter();
  return { ok: true, outcome };
}

export async function clearCustomBetPickForUser(args: {
  targetUserId: string;
  customBetId: string;
  reason: string;
  lockBypassed: boolean;
}): Promise<AdminWriteResult> {
  const guard = await gate(args.targetUserId);
  if ("ok" in guard) return guard;
  if (!validateReason(args.reason)) return { ok: false, error: "missing_reason" };
  const outcome = await clearCustomPick(
    {
      kind: "admin_proxy",
      adminId: guard.adminId,
      userId: guard.targetUserId,
      reason: args.reason,
      lockBypassed: true,
    },
    args.customBetId,
  );
  revalidateAfter();
  return { ok: true, outcome };
}

export async function backdateAdvancePickForUser(args: {
  targetUserId: string;
  matchId: string;
  team: string;
  reason: string;
  lockBypassed: boolean;
}): Promise<AdminWriteResult> {
  const guard = await gate(args.targetUserId);
  if ("ok" in guard) return guard;
  if (!validateReason(args.reason)) return { ok: false, error: "missing_reason" };
  if (typeof args.team !== "string" || args.team.trim().length === 0) {
    return { ok: false, error: "invalid_input" };
  }
  const outcome = await backdateAdvancePick(
    {
      kind: "admin_proxy",
      adminId: guard.adminId,
      userId: guard.targetUserId,
      reason: args.reason,
      lockBypassed: true,
    },
    { matchId: args.matchId, team: args.team },
  );
  // Grade immediately if the knockout is already final (scoreAdvanceBets only
  // touches ungraded picks, and the write reset points_earned to NULL).
  if (outcome.status === "filled") {
    try {
      const res = await scoreAdvanceBets();
      console.info("[admin backdate] regrade_after_advance_set", res);
    } catch (err) {
      console.error("[admin backdate] advance regrade failed", err);
    }
  }
  revalidateAfter(args.matchId);
  return { ok: true, outcome };
}

export async function clearAdvancePickForUser(args: {
  targetUserId: string;
  matchId: string;
  reason: string;
  lockBypassed: boolean;
}): Promise<AdminWriteResult> {
  const guard = await gate(args.targetUserId);
  if ("ok" in guard) return guard;
  if (!validateReason(args.reason)) return { ok: false, error: "missing_reason" };
  const outcome = await clearAdvancePick(
    {
      kind: "admin_proxy",
      adminId: guard.adminId,
      userId: guard.targetUserId,
      reason: args.reason,
      lockBypassed: true,
    },
    args.matchId,
  );
  revalidateAfter(args.matchId);
  return { ok: true, outcome };
}

// The backdate trail: every backdated row this admin wrote, across all target
// users, newest first. Joined to the bet/match so the log reads in plain
// language, plus the target user's name so a fix for someone else is labelled.
// RLS already restricts the table to admins; we further filter to admin_id =
// self so one admin never sees another's corrections.
export type MyBackdateAuditRow = {
  id: string;
  createdAt: string;
  action: "set" | "clear";
  surface: "match" | "custom" | "advance";
  before: unknown | null;
  after: unknown | null;
  reason: string;
  // Whose bet was fixed (labelled in the log). NULL only if the profile was
  // since deleted.
  targetUserName: string | null;
  isSelf: boolean;
  // Display context (NULL for the surface that doesn't apply). Advance reuses
  // the match join for the matchup.
  matchHomeHe: string | null;
  matchAwayHe: string | null;
  matchHomeEn: string | null;
  matchAwayEn: string | null;
  questionHe: string | null;
  questionEn: string | null;
};

export async function fetchMyBackdateAudit(): Promise<MyBackdateAuditRow[]> {
  const user = await getUser();
  if (!user) return [];
  if (!(await isAdmin(user.id))) return [];
  return execRows<MyBackdateAuditRow>(sql`
    select
      a.id::text                         as "id",
      a.created_at::text                 as "createdAt",
      a.action                           as "action",
      a.surface                          as "surface",
      a.before                           as "before",
      a.after                            as "after",
      a.reason                           as "reason",
      tu.display_name                    as "targetUserName",
      (a.target_user_id = a.admin_id)    as "isSelf",
      ht.name_he                         as "matchHomeHe",
      at.name_he                         as "matchAwayHe",
      ht.name_en                         as "matchHomeEn",
      at.name_en                         as "matchAwayEn",
      cb.question_he                     as "questionHe",
      cb.question_en                     as "questionEn"
    from public.bet_admin_audit a
    left join public.profiles tu on tu.id = a.target_user_id
    left join public.matches m  on m.id = a.match_id
    left join public.teams ht   on ht.code = m.home_team
    left join public.teams at   on at.code = m.away_team
    left join public.custom_bets cb on cb.id = a.custom_bet_id
    where a.admin_id = ${user.id}::uuid
      and a.backdated = true
    order by a.created_at desc
    limit 200
  `);
}
