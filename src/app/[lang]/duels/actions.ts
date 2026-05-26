"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { duels, matches as matchesTable, matchdays, settings } from "@/db/schema";
import { getUser } from "@/lib/supabase/auth";
import { isAdmin } from "@/lib/admin";
import { getUserAccess } from "@/lib/access";
import { bankBalanceSql, lockUserForBetting } from "@/lib/bank";

// 1v1 duel server actions. See _plans/2026-05-27-betting-overhaul.md §7
// for the design rationale.
//
// Bank accounting: duel stakes are NOT written to point_adjustments;
// the balance formula in src/lib/bank.ts reads the duels table directly
// and applies a +stake / -stake delta per side based on status +
// resolved_value. That means the only DB writes here are inserts /
// updates on the duels table itself, kept inside a serializable txn so
// the live balance read can never miss an in-flight debit.

type DuelErr =
  | "unauth"
  | "not_paid"
  | "forbidden"
  | "invalid_input"
  | "stake_too_high"
  | "stake_too_low"
  | "insufficient_funds"
  | "match_not_found"
  | "match_locked"
  | "matchday_empty"
  | "deadline_past"
  | "duel_not_found"
  | "duel_already_joined"
  | "duel_closed"
  | "duel_self_join"
  | "already_settled"
  | "db";

export type OpenDuelInput = {
  scope: "match" | "day" | "tournament";
  matchId?: string | null;
  matchdayDate?: string | null;       // YYYY-MM-DD, Asia/Jerusalem
  openerAnswer: boolean;
  stake: number;
  questionHe: string;
  questionEn: string;
  gradingRuleHe: string;
  gradingRuleEn: string;
  // Optional override; defaults to min(earliest-kickoff − 5min, now + duelDefaultJoinWindowHours).
  joinDeadlineAt?: string | null;     // ISO 8601
};

export type OpenDuelResult =
  | { ok: true; id: string }
  | { ok: false; error: DuelErr };

export async function openDuel(input: OpenDuelInput): Promise<OpenDuelResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauth" };
  const access = await getUserAccess(user.id);
  if (!access.canEdit) return { ok: false, error: "not_paid" };

  // 1) Plain-text + structural validation. Mirrors the DB CHECKs so
  // we return a clean error before hitting the constraint.
  if (
    input.questionHe.trim().length === 0 ||
    input.questionEn.trim().length === 0 ||
    input.gradingRuleHe.trim().length < 3 ||
    input.gradingRuleEn.trim().length < 3
  ) {
    return { ok: false, error: "invalid_input" };
  }
  if (!Number.isInteger(input.stake) || input.stake < 1) {
    return { ok: false, error: "stake_too_low" };
  }

  // 2) Read live duel limits + earliest fixture in scope to derive the
  // resolve / lock times. Stake cap and join-window default both
  // come from settings so the admin can tune them mid-tournament.
  const [s] = await db
    .select({
      duelMaxStake: settings.duelMaxStake,
      duelDefaultJoinWindowHours: settings.duelDefaultJoinWindowHours,
    })
    .from(settings)
    .where(eq(settings.id, 1));
  if (!s) return { ok: false, error: "db" };
  if (input.stake > s.duelMaxStake) {
    return { ok: false, error: "stake_too_high" };
  }

  let matchId: string | null = null;
  let matchdayId: string | null = null;
  let resolveAt: Date | null = null;

  if (input.scope === "match") {
    if (!input.matchId) return { ok: false, error: "invalid_input" };
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
    if (m.status !== "scheduled") return { ok: false, error: "match_locked" };
    matchId = m.id;
    matchdayId = await upsertMatchdayFromKickoff(m.kickoffAt);
    resolveAt = m.kickoffAt;
  } else if (input.scope === "day") {
    if (!input.matchdayDate) return { ok: false, error: "invalid_input" };
    const earliest = await firstKickoffOnDate(input.matchdayDate);
    if (!earliest) return { ok: false, error: "matchday_empty" };
    matchdayId = await upsertMatchdayByDate(input.matchdayDate);
    resolveAt = earliest;
  } else {
    // tournament — no anchor; resolve_at is set to "kickoff + 60d" as
    // a safe far-future fallback. Admin can settle manually anytime.
    resolveAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
  }

  const defaultDeadline = new Date(
    Math.min(
      resolveAt.getTime() - 5 * 60_000,
      Date.now() + s.duelDefaultJoinWindowHours * 60 * 60 * 1000,
    ),
  );
  const joinDeadlineAt = input.joinDeadlineAt
    ? new Date(input.joinDeadlineAt)
    : defaultDeadline;
  if (
    Number.isNaN(joinDeadlineAt.getTime()) ||
    joinDeadlineAt.getTime() <= Date.now()
  ) {
    return { ok: false, error: "deadline_past" };
  }

  // 3) Serializable txn: lock the opener, check balance, insert.
  try {
    const inserted = await db.transaction(async (tx) => {
      await lockUserForBetting(tx, user.id);
      const balanceRows = await tx.execute(
        sql`select ${bankBalanceSql(user.id)} as balance`,
      );
      const balance =
        (balanceRows as unknown as Array<{ balance: number }>)[0]?.balance ?? 0;
      if (balance < input.stake) {
        return null;
      }

      const [row] = await tx
        .insert(duels)
        .values({
          openerId: user.id,
          openerAnswer: input.openerAnswer,
          stake: input.stake,
          questionHe: input.questionHe.trim(),
          questionEn: input.questionEn.trim(),
          gradingRuleHe: input.gradingRuleHe.trim(),
          gradingRuleEn: input.gradingRuleEn.trim(),
          scope: input.scope,
          matchId,
          matchdayId,
          status: "open",
          joinDeadlineAt,
          resolveAt: resolveAt!,
        })
        .returning({ id: duels.id });
      return row.id;
    });

    if (!inserted) {
      return { ok: false, error: "insufficient_funds" };
    }

    console.info("[duel open]", {
      duelId: inserted,
      openerId: user.id,
      stake: input.stake,
      scope: input.scope,
      deadlineAt: joinDeadlineAt.toISOString(),
    });
    revalidatePath("/", "layout");
    return { ok: true, id: inserted };
  } catch (err) {
    console.error("[duel open] insert failed:", err);
    return { ok: false, error: "db" };
  }
}

