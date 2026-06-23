import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { execFirstRow } from "@/db/helpers";
import {
  betAdminAudit,
  customBets,
  matchBets,
  settings,
  userCustomBetPicks,
  type StageKey,
} from "@/db/schema";
import {
  assertBettingAllowed,
  bankBalanceSql,
  getOverdraftConfig,
  lockUserForBetting,
  type OverdraftConfig,
} from "@/lib/bank";
import type { AnswerConfig, PickAnswer } from "@/lib/bets/types";
import { resolvePickPayoutAtSubmit } from "@/lib/bets/payout";
import {
  liveOptionPayout,
  resolvePricingMode,
  resolveYesNoSideOdds,
} from "@/lib/bets/price-options";
import { isFreePickScope } from "@/lib/bets/free-pick-scopes";
import { validateAnswer } from "@/lib/bets/validate-answer";
import { liveStakeCap } from "@/lib/odds-normalize";
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
  | { kind: "system"; userId: string }
  // Admin proxy: an admin writing on behalf of a target user. `adminId`
  // is the acting admin (always sourced from getUser() in the calling
  // action). `userId` is the target whose pick gets written. `reason`
  // is mandatory text — the audit row's reason. `lockBypassed=true`
  // mirrors opts.allowAfterDeadline so a late save still lands, but
  // also marks the audit row so reports can call out admin overrides.
  // Building this principal requires `requireAdmin()` to have passed
  // — see src/lib/bets/bet-immutability.test.ts for the source guard.
  | {
      kind: "admin_proxy";
      adminId: string;
      userId: string;
      reason: string;
      lockBypassed: boolean;
    };

export type SkipReason =
  | "already_filled"
  | "locked"
  | "closed"
  | "unaffordable"
  | "negative_balance_locked"
  | "overdraft_exceeded"
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
  if (principal.kind === "system") return true;
  if (principal.kind === "admin_proxy") {
    // The caller is responsible for `requireAdmin()` before building this
    // principal. The gate trusts that contract — verification happens at
    // the source level in bet-immutability.test.ts.
    return true;
  }
  return principal.access.canEdit;
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

// ---- match score (1/X/2) cancel ----

// Owner-explicit cancel: the signed-in user removes their own 1/X/2 pick
// while the match-score lock window is still open. The carve-out the
// `feedback_user_bets_are_sacred` memory permits — destruction by the
// owner is allowed; destruction by anything else (cron, bot, sandbox push)
// is still forbidden. Mirrors writeMatchPick's deadline + status gates
// so the cancel window matches the save window exactly.
export async function cancelMatchPickSelf(
  principal: WritePrincipal,
  input: { matchId: string },
): Promise<WriteOutcome> {
  if (principal.kind !== "self") {
    // Admin clear has its own audited path (clearMatchPickAdmin); the
    // grace cron has no cancel pass. Both are intentional.
    return { status: "skipped", reason: "not_allowed" };
  }
  if (!gateAccess(principal)) return { status: "skipped", reason: "not_allowed" };

  const r = await execFirstRow<{
    status: string;
    kickoff_at: string;
    stage: string;
    lock_at_override: string | null;
    matchday_offset: number | null;
  }>(sql`
    select
      m.status::text as "status",
      m.kickoff_at as "kickoff_at",
      m.stage::text as "stage",
      m.lock_at_override as "lock_at_override",
      md.lock_offset_override_minutes as "matchday_offset"
    from public.matches m
    left join public.matchdays md
      on md.date = (m.kickoff_at at time zone 'Asia/Jerusalem')::date
    where m.id = ${input.matchId}::uuid
    limit 1
  `);
  if (!r) return { status: "error", error: "not_found" };
  if (r.status !== "scheduled") return { status: "skipped", reason: "closed" };

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
  if (resolved.effectiveLockAt.getTime() <= Date.now()) {
    return { status: "skipped", reason: "locked" };
  }

  try {
    const deleted = await db
      .delete(matchBets)
      .where(
        and(
          eq(matchBets.userId, principal.userId),
          eq(matchBets.matchId, input.matchId),
        ),
      )
      .returning({ id: matchBets.id });
    if (deleted.length === 0) {
      // No row to cancel — caller can show a no-op "nothing to cancel"
      // or just refresh. Reusing already_filled would be misleading;
      // there's no dedicated "nothing-to-clear" reason, so closed is
      // the closest existing one (the pick set the user wanted to clear
      // is effectively empty).
      return { status: "skipped", reason: "already_filled" };
    }
    return { status: "filled", balanceAfter: null };
  } catch (err) {
    console.error("[write-core cancelMatchPickSelf] failed", err);
    return { status: "error", error: "db" };
  }
}

