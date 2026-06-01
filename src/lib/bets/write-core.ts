import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { execFirstRow } from "@/db/helpers";
import {
  customBets,
  matchBets,
  userCustomBetPicks,
  type StageKey,
} from "@/db/schema";
import { bankBalanceSql, lockUserForBetting } from "@/lib/bank";
import type { PickAnswer } from "@/lib/bets/types";
import { resolvePickPayoutAtSubmit } from "@/lib/bets/payout";
import { isFreePickScope } from "@/lib/bets/free-pick-scopes";
import { validateAnswer } from "@/lib/bets/validate-answer";
import {
  getDeadlineContext,
  resolveCustomBetLock,
  resolveMatchScoreLock,
} from "@/lib/deadlines";

// The single gated path that writes a pick to the database. Three callers
// share it: the per-user single-pick actions (saveBet, submitCustomBetPick),
// the per-user "Surprise me" bulk fill, and the monkey bot cron.
//
// Two safety properties the design enforces (see the council verdict in
// _plans/2026-06-01-monkey-bot-and-random-fill.md):
//   1. No bare-userId bypass. Callers pass a typed PRINCIPAL, never a raw id.
//      A `self` principal can only be built from a fetched access result, so a
//      future caller cannot accidentally skip the access gate; `bot` is a
//      server-only construct used solely by the CRON_SECRET-gated endpoint.
//   2. Integrity invariants (status open, deadline not passed, never overwrite
//      when the caller says not to) are enforced INSIDE the locked transaction
//      for custom bets, and behind the match status/deadline check + a DB
//      unique index for match picks. This closes the read-then-settle race:
//      enumeration can be stale, the write still refuses a now-locked bet.
//
// `self` enforces access + bank + deadline + status. `system` is a trusted
// server-side write on a user's behalf (the monkey bot's self-fill, and the
// deadline auto-fill for paid players who forgot) — it skips only the human
// session-access gate (the caller has established eligibility out of band),
// and still plays by the bank/deadline/status rules so banks and the
// leaderboard aren't distorted.

export type WritePrincipal =
  // The access object carries only what the gate needs; the full
  // getUserAccess() result satisfies it structurally.
  | { kind: "self"; userId: string; access: { canEdit: boolean } }
  | { kind: "system"; userId: string };

export type SkipReason =
  | "already_filled"
  | "locked"
  | "closed"
  | "unaffordable"
  | "not_allowed";

export type WriteOutcome =
  | { status: "filled"; balanceAfter: number | null }
  | { status: "skipped"; reason: SkipReason; needed?: number }
  | { status: "error"; error: "db" | "not_found" | "invalid" | "bet_not_found" | "invalid_answer" };

// `overwrite` lets the write replace an existing pick (interactive saves);
// false makes it never-overwrite (random / monkey / auto-fill).
// `allowAfterDeadline` is the controlled grace path used ONLY by the deadline
// auto-fill: it skips the "deadline passed" rejection so a forgetful paid
// player still gets a pick after their deadline, while every other guard
// (bet not graded, match not yet kicked off, never-overwrite, bank) still
// holds. Defaults to false everywhere else.
export type WriteOpts = { overwrite: boolean; allowAfterDeadline?: boolean };

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function gateAccess(principal: WritePrincipal): boolean {
  return principal.kind === "system" || principal.access.canEdit;
}

// ---- match score (1/X/2) ----

export type MatchPickInput = { matchId: string; home: number; away: number };