export type JoinDuelResult =
  | { ok: true }
  | { ok: false; error: DuelErr };

export async function joinDuel(id: string): Promise<JoinDuelResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauth" };
  const access = await getUserAccess(user.id);
  if (!access.canEdit) return { ok: false, error: "not_paid" };

  try {
    const result = await db.transaction(async (tx) => {
      // Serialise joiners on the same duel id so two simultaneous taps
      // can never both win the race. The per-user lock on the joiner
      // prevents them from double-spending across two different duels.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${"duel:" + id}))`,
      );
      await lockUserForBetting(tx, user.id);

      const [d] = await tx
        .select({
          id: duels.id,
          openerId: duels.openerId,
          status: duels.status,
          stake: duels.stake,
          joinDeadlineAt: duels.joinDeadlineAt,
        })
        .from(duels)
        .where(eq(duels.id, id))
        .limit(1);
      if (!d) return { ok: false as const, error: "duel_not_found" as const };
      if (d.openerId === user.id)
        return { ok: false as const, error: "duel_self_join" as const };
      if (d.status !== "open")
        return { ok: false as const, error: "duel_already_joined" as const };
      if (d.joinDeadlineAt.getTime() <= Date.now())
        return { ok: false as const, error: "duel_closed" as const };

      // Re-check balance inside the txn so the bank read picks up any
      // other in-flight stake debits from the same user.
      const balanceRows = await tx.execute(
        sql`select ${bankBalanceSql(user.id)} as balance`,
      );
      const balance =
        (balanceRows as unknown as Array<{ balance: number }>)[0]?.balance ??
        0;
      if (balance < d.stake)
        return { ok: false as const, error: "insufficient_funds" as const };

      await tx
        .update(duels)
        .set({
          joinerId: user.id,
          joinedAt: new Date(),
          status: "matched",
        })
        .where(and(eq(duels.id, id), eq(duels.status, "open")));
      return { ok: true as const, stake: d.stake };
    });

    if (!result.ok) return result;
    console.info("[duel join]", {
      duelId: id,
      joinerId: user.id,
      stake: result.stake,
    });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    console.error("[duel join] failed:", err);
    return { ok: false, error: "db" };
  }
}