// ---- custom bet pick ----

// `requestedStake` is the player's choice for live (match/day) bets.
//   - Set by the interactive bet card via submitCustomBetPick (1..30 by
//     default, clamped server-side to [liveOddsMinStake, liveOddsMaxStake]).
//   - Omitted by every automated path (Surprise Me, the monkey bot, the
//     deadline grace auto-fill) so those keep staking the bet's default
//     (the player never expressed a choice). Free-pick scopes
//     (tournament/stage/group) ignore it.
// See _plans/2026-06-11-variable-live-bet-stake.md §6.
export type CustomPickInput = {
  customBetId: string;
  answer: PickAnswer;
  requestedStake?: number;
};

// Inner write, assumes the per-user advisory lock is already held on `tx`.
// `overdraft` is read ONCE by the caller BEFORE the lock is taken and
// passed in, so the locked transaction never stops to grab a second
// pooler connection. A global-`db` read while the advisory lock is held
// can stall under pool pressure and pin the lock for seconds (the probe
// in _plans/2026-06-17-performance-root-cause-and-fix.md §T2.2 saw a
// 106s hold), which is exactly the "save stuck forever" symptom.
async function writeCustomPickTx(
  tx: Tx,
  principal: WritePrincipal,
  input: CustomPickInput,
  opts: WriteOpts,
  overdraft: OverdraftConfig,
): Promise<WriteOutcome> {
  const [bet] = await tx
    .select({
      id: customBets.id,
      scope: customBets.scope,
      status: customBets.status,
      lockAt: customBets.lockAt,
      stakeSnapshot: customBets.stakeSnapshot,
      payoutSnapshot: customBets.payoutSnapshot,
      decimalOdds: customBets.decimalOdds,
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

  // Resolve effective stake + payout for this submit:
  //   - Free-pick scopes (tournament/stage/group): stake = 0 always; payout
  //     comes from the per-option curve via resolvePickPayoutAtSubmit.
  //   - Live scopes (match/day): stake comes from the player's pill choice
  //     (input.requestedStake) when supplied, clamped to the admin range.
  //     If the bet has decimalOdds we recompute the payout fresh against
  //     the chosen stake; if not (legacy bet missing the column), we fall
  //     back to the bet's snapshotted (stake, payout) to keep the player
  //     unblocked — logged loudly so a backfill miss is visible.
  const isFreePick = isFreePickScope(bet.scope);
  let effectiveStake: number;
  let pickPayout: number;
  if (isFreePick) {
    effectiveStake = 0;
    pickPayout = resolvePickPayoutAtSubmit({
      answerType: bet.answerType,
      answerConfig: bet.answerConfig,
      answer: input.answer,
      betLevelPayout: bet.payoutSnapshot,
    });
  } else {
    const liveCfg = await loadLiveStakeConfig(tx);
    const resolved = resolveLiveStake(input.requestedStake, bet.stakeSnapshot, liveCfg);
    effectiveStake = resolved.stake;
    if (resolved.clamped) {
      console.warn("[custom-bet stake] clamped", {
        userId: principal.userId,
        betId: input.customBetId,
        requested: input.requestedStake,
        clampedTo: effectiveStake,
      });
    }
    const optionOdds = resolveLiveOptionOdds({
      answerType: bet.answerType,
      answerConfig: bet.answerConfig,
      betLevelDecimalOdds: bet.decimalOdds == null ? null : Number(bet.decimalOdds),
      answer: input.answer,
    });
    if (optionOdds != null) {
      // Ratio-mode bets pay stake × ratio exactly (no edge, no cap);
      // probability-mode bets run the historic normalizeOdds. The mode is
      // read off the same answer config the odds came from.
      const mode = resolvePricingMode(bet.answerConfig as AnswerConfig);
      pickPayout = liveOptionPayout(optionOdds, effectiveStake, mode, {
        baseStake: effectiveStake,
        maxPayout: liveStakeCap(effectiveStake, liveCfg),
        houseEdgePct: liveCfg.houseEdgePct,
      });
    } else {
      // Legacy or partially-priced live bet (no decimalOdds captured at
      // publish). Linearly scale the bet's snapshotted payout to the
      // player's chosen stake and apply the new cap so a stake-30 player
      // still gets a meaningfully different number than a stake-3 player.
      // Logged loudly so a publish path that forgot to store odds shows
      // up in the console without waiting for a player to file a bug.
      console.warn("[custom-bet stake] no_odds_fallback", {
        userId: principal.userId,
        betId: input.customBetId,
        answerType: bet.answerType,
        snapshotStake: bet.stakeSnapshot,
        snapshotPayout: bet.payoutSnapshot,
      });
      const baseStakeForScale = Math.max(1, bet.stakeSnapshot);
      const basePayout = resolvePickPayoutAtSubmit({
        answerType: bet.answerType,
        answerConfig: bet.answerConfig,
        answer: input.answer,
        betLevelPayout: bet.payoutSnapshot,
      });
      const cap = liveStakeCap(effectiveStake, liveCfg);
      const scaled = Math.round((basePayout * effectiveStake) / baseStakeForScale);
      pickPayout = Math.min(Math.max(scaled, effectiveStake + 1), cap);
    }
  }

  const balanceRows = await tx.execute(
    sql`select ${bankBalanceSql(principal.userId)} as balance`,
  );
  const balance = Number(
    (balanceRows as unknown as Array<{ balance: number }>)[0]?.balance ?? 0,
  );
  // The pick being overwritten was already debited; treat it as a refund
  // so editing an existing pick doesn't fail just because the bank shows
  // the old stake still subtracted.
  const refund = existing?.stakePaid ?? 0;
  const effectiveBalance = balance + refund;
  // Free picks (tournament/stage/group) never touch the bank. Skip the
  // guard so a player currently locked from live/duel can still place /
  // edit free picks — the recovery path back to a positive bank.
  if (!isFreePick) {
    const guard = assertBettingAllowed({
      balance: effectiveBalance,
      stake: effectiveStake,
      maxOverdraft: overdraft.maxOverdraft,
      lockWhenNegative: overdraft.lockBetsWhenNegative,
    });
    if (!guard.ok) {
      if (guard.reason === "negative_balance_locked") {
        console.info("[bets guard] negative_balance_locked", {
          userId: principal.userId,
          betId: input.customBetId,
          balance: guard.balance,
        });
        return { status: "skipped", reason: "negative_balance_locked" };
      }
      console.info("[bets guard] overdraft_exceeded", {
        userId: principal.userId,
        betId: input.customBetId,
        balance: guard.balance,
        stake: effectiveStake,
        cap: guard.cap,
      });
      return {
        status: "skipped",
        reason: "overdraft_exceeded",
        needed: guard.needed,
      };
    }
    if (effectiveBalance - effectiveStake < 0) {
      console.info("[bets guard] overdraft_taken", {
        userId: principal.userId,
        betId: input.customBetId,
        balanceBefore: effectiveBalance,
        balanceAfter: effectiveBalance - effectiveStake,
        cap: overdraft.maxOverdraft,
      });
    }
  }

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
    // Read global settings BEFORE the lock so the locked txn makes no
    // global-`db` round trip while it holds the advisory lock.
    const overdraft = await getOverdraftConfig();
    return await db.transaction(async (tx) => {
      await lockUserForBetting(tx, principal.userId);
      return writeCustomPickTx(tx, principal, input, opts, overdraft);
    });
  } catch (err) {
    console.error("[write-core customPick] failed", err);
    return { status: "error", error: "db" };
  }
}

// ---- custom bet cancel (owner) ----

// Owner-explicit cancel for one custom-bet pick. Same advisory-locked
// txn pattern as writeCustomPick so a concurrent save/cancel from the
// same user is serialized. Bank refund is implicit because the balance
// is a derived SQL query — removing the pick row removes its stake from
// the live-running sum.
export async function cancelCustomPickSelf(
  principal: WritePrincipal,
  input: { customBetId: string },
): Promise<WriteOutcome> {
  if (principal.kind !== "self") {
    return { status: "skipped", reason: "not_allowed" };
  }
  if (!gateAccess(principal)) return { status: "skipped", reason: "not_allowed" };

  try {
    return await db.transaction(async (tx) => {
      await lockUserForBetting(tx, principal.userId);

      const [bet] = await tx
        .select({
          id: customBets.id,
          scope: customBets.scope,
          status: customBets.status,
          lockAt: customBets.lockAt,
        })
        .from(customBets)
        .where(eq(customBets.id, input.customBetId))
        .limit(1);
      if (!bet) return { status: "error", error: "bet_not_found" };
      if (bet.status !== "open") return { status: "skipped", reason: "closed" };

      const resolved = resolveCustomBetLock({
        id: bet.id,
        scope: bet.scope,
        lockAt: bet.lockAt,
      });
      if (resolved.effectiveLockAt.getTime() <= Date.now()) {
        return { status: "skipped", reason: "locked" };
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
      if (!existing) return { status: "skipped", reason: "already_filled" };
      // Once a pick is row-locked (grading-in-flight admin grade prep)
      // we refuse cancel even though the bet header may still say open.
      if (existing.locked) return { status: "skipped", reason: "locked" };

      await tx
        .delete(userCustomBetPicks)
        .where(eq(userCustomBetPicks.id, existing.id));

      const balanceRows = await tx.execute(
        sql`select ${bankBalanceSql(principal.userId)} as balance`,
      );
      const balance = Number(
        (balanceRows as unknown as Array<{ balance: number }>)[0]?.balance ?? 0,
      );
      return { status: "filled", balanceAfter: balance };
    });
  } catch (err) {
    console.error("[write-core cancelCustomPickSelf] failed", err);
    return { status: "error", error: "db" };
  }
}

// ---- admin proxy writers ----
//
// Phase 2 of _plans/2026-06-08-admin-bet-inspector.md. These four
// entrypoints are the ONLY path an admin uses to write/clear a pick on
// behalf of another user. Each opens its own transaction so the pick
// mutation and the bet_admin_audit row land atomically — if the audit
// insert fails (e.g. DB CHECK on reason), the data write rolls back
// with it. Callers MUST call requireAdmin() before constructing the
// principal — bet-immutability.test.ts enforces this at source level.
//
// `lockBypassed` maps to the internal `allowAfterDeadline` flag, but
// unlike the grace auto-fill the audit row stamps `lock_bypassed=true`
// so a future report can distinguish admin overrides from grace fills.

type AdminPrincipal = Extract<WritePrincipal, { kind: "admin_proxy" }>;

// Exported only for unit testing — every admin write entrypoint runs
// this guard, and the same shape is enforced again at the DB level by
// the bet_admin_audit CHECK on `reason`.
export function assertAdminReason(reason: string): void {
  if (typeof reason !== "string" || reason.trim().length === 0) {
    throw new Error("admin_proxy write requires a non-empty reason");
  }
}

export async function writeMatchPickAdmin(
  principal: AdminPrincipal,
  input: MatchPickInput,
): Promise<WriteOutcome> {
  if (!gateAccess(principal)) return { status: "skipped", reason: "not_allowed" };
  assertAdminReason(principal.reason);
  if (!Number.isFinite(input.home) || !Number.isFinite(input.away)) {
    return { status: "error", error: "invalid" };
  }
  const h = Math.max(0, Math.min(99, Math.floor(input.home)));
  const a = Math.max(0, Math.min(99, Math.floor(input.away)));

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
  // Admin never writes a score for a match that has already kicked off,
  // even with lockBypassed — the score itself is already moving.
  if (new Date(r.kickoff_at).getTime() <= Date.now()) {
    return { status: "skipped", reason: "closed" };
  }

  if (!principal.lockBypassed) {
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
    if (resolved.effectiveLockAt.getTime() <= Date.now()) {
      return { status: "skipped", reason: "locked" };
    }
  }
  const stakeSnapshot = r.risk_enabled ? r.risk_penalty : null;

  try {
    return await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({
          id: matchBets.id,
          homeScore: matchBets.homeScore,
          awayScore: matchBets.awayScore,
        })
        .from(matchBets)
        .where(
          and(
            eq(matchBets.userId, principal.userId),
            eq(matchBets.matchId, input.matchId),
          ),
        )
        .limit(1);

      await tx
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

      await tx.insert(betAdminAudit).values({
        adminId: principal.adminId,
        targetUserId: principal.userId,
        action: "set",
        surface: "match",
        matchId: input.matchId,
        customBetId: null,
        before: existing
          ? { home: existing.homeScore, away: existing.awayScore }
          : null,
        after: { home: h, away: a },
        reason: principal.reason.trim(),
        lockBypassed: principal.lockBypassed,
      });
      console.info("[admin bet write]", {
        step: "set_match",
        adminId: principal.adminId,
        targetUserId: principal.userId,
        matchId: input.matchId,
        before: existing
          ? { home: existing.homeScore, away: existing.awayScore }
          : null,
        after: { home: h, away: a },
        lockBypassed: principal.lockBypassed,
        reason: principal.reason.slice(0, 80),
      });
      return { status: "filled", balanceAfter: null };
    });
  } catch (err) {
    console.error("[write-core matchPickAdmin] failed", err);
    return { status: "error", error: "db" };
  }
}

