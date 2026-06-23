"use server";

import { revalidatePath } from "next/cache";
import { isAdmin } from "@/lib/admin";
import { getUser } from "@/lib/supabase/auth";
import { execRows } from "@/db/helpers";
import { sql } from "drizzle-orm";
import {
  backdateOwnCustomPick,
  backdateOwnMatchPick,
  clearOwnCustomPick,
  clearOwnMatchPick,
} from "@/lib/bets/write-core";
import { scoreFinalMatches } from "@/lib/sync";
import type { PickAnswer } from "@/lib/bets/types";
import type { AdminWriteResult } from "../users/[id]/bets/actions";

// Admin self-backdate server actions: a FULL admin correcting their OWN bets
// after a match has started/finished (the recurring prod DB hang sometimes
// drops a save). See _plans/2026-06-23-admin-self-backdate-bets.md.
//
// Every action:
//   1. Gates on requireAdmin-equivalent (getUser + isAdmin full admin).
//   2. IGNORES any client-supplied targetUserId and forces the session user's
//      own id into BOTH adminId and userId — the write-core layer additionally
//      refuses unless adminId === userId, so this can never touch another
//      player's pick.
//   3. Forwards to a self-only write-core entrypoint that writes the pick AND
//      an immutable bet_admin_audit row (backdated: true) atomically.
// The action result shape matches the proxy editor's AdminWriteResult so the
// shared AdminPickEditor dialog can render either action set.

async function gateSelf(): Promise<{ userId: string } | AdminWriteResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauthorized" };
  if (!(await isAdmin(user.id))) return { ok: false, error: "forbidden" };
  return { userId: user.id };
}

function validateReason(reason: string): boolean {
  return typeof reason === "string" && reason.trim().length > 0;
}

// Revalidate every surface a backdated pick can change: the self-backdate page
// itself, the leaderboard (points), the play surface (custom picks), and the
// match page when a score pick moved.
function revalidateSelf(matchId?: string): void {
  revalidatePath("/he/admin/my-bets");
  revalidatePath("/en/admin/my-bets");
  revalidatePath("/[lang]/leaderboard", "page");
  revalidatePath("/[lang]/play", "layout");
  if (matchId) {
    revalidatePath(`/he/match/${matchId}`);
    revalidatePath(`/en/match/${matchId}`);
  }
}

export async function selfBackdateMatchPick(args: {
  targetUserId: string;
  matchId: string;
  homeScore: number;
  awayScore: number;
  reason: string;
  lockBypassed: boolean;
}): Promise<AdminWriteResult> {
  const guard = await gateSelf();
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
  const outcome = await backdateOwnMatchPick(
    {
      kind: "admin_proxy",
      adminId: guard.userId,
      userId: guard.userId,
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
      console.info("[admin self-backdate] regrade_after_match_set", res);
    } catch (err) {
      console.error("[admin self-backdate] regrade failed", err);
    }
  }
  revalidateSelf(args.matchId);
  return { ok: true, outcome };
}

export async function selfClearMatchPick(args: {
  targetUserId: string;
  matchId: string;
  reason: string;
  lockBypassed: boolean;
}): Promise<AdminWriteResult> {
  const guard = await gateSelf();
  if ("ok" in guard) return guard;
  if (!validateReason(args.reason)) return { ok: false, error: "missing_reason" };
  const outcome = await clearOwnMatchPick(
    {
      kind: "admin_proxy",
      adminId: guard.userId,
      userId: guard.userId,
      reason: args.reason,
      lockBypassed: true,
    },
    args.matchId,
  );
  revalidateSelf(args.matchId);
  return { ok: true, outcome };
}

export async function selfBackdateCustomBetPick(args: {
  targetUserId: string;
  customBetId: string;
  answer: PickAnswer;
  reason: string;
  lockBypassed: boolean;
}): Promise<AdminWriteResult> {
  const guard = await gateSelf();
  if ("ok" in guard) return guard;
  if (!validateReason(args.reason)) return { ok: false, error: "missing_reason" };
  const outcome = await backdateOwnCustomPick(
    {
      kind: "admin_proxy",
      adminId: guard.userId,
      userId: guard.userId,
      reason: args.reason,
      lockBypassed: true,
    },
    { customBetId: args.customBetId, answer: args.answer },
  );
  revalidateSelf();
  return { ok: true, outcome };
}

export async function selfClearCustomBetPick(args: {
  targetUserId: string;
  customBetId: string;
  reason: string;
  lockBypassed: boolean;
}): Promise<AdminWriteResult> {
  const guard = await gateSelf();
  if ("ok" in guard) return guard;
  if (!validateReason(args.reason)) return { ok: false, error: "missing_reason" };
  const outcome = await clearOwnCustomPick(
    {
      kind: "admin_proxy",
      adminId: guard.userId,
      userId: guard.userId,
      reason: args.reason,
      lockBypassed: true,
    },
    args.customBetId,
  );
  revalidateSelf();
  return { ok: true, outcome };
}

// The private backdate trail: only the calling admin's own backdated rows.
// Joined to the bet/match so the log reads in plain language. RLS already
// restricts the table to admins; we further filter to admin_id = self so one
// admin never sees another's corrections.
export type MyBackdateAuditRow = {
  id: string;
  createdAt: string;
  action: "set" | "clear";
  surface: "match" | "custom";
  before: unknown | null;
  after: unknown | null;
  reason: string;
  // Display context (NULL for the surface that doesn't apply).
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
      ht.name_he                         as "matchHomeHe",
      at.name_he                         as "matchAwayHe",
      ht.name_en                         as "matchHomeEn",
      at.name_en                         as "matchAwayEn",
      cb.question_he                     as "questionHe",
      cb.question_en                     as "questionEn"
    from public.bet_admin_audit a
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