export type SettleDuelResult =
  | { ok: true }
  | { ok: false; error: DuelErr };

export async function settleDuel(
  id: string,
  resolvedValue: boolean,
): Promise<SettleDuelResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauth" };
  if (!(await isAdmin(user.id))) return { ok: false, error: "forbidden" };

  try {
    const result = await db.transaction(async (tx) => {
      const [d] = await tx
        .select({
          id: duels.id,
          status: duels.status,
          openerId: duels.openerId,
          joinerId: duels.joinerId,
          openerAnswer: duels.openerAnswer,
          stake: duels.stake,
        })
        .from(duels)
        .where(eq(duels.id, id))
        .limit(1);
      if (!d) return { ok: false as const, error: "duel_not_found" as const };
      if (d.status !== "matched")
        return { ok: false as const, error: "already_settled" as const };
      if (!d.joinerId)
        return { ok: false as const, error: "duel_not_found" as const };

      await tx
        .update(duels)
        .set({
          status: "settled",
          resolvedValue,
          settledAt: new Date(),
          settledBy: user.id,
        })
        .where(and(eq(duels.id, id), eq(duels.status, "matched")));
      return {
        ok: true as const,
        winnerId:
          resolvedValue === d.openerAnswer ? d.openerId : d.joinerId,
        loserId:
          resolvedValue === d.openerAnswer ? d.joinerId : d.openerId,
        stake: d.stake,
      };
    });

    if (!result.ok) return result;
    console.info("[duel settle]", {
      duelId: id,
      resolvedValue,
      winnerId: result.winnerId,
      loserId: result.loserId,
      stake: result.stake,
      settledBy: user.id,
    });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    console.error("[duel settle] failed:", err);
    return { ok: false, error: "db" };
  }
}

export type CancelDuelResult =
  | { ok: true }
  | { ok: false; error: DuelErr };

// Open duel can be cancelled by its opener (no joiner yet) OR by admin.
// Matched / settled duels can only be cancelled by admin — that path
// should be rare and is captured via console.info so we know it ran.
export async function cancelDuel(
  id: string,
  reason: string,
): Promise<CancelDuelResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauth" };
  if (reason.trim().length < 3)
    return { ok: false, error: "invalid_input" };

  try {
    const result = await db.transaction(async (tx) => {
      const [d] = await tx
        .select({
          id: duels.id,
          status: duels.status,
          openerId: duels.openerId,
        })
        .from(duels)
        .where(eq(duels.id, id))
        .limit(1);
      if (!d) return { ok: false as const, error: "duel_not_found" as const };
      if (d.status === "cancelled")
        return { ok: false as const, error: "already_settled" as const };

      const callerIsAdmin = await isAdmin(user.id);
      const callerIsOpenerOnOpen =
        d.status === "open" && d.openerId === user.id;
      if (!callerIsAdmin && !callerIsOpenerOnOpen)
        return { ok: false as const, error: "forbidden" as const };

      await tx
        .update(duels)
        .set({ status: "cancelled" })
        .where(eq(duels.id, id));
      return { ok: true as const };
    });

    if (!result.ok) return result;
    console.info("[duel cancel]", {
      duelId: id,
      reason,
      cancelledBy: user.id,
    });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    console.error("[duel cancel] failed:", err);
    return { ok: false, error: "db" };
  }
}

// ---------- helpers ----------

async function upsertMatchdayFromKickoff(kickoffAt: Date): Promise<string> {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(kickoffAt);
  return upsertMatchdayByDate(date);
}

async function upsertMatchdayByDate(date: string): Promise<string> {
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

async function firstKickoffOnDate(date: string): Promise<Date | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const rows = await db.execute<{ kickoff_at: string }>(sql`
    select min(m.kickoff_at)::text as "kickoff_at"
    from public.matches m
    where (m.kickoff_at at time zone 'Asia/Jerusalem')::date = ${date}::date
      and m.status = 'scheduled'
  `);
  const r = (rows as unknown as Array<{ kickoff_at: string | null }>)[0];
  return r?.kickoff_at ? new Date(r.kickoff_at) : null;
}