export async function clearMatchPickAdmin(
  principal: AdminPrincipal,
  matchId: string,
): Promise<WriteOutcome> {
  if (!gateAccess(principal)) return { status: "skipped", reason: "not_allowed" };
  assertAdminReason(principal.reason);

  try {
    return await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({
          id: matchBets.id,
          homeScore: matchBets.homeScore,
          awayScore: matchBets.awayScore,
        })
        .from(matchBets)
        .where(
          and(
            eq(matchBets.userId, principal.userId),
            eq(matchBets.matchId, matchId),
          ),
        )
        .limit(1);
      if (!existing) return { status: "skipped", reason: "already_filled" };
      await tx.delete(matchBets).where(eq(matchBets.id, existing.id));
      await tx.insert(betAdminAudit).values({
        adminId: principal.adminId,
        targetUserId: principal.userId,
        action: "clear",
        surface: "match",
        matchId,
        customBetId: null,
        before: { home: existing.homeScore, away: existing.awayScore },
        after: null,
        reason: principal.reason.trim(),
        lockBypassed: principal.lockBypassed,
      });
      console.info("[admin bet write]", {
        step: "clear_match",
        adminId: principal.adminId,
        targetUserId: principal.userId,
        matchId,
        before: { home: existing.homeScore, away: existing.awayScore },
        lockBypassed: principal.lockBypassed,
        reason: principal.reason.slice(0, 80),
      });
      return { status: "filled", balanceAfter: null };
    });
  } catch (err) {
    console.error("[write-core clearMatchPickAdmin] failed", err);
    return { status: "error", error: "db" };
  }
}