export async function writeMatchPick(
  principal: WritePrincipal,
  input: MatchPickInput,
  opts: WriteOpts,
): Promise<WriteOutcome> {
  if (!gateAccess(principal)) return { status: "skipped", reason: "not_allowed" };
  if (!Number.isFinite(input.home) || !Number.isFinite(input.away)) {
    return { status: "error", error: "invalid" };
  }
  const h = Math.max(0, Math.min(99, Math.floor(input.home)));
  const a = Math.max(0, Math.min(99, Math.floor(input.away)));

  // Same single round trip saveBet used: match status + the inputs the
  // deadline cascade needs + the live risk-mode flags.
  const r = await execFirstRow<{
    status: string;
    kickoff_at: string;
    stage: string;
    lock_at_override: string | null;
    matchday_offset: number | null;
    risk_enabled: boolean;
    risk_penalty: number;
  }>(sql`
    select
      m.status::text as "status",
      m.kickoff_at as "kickoff_at",
      m.stage::text as "stage",
      m.lock_at_override as "lock_at_override",
      md.lock_offset_override_minutes as "matchday_offset",
      s.match_risk_enabled as "risk_enabled",
      s.match_risk_penalty as "risk_penalty"
    from public.matches m
    cross join public.settings s
    left join public.matchdays md
      on md.date = (m.kickoff_at at time zone 'Asia/Jerusalem')::date
    where m.id = ${input.matchId}::uuid and s.id = 1
    limit 1
  `);
  if (!r) return { status: "error", error: "not_found" };
  if (r.status !== "scheduled") return { status: "skipped", reason: "closed" };
  // Grace auto-fill never writes a score for a match that has already kicked
  // off, even if its status row hasn't flipped yet.
  if (opts.allowAfterDeadline && new Date(r.kickoff_at).getTime() <= Date.now()) {
    return { status: "skipped", reason: "closed" };
  }

  const context = await getDeadlineContext();
  const resolved = resolveMatchScoreLock(
    {
      matchId: input.matchId,
      kickoffAt: new Date(r.kickoff_at),
      stage: r.stage as StageKey,
      lockAtOverride: r.lock_at_override ? new Date(r.lock_at_override) : null,
      matchdayLockOffsetMinutes: r.matchday_offset,
    },
    context,
  );
  if (!opts.allowAfterDeadline && resolved.effectiveLockAt.getTime() <= Date.now()) {
    return { status: "skipped", reason: "locked" };
  }
  const stakeSnapshot = r.risk_enabled ? r.risk_penalty : null;

  try {
    if (opts.overwrite) {
      await db
        .insert(matchBets)
        .values({
          userId: principal.userId,
          matchId: input.matchId,
          homeScore: h,
          awayScore: a,
          stakePaidMain: stakeSnapshot,
        })
        .onConflictDoUpdate({
          target: [matchBets.userId, matchBets.matchId],
          set: {
            homeScore: h,
            awayScore: a,
            stakePaidMain: stakeSnapshot,
            updatedAt: new Date(),
          },
        });
      return { status: "filled", balanceAfter: null };
    }
    // Never-overwrite: a conflict on the (userId, matchId) unique index is a
    // no-op (idempotent against concurrent cron runs / double-taps). Empty
    // returning() means a pick already existed.
    const inserted = await db
      .insert(matchBets)
      .values({
        userId: principal.userId,
        matchId: input.matchId,
        homeScore: h,
        awayScore: a,
        stakePaidMain: stakeSnapshot,
      })
      .onConflictDoNothing({ target: [matchBets.userId, matchBets.matchId] })
      .returning({ id: matchBets.id });
    return inserted.length > 0
      ? { status: "filled", balanceAfter: null }
      : { status: "skipped", reason: "already_filled" };
  } catch (err) {
    console.error("[write-core matchPick] failed", err);
    return { status: "error", error: "db" };
  }
}

// ---- custom bet pick ----

export type CustomPickInput = { customBetId: string; answer: PickAnswer };

