"use server";

import { revalidatePath } from "next/cache";
import { isAdmin } from "@/lib/admin";
import { getUser } from "@/lib/supabase/auth";
import {
  clearCustomPickAdmin,
  clearMatchPickAdmin,
  writeCustomPickAdmin,
  writeMatchPickAdmin,
  type WriteOutcome,
} from "@/lib/bets/write-core";
import type { PickAnswer } from "@/lib/bets/types";

// Server actions that let an admin write or clear a target user's pick.
// Each starts with an admin gate (defense-in-depth on top of the page
// gate), validates the reason field, builds the admin_proxy principal,
// and forwards to write-core where the pick mutation and the
// bet_admin_audit row land atomically. Phase 2 of
// _plans/2026-06-08-admin-bet-inspector.md.

type AdminWriteOk = { ok: true; outcome: WriteOutcome };
type AdminWriteErr = {
  ok: false;
  error:
    | "unauthorized"
    | "forbidden"
    | "missing_reason"
    | "self_target"
    | "invalid_input";
};
export type AdminWriteResult = AdminWriteOk | AdminWriteErr;

async function gateAdmin(
  targetUserId: string,
): Promise<{ adminId: string } | AdminWriteErr> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauthorized" };
  if (!(await isAdmin(user.id))) return { ok: false, error: "forbidden" };
  // Admins editing their own pick must use the regular self-write path
  // so it doesn't end up in the bet_admin_audit table looking like a
  // proxy edit. The UI hides the "edit" button on the admin's own row;
  // this is the server-side mirror of that guard.
  if (user.id === targetUserId) {
    return { ok: false, error: "self_target" };
  }
  return { adminId: user.id };
}

function validateReason(reason: string): boolean {
  return typeof reason === "string" && reason.trim().length > 0;
}

function revalidateUserBetsPage(targetUserId: string): void {
  revalidatePath(`/he/admin/users/${targetUserId}/bets`);
  revalidatePath(`/en/admin/users/${targetUserId}/bets`);
  // The cross-user matrix renders the same picks; keep it fresh so an edit on
  // the per-user page (or the overview drawer) isn't stale on the next load.
  revalidatePath(`/he/admin/bets-overview`);
  revalidatePath(`/en/admin/bets-overview`);
}

export async function adminSetCustomBetPick(args: {
  targetUserId: string;
  customBetId: string;
  answer: PickAnswer;
  reason: string;
  lockBypassed: boolean;
}): Promise<AdminWriteResult> {
  const guard = await gateAdmin(args.targetUserId);
  if ("ok" in guard) return guard;
  if (!validateReason(args.reason)) {
    return { ok: false, error: "missing_reason" };
  }
  const outcome = await writeCustomPickAdmin(
    {
      kind: "admin_proxy",
      adminId: guard.adminId,
      userId: args.targetUserId,
      reason: args.reason,
      lockBypassed: !!args.lockBypassed,
    },
    { customBetId: args.customBetId, answer: args.answer },
  );
  revalidateUserBetsPage(args.targetUserId);
  return { ok: true, outcome };
}

export async function adminClearCustomBetPick(args: {
  targetUserId: string;
  customBetId: string;
  reason: string;
  lockBypassed: boolean;
}): Promise<AdminWriteResult> {
  const guard = await gateAdmin(args.targetUserId);
  if ("ok" in guard) return guard;
  if (!validateReason(args.reason)) {
    return { ok: false, error: "missing_reason" };
  }
  const outcome = await clearCustomPickAdmin(
    {
      kind: "admin_proxy",
      adminId: guard.adminId,
      userId: args.targetUserId,
      reason: args.reason,
      lockBypassed: !!args.lockBypassed,
    },
    args.customBetId,
  );
  revalidateUserBetsPage(args.targetUserId);
  return { ok: true, outcome };
}

export async function adminSetMatchPick(args: {
  targetUserId: string;
  matchId: string;
  homeScore: number;
  awayScore: number;
  reason: string;
  lockBypassed: boolean;
}): Promise<AdminWriteResult> {
  const guard = await gateAdmin(args.targetUserId);
  if ("ok" in guard) return guard;
  if (!validateReason(args.reason)) {
    return { ok: false, error: "missing_reason" };
  }
  if (
    !Number.isFinite(args.homeScore) ||
    !Number.isFinite(args.awayScore) ||
    args.homeScore < 0 ||
    args.awayScore < 0
  ) {
    return { ok: false, error: "invalid_input" };
  }
  const outcome = await writeMatchPickAdmin(
    {
      kind: "admin_proxy",
      adminId: guard.adminId,
      userId: args.targetUserId,
      reason: args.reason,
      lockBypassed: !!args.lockBypassed,
    },
    {
      matchId: args.matchId,
      home: args.homeScore,
      away: args.awayScore,
    },
  );
  revalidateUserBetsPage(args.targetUserId);
  return { ok: true, outcome };
}

export async function adminClearMatchPick(args: {
  targetUserId: string;
  matchId: string;
  reason: string;
  lockBypassed: boolean;
}): Promise<AdminWriteResult> {
  const guard = await gateAdmin(args.targetUserId);
  if ("ok" in guard) return guard;
  if (!validateReason(args.reason)) {
    return { ok: false, error: "missing_reason" };
  }
  const outcome = await clearMatchPickAdmin(
    {
      kind: "admin_proxy",
      adminId: guard.adminId,
      userId: args.targetUserId,
      reason: args.reason,
      lockBypassed: !!args.lockBypassed,
    },
    args.matchId,
  );
  revalidateUserBetsPage(args.targetUserId);
  return { ok: true, outcome };
}