export async function writeCustomPickAdmin(
  principal: AdminPrincipal,
  input: CustomPickInput,
): Promise<WriteOutcome> {
  if (!gateAccess(principal)) return { status: "skipped", reason: "not_allowed" };
  assertAdminReason(principal.reason);

  try {
    // Settings read hoisted out of the lock (see writeCustomPickTx).
    const overdraft = await getOverdraftConfig();
    return await db.transaction(async (tx) => {
      await lockUserForBetting(tx, principal.userId);

      const [beforePick] = await tx
        .select({ answer: userCustomBetPicks.answer })
        .from(userCustomBetPicks)
        .where(
          and(
            eq(userCustomBetPicks.userId, principal.userId),
            eq(userCustomBetPicks.customBetId, input.customBetId),
          ),
        )
        .limit(1);

      const outcome = await writeCustomPickTx(
        tx,
        principal,
        input,
        { overwrite: true, allowAfterDeadline: principal.lockBypassed },
        overdraft,
      );
      if (outcome.status !== "filled") return outcome;

      await tx.insert(betAdminAudit).values({
        adminId: principal.adminId,
        targetUserId: principal.userId,
        action: "set",
        surface: "custom",
        matchId: null,
        customBetId: input.customBetId,
        before: beforePick?.answer ?? null,
        after: input.answer,
        reason: principal.reason.trim(),
        lockBypassed: principal.lockBypassed,
      });
      console.info("[admin bet write]", {
        step: "set_custom",
        adminId: principal.adminId,
        targetUserId: principal.userId,
        betId: input.customBetId,
        before: beforePick?.answer ?? null,
        after: input.answer,
        lockBypassed: principal.lockBypassed,
        reason: principal.reason.slice(0, 80),
      });
      return outcome;
    });
  } catch (err) {
    console.error("[write-core customPickAdmin] failed", err);
    return { status: "error", error: "db" };
  }
}