// Inner write, assumes the per-user advisory lock is already held on `tx`.
async function writeCustomPickTx(
  tx: Tx,
  principal: WritePrincipal,
  input: CustomPickInput,
  opts: WriteOpts,
): Promise<WriteOutcome> {
  const [bet] = await tx
    .select({
      id: customBets.id,
      scope: customBets.scope,
      status: customBets.status,
      lockAt: customBets.lockAt,
      stakeSnapshot: customBets.stakeSnapshot,
      payoutSnapshot: customBets.payoutSnapshot,
      answerType: customBets.answerType,
      answerConfig: customBets.answerConfig,
    })
    .from(customBets)
    .where(eq(customBets.id, input.customBetId))
    .limit(1);

  if (!bet) return { status: "error", error: "bet_not_found" };
  // Normally only an 'open' bet is pickable. The grace auto-fill also accepts a
  // bet that has formally locked but is not yet graded, so a forgetful player
  // still gets a pick the grading pass will pick up. A graded/cancelled bet is
  // never touched.
  const statusOk =
    bet.status === "open" ||
    (opts.allowAfterDeadline && bet.status === "locked");
  if (!statusOk) return { status: "skipped", reason: "closed" };

  const resolved = resolveCustomBetLock({
    id: bet.id,
    scope: bet.scope,
    lockAt: bet.lockAt,
  });
  if (!opts.allowAfterDeadline && resolved.effectiveLockAt.getTime() <= Date.now()) {
    return { status: "skipped", reason: "locked" };
  }
  if (!validateAnswer(bet.answerType, bet.answerConfig as unknown, input.answer)) {
    return { status: "error", error: "invalid_answer" };
  }

  const [existing] = await tx
    .select({
      id: userCustomBetPicks.id,
      stakePaid: userCustomBetPicks.stakePaid,
      locked: userCustomBetPicks.locked,
    })
    .from(userCustomBetPicks)
    .where(
      and(
        eq(userCustomBetPicks.userId, principal.userId),
        eq(userCustomBetPicks.customBetId, input.customBetId),
      ),
    )
    .limit(1);

  if (existing?.locked) return { status: "skipped", reason: "locked" };
  if (existing && !opts.overwrite) {
    return { status: "skipped", reason: "already_filled" };
  }

  // Free-pick scopes (tournament/stage/group) cost 0 regardless of a legacy
  // non-zero stakeSnapshot. Bank check inside the txn sees this user's other
  // in-flight stakes (including earlier picks in the same bulk fill) and adds
  // back the old stake since an update refunds before charging.
  const isFreePick = isFreePickScope(bet.scope);
  const effectiveStake = isFreePick ? 0 : bet.stakeSnapshot;
  const balanceRows = await tx.execute(
    sql`select ${bankBalanceSql(principal.userId)} as balance`,
  );
  const balance = Number(
    (balanceRows as unknown as Array<{ balance: number }>)[0]?.balance ?? 0,
  );
  const refund = existing?.stakePaid ?? 0;
  const effectiveBalance = balance + refund;
  const needed = effectiveStake - effectiveBalance;
  if (needed > 0) {
    return { status: "skipped", reason: "unaffordable", needed };
  }

  const pickPayout = resolvePickPayoutAtSubmit({
    answerType: bet.answerType,
    answerConfig: bet.answerConfig,
    answer: input.answer,
    betLevelPayout: bet.payoutSnapshot,
  });

  if (existing) {
    await tx
      .update(userCustomBetPicks)
      .set({
        answer: input.answer,
        stakePaid: effectiveStake,
        payoutSnapshot: pickPayout,
        updatedAt: new Date(),
      })
      .where(eq(userCustomBetPicks.id, existing.id));
  } else {
    await tx.insert(userCustomBetPicks).values({
      userId: principal.userId,
      customBetId: input.customBetId,
      answer: input.answer,
      stakePaid: effectiveStake,
      payoutSnapshot: pickPayout,
    });
  }
  return { status: "filled", balanceAfter: effectiveBalance - effectiveStake };
}

// Single custom-bet pick: opens one advisory-locked transaction.
export async function writeCustomPick(
  principal: WritePrincipal,
  input: CustomPickInput,
  opts: WriteOpts,
): Promise<WriteOutcome> {
  if (!gateAccess(principal)) return { status: "skipped", reason: "not_allowed" };
  try {
    return await db.transaction(async (tx) => {
      await lockUserForBetting(tx, principal.userId);
      return writeCustomPickTx(tx, principal, input, opts);
    });
  } catch (err) {
    console.error("[write-core customPick] failed", err);
    return { status: "error", error: "db" };
  }
}

// Bulk custom-bet fill: ONE advisory-locked transaction for the whole batch,
// so a surface-wide "Surprise me" / monkey sweep doesn't thrash N separate
// serializable transactions. Sequential bank checks see prior fills in the
// same txn (read-your-writes), so stakes accumulate correctly.
export async function writeCustomPicksBulk(
  principal: WritePrincipal,
  items: CustomPickInput[],
  opts: WriteOpts,
): Promise<WriteOutcome[]> {
  if (!gateAccess(principal)) {
    return items.map(() => ({ status: "skipped", reason: "not_allowed" }));
  }
  if (items.length === 0) return [];
  try {
    return await db.transaction(async (tx) => {
      await lockUserForBetting(tx, principal.userId);
      const out: WriteOutcome[] = [];
      for (const item of items) {
        out.push(await writeCustomPickTx(tx, principal, item, opts));
      }
      return out;
    });
  } catch (err) {
    console.error("[write-core customPicksBulk] failed", err);
    return items.map(() => ({ status: "error", error: "db" }));
  }
}