export async function clearCustomPickAdmin(
  principal: AdminPrincipal,
  customBetId: string,
): Promise<WriteOutcome> {
  if (!gateAccess(principal)) return { status: "skipped", reason: "not_allowed" };
  assertAdminReason(principal.reason);

  try {
    return await db.transaction(async (tx) => {
      await lockUserForBetting(tx, principal.userId);
      const [existing] = await tx
        .select({
          id: userCustomBetPicks.id,
          answer: userCustomBetPicks.answer,
        })
        .from(userCustomBetPicks)
        .where(
          and(
            eq(userCustomBetPicks.userId, principal.userId),
            eq(userCustomBetPicks.customBetId, customBetId),
          ),
        )
        .limit(1);
      if (!existing) return { status: "skipped", reason: "already_filled" };
      await tx
        .delete(userCustomBetPicks)
        .where(eq(userCustomBetPicks.id, existing.id));
      await tx.insert(betAdminAudit).values({
        adminId: principal.adminId,
        targetUserId: principal.userId,
        action: "clear",
        surface: "custom",
        matchId: null,
        customBetId,
        before: existing.answer,
        after: null,
        reason: principal.reason.trim(),
        lockBypassed: principal.lockBypassed,
      });
      console.info("[admin bet write]", {
        step: "clear_custom",
        adminId: principal.adminId,
        targetUserId: principal.userId,
        betId: customBetId,
        before: existing.answer,
        lockBypassed: principal.lockBypassed,
        reason: principal.reason.slice(0, 80),
      });
      return { status: "filled", balanceAfter: null };
    });
  } catch (err) {
    console.error("[write-core clearCustomPickAdmin] failed", err);
    return { status: "error", error: "db" };
  }
}

// Live (match/day) stake settings read inside the same advisory-locked
// txn as the bet fetch, so an admin tweaking the bounds mid-session
// applies to the very next submit. One small extra round trip per live
// submit; trivial cost relative to the bank-balance recalc that
// follows.
type LiveStakeConfig = {
  baseStake: number;
  minStake: number;
  maxStake: number;
  maxPayoutRatio: number;
  maxPayoutCeiling: number;
  houseEdgePct: number;
};

async function loadLiveStakeConfig(tx: Tx): Promise<LiveStakeConfig> {
  const [row] = await tx
    .select({
      baseStake: settings.liveOddsBaseStake,
      minStake: settings.liveOddsMinStake,
      maxStake: settings.liveOddsMaxStake,
      maxPayoutRatio: settings.liveOddsMaxPayoutRatio,
      maxPayoutCeiling: settings.liveOddsMaxPayoutCeiling,
      houseEdgePct: settings.liveOddsHouseEdgePct,
    })
    .from(settings)
    .where(eq(settings.id, 1))
    .limit(1);
  return {
    baseStake: row?.baseStake ?? 3,
    minStake: row?.minStake ?? 1,
    maxStake: row?.maxStake ?? 30,
    maxPayoutRatio: row?.maxPayoutRatio ?? 8,
    maxPayoutCeiling: row?.maxPayoutCeiling ?? 100,
    houseEdgePct: row?.houseEdgePct ?? 5,
  };
}

// Translates a player's requested stake into the effective integer stake
// used by the bank check and the payout recomputation. Trusts the bet's
// own stakeSnapshot as the fallback (legacy default = settings.baseStake
// at publish time) when the caller does not pass a request.
//
// `clamped: true` means the caller asked for a value outside the admin
// bounds — kept as a separate flag so the action layer can log it for
// observability. Tampered clients trip this; honest pill taps don't
// (the bet card only renders stake values that already sit inside the
// admin range).
export function resolveLiveStake(
  requested: number | undefined,
  fallbackStake: number,
  config: { minStake: number; maxStake: number },
): { stake: number; clamped: boolean } {
  if (requested === undefined) {
    return { stake: Math.max(config.minStake, Math.min(config.maxStake, fallbackStake)), clamped: false };
  }
  if (!Number.isFinite(requested) || !Number.isInteger(requested)) {
    return { stake: config.minStake, clamped: true };
  }
  const clamped = Math.max(config.minStake, Math.min(config.maxStake, requested));
  return { stake: clamped, clamped: clamped !== requested };
}

// Look up the bookmaker decimal odds that apply to the option the player
// picked, so the variable-stake submit path can recompute payout exactly.
//   - Single-side bets (yes_no without per-side overrides) read the
//     bet-level decimal_odds column.
//   - Multi-choice bets read the per-option map written by
//     publishMultiChoiceSuggestion.
//   - Yes/no bets with per-side odds (decimalOddsYes/No) read the side
//     matching the player's pick, so a lopsided binary ("no VAR" is far
//     likelier than "VAR") prices each outcome on its own probability
//     instead of sharing one bet-level number. Falls back to the
//     bet-level decimal_odds when a side has no odds captured.
// Returns null when no odds value is available — the caller logs and
// falls back to linear scaling so the player is never blocked.
function resolveLiveOptionOdds(args: {
  answerType: "yes_no" | "number" | "multi_choice" | "free_text";
  answerConfig: unknown;
  betLevelDecimalOdds: number | null;
  answer: PickAnswer;
}): number | null {
  if (args.answerType === "multi_choice" && args.answer.type === "multi_choice") {
    const cfg = args.answerConfig as
      | { decimalOddsByValue?: Record<string, number> }
      | null
      | undefined;
    const v = cfg?.decimalOddsByValue?.[args.answer.value];
    if (typeof v === "number" && Number.isFinite(v) && v > 1) return v;
    return null;
  }
  if (args.answerType === "yes_no" && args.answer.type === "yes_no") {
    const cfg = args.answerConfig as
      | { decimalOddsYes?: number; decimalOddsNo?: number }
      | null
      | undefined;
    const sideOdds = resolveYesNoSideOdds(cfg, args.answer.value);
    if (sideOdds != null) return sideOdds;
    // No per-side odds — fall through to the shared bet-level value.
  }
  if (args.betLevelDecimalOdds != null && Number.isFinite(args.betLevelDecimalOdds) && args.betLevelDecimalOdds > 1) {
    return args.betLevelDecimalOdds;
  }
  return null;
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
    // One settings read for the whole batch, BEFORE the lock — the loop
    // below never makes a global-`db` round trip under the advisory lock.
    const overdraft = await getOverdraftConfig();
    return await db.transaction(async (tx) => {
      await lockUserForBetting(tx, principal.userId);
      const out: WriteOutcome[] = [];
      for (const item of items) {
        out.push(await writeCustomPickTx(tx, principal, item, opts, overdraft));
      }
      return out;
    });
  } catch (err) {
    console.error("[write-core customPicksBulk] failed", err);
    return items.map(() => ({ status: "error", error: "db" }));
  }
}
