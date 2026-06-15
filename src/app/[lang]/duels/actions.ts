"use server";

import { revalidatePath, updateTag } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { execFirstRow, execRows } from "@/db/helpers";
import { duels, matches as matchesTable, matchdays, settings } from "@/db/schema";
import { getUser } from "@/lib/supabase/auth";
import { hasPermission } from "@/lib/admin";
import { getUserAccess } from "@/lib/access";
import {
  assertBettingAllowed,
  bankBalanceSql,
  bankCacheTag,
  getOverdraftConfig,
  lockUserForBetting,
} from "@/lib/bank";
import { CACHE_TAG_LEADERBOARD } from "@/db/queries";
import { sendEmail } from "@/lib/email/client";
import { getEmailCopy, interpolate } from "@/lib/email/copy";
import { DuelJoinedEmail } from "@/lib/email/templates/DuelJoinedEmail";
import { notifyUsers } from "@/lib/notifications";
import { MS_PER_HOUR, MS_PER_MINUTE, daysFromNow } from "@/lib/time";
import {
  findOption,
  validateOptions,
  type DuelOption,
} from "@/lib/duels/options";

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
  | "negative_balance_locked"
  | "overdraft_exceeded"
  | "rate_limited"
  | "match_not_found"
  | "match_locked"
  | "match_stage_locked"
  | "matchday_empty"
  | "deadline_past"
  | "duel_not_found"
  | "duel_already_joined"
  | "duel_closed"
  | "duel_self_join"
  | "already_settled"
  | "option_taken"
  | "invalid_options"
  | "db";

// Optional auto-settle config. The sync pass evaluates
// `stat <comparator> threshold` against API-Football combined stats
// for the anchored fixture. Only valid when scope='match'.
export type DuelAutoGradeConfig = {
  stat: string;
  comparator: ">" | ">=" | "<" | "<=" | "=";
  threshold: number;
};

export type OpenDuelInput = {
  scope: "match" | "day" | "tournament";
  matchId?: string | null;
  matchdayDate?: string | null;       // YYYY-MM-DD, Asia/Jerusalem
  // Either the LEGACY yes/no pair (openerAnswer required, options NULL)
  // or the NEW custom-option pair (options non-empty + openerOption set).
  // Both branches go through openDuel() because the lifecycle / cancel /
  // join machinery is identical; only the persisted columns differ.
  openerAnswer?: boolean | null;
  options?: DuelOption[] | null;
  openerOption?: string | null;
  stake: number;
  questionHe: string;
  questionEn: string;
  gradingRuleHe: string;
  gradingRuleEn: string;
  // Optional auto-settle. When non-null + scope='match', the duel
  // settles from API-Football stats after the fixture goes final.
  // Players can opt in for stat-based questions like "more than 2
  // yellow cards"; everything else stays manual.
  autoGrade?: DuelAutoGradeConfig | null;
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

  // 1b) Shape: legacy (openerAnswer) vs new-style (options + openerOption).
  // Either branch must be unambiguous; we never let a request land both
  // shapes because the DB CHECK rejects mixed rows. Empty options array
  // is treated as "legacy intended" (the form sends [] when the opener
  // sticks with the default yes/no UI).
  const hasOptions = Array.isArray(input.options) && input.options.length > 0;
  const hasLegacyAnswer = typeof input.openerAnswer === "boolean";
  if (hasOptions === hasLegacyAnswer) {
    // Both true (mixed) or both false (neither) — both are invalid.
    return { ok: false, error: "invalid_input" };
  }

  let normalisedOptions: DuelOption[] | null = null;
  let openerOptionKey: string | null = null;
  let openerOptionMultiplierPct: number | null = null;
  if (hasOptions) {
    const validation = validateOptions(input.options);
    if (!validation.ok) return { ok: false, error: "invalid_options" };
    normalisedOptions = validation.options;
    if (typeof input.openerOption !== "string" || input.openerOption.length === 0) {
      return { ok: false, error: "invalid_options" };
    }
    const picked = findOption(normalisedOptions, input.openerOption);
    if (!picked) return { ok: false, error: "invalid_options" };
    openerOptionKey = picked.key;
    openerOptionMultiplierPct = picked.multiplierPct;
  }

  // 2) Read live duel limits + earliest fixture in scope to derive the
  // resolve / lock times. Stake cap and join-window default both
  // come from settings so the admin can tune them mid-tournament.
  const [s] = await db
    .select({
      duelMaxStake: settings.duelMaxStake,
      duelDefaultJoinWindowHours: settings.duelDefaultJoinWindowHours,
      duelDailyLimit: settings.duelDailyLimit,
    })
    .from(settings)
    .where(eq(settings.id, 1));
  if (!s) return { ok: false, error: "db" };
  if (input.stake > s.duelMaxStake) {
    return { ok: false, error: "stake_too_high" };
  }

  // Per-user daily rate limit. Counts every duel the user opened in
  // the last 24h (including those that auto-cancelled with no joiner)
  // so a script that hammers openDuel can't flood the feed even at
  // stake=1. Bound mirrors settings.duel_daily_limit.
  const recentRow = await execFirstRow<{ count: number }>(sql`
    select count(*)::int as "count"
    from public.duels d
    where d.opener_id = ${user.id}
      and d.created_at > now() - interval '24 hours'
  `);
  const recentCount = recentRow?.count ?? 0;
  if (recentCount >= s.duelDailyLimit) {
    return { ok: false, error: "rate_limited" };
  }

  // 2b) Validate auto-grade config shape. Only allowed for match
  // scope; any other scope drops the config to null so the DB row
  // stays consistent with grading_source='manual'.
  let autoGrade: DuelAutoGradeConfig | null = null;
  if (input.autoGrade && input.scope === "match") {
    const ag = input.autoGrade;
    if (
      typeof ag.stat !== "string" ||
      ag.stat.trim().length === 0 ||
      !Number.isFinite(ag.threshold) ||
      !["<", "<=", "=", ">=", ">"].includes(ag.comparator)
    ) {
      return { ok: false, error: "invalid_input" };
    }
    autoGrade = {
      stat: ag.stat,
      comparator: ag.comparator,
      threshold: Number(ag.threshold),
    };
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
        stage: matchesTable.stage,
      })
      .from(matchesTable)
      .where(eq(matchesTable.id, input.matchId))
      .limit(1);
    if (!m) return { ok: false, error: "match_not_found" };
    if (m.status !== "scheduled") return { ok: false, error: "match_locked" };
    // Match duels are available up to and including the semi-finals.
    // The final and the third-place playoff cannot host a duel. The
    // /new picker already hides these fixtures; this is the server-side
    // twin that rejects a tampered request shipping a final-match id.
    if (m.stage === "final" || m.stage === "third_place") {
      return { ok: false, error: "match_stage_locked" };
    }
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
    // tournament - no anchor; resolve_at is set to "kickoff + 60d" as
    // a safe far-future fallback. Admin can settle manually anytime.
    resolveAt = new Date(daysFromNow(60));
  }

  // Join deadline can never sit later than 60 minutes before the
  // duel resolves (kickoff / earliest-of-day / far-future for
  // tournament-scope). Mirrors the pool-wide "one hour before the
  // relevant match or matchday" cutoff that applies to every bet
  // surface except the global match-picks cap.
  const defaultDeadline = new Date(
    Math.min(
      resolveAt.getTime() - 60 * MS_PER_MINUTE,
      Date.now() + s.duelDefaultJoinWindowHours * MS_PER_HOUR,
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
  // Enforce the "at least one hour before the resolve anchor" rule on
  // user-provided deadlines too. The default branch above already
  // respects it; this guard catches manual overrides from a custom join
  // deadline picker (or a tampered request).
  if (joinDeadlineAt.getTime() > resolveAt.getTime() - 60 * 60_000) {
    return { ok: false, error: "deadline_past" };
  }

  // 3) Serializable txn: lock the opener, check balance, insert.
  // Returns either the inserted id or a guard rejection reason.
  type OpenTxnResult =
    | { kind: "ok"; id: string }
    | { kind: "guard"; reason: "negative_balance_locked" | "overdraft_exceeded" };
  try {
    const overdraft = await getOverdraftConfig();
    const inserted = await db.transaction<OpenTxnResult>(async (tx) => {
      await lockUserForBetting(tx, user.id);
      const balanceRows = await tx.execute(
        sql`select ${bankBalanceSql(user.id)} as balance`,
      );
      const balance =
        (balanceRows as unknown as Array<{ balance: number }>)[0]?.balance ?? 0;
      const guard = assertBettingAllowed({
        balance,
        stake: input.stake,
        maxOverdraft: overdraft.maxOverdraft,
        lockWhenNegative: overdraft.lockBetsWhenNegative,
      });
      if (!guard.ok) {
        if (guard.reason === "negative_balance_locked") {
          console.info("[duel open guard] negative_balance_locked", {
            userId: user.id,
            balance: guard.balance,
            stake: input.stake,
          });
          return { kind: "guard", reason: "negative_balance_locked" };
        }
        console.info("[duel open guard] overdraft_exceeded", {
          userId: user.id,
          balance: guard.balance,
          stake: input.stake,
          cap: guard.cap,
        });
        return { kind: "guard", reason: "overdraft_exceeded" };
      }
      if (balance - input.stake < 0) {
        console.info("[duel open guard] overdraft_taken", {
          userId: user.id,
          balanceBefore: balance,
          balanceAfter: balance - input.stake,
          cap: overdraft.maxOverdraft,
        });
      }

      const [row] = await tx
        .insert(duels)
        .values({
          openerId: user.id,
          openerAnswer: hasLegacyAnswer ? input.openerAnswer! : null,
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
          gradingSource: autoGrade ? "auto_api_football" : "manual",
          gradingConfig: autoGrade,
          options: normalisedOptions,
          openerOption: openerOptionKey,
          openerOptionMultiplierPct: openerOptionMultiplierPct,
        })
        .returning({ id: duels.id });
      return { kind: "ok", id: row.id };
    });

    if (inserted.kind === "guard") {
      return { ok: false, error: inserted.reason };
    }

    const duelId = inserted.id;
    console.info("[duel open]", {
      duelId,
      openerId: user.id,
      stake: input.stake,
      scope: input.scope,
      deadlineAt: joinDeadlineAt.toISOString(),
      shape: hasOptions ? "options" : "legacy",
      openerOption: openerOptionKey,
      openerOptionMultiplierPct,
    });

    // Fire the "new duel opened" notification to every paid player
    // except the opener. Push is gated per-user by push_opt_in AND
    // push_duel_received (see _plans/2026-05-30-smart-reminders.md
    // §3.4). Best-effort; failures are logged inside notifyUsers and
    // never block the user's response.
    void notifyDuelOpened(
      duelId,
      user.id,
      input.questionHe.trim(),
      input.questionEn.trim(),
      input.stake,
    );

    updateTag(bankCacheTag(user.id));
    // Targeted page invalidation — see saveBet for why the previous
    // `revalidatePath("/", "layout")` was making submit buttons hang
    // inside `useTransition` until the whole shell re-rendered.
    revalidatePath("/[lang]/duels", "layout");
    revalidatePath("/[lang]/me", "page");
    return { ok: true, id: duelId };
  } catch (err) {
    console.error("[duel open] insert failed:", err);
    return { ok: false, error: "db" };
  }
}

export type JoinDuelResult =
  | { ok: true }
  | { ok: false; error: DuelErr };

// `joinerOption` is the option key the joiner picked for custom-option
// duels. Legacy yes/no duels ignore it (joiner always takes the opposite
// side automatically). Server re-derives multiplier from the stored
// options array - never trust the client to ship a multiplier.
export async function joinDuel(
  id: string,
  joinerOption?: string | null,
): Promise<JoinDuelResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauth" };
  const access = await getUserAccess(user.id);
  if (!access.canEdit) return { ok: false, error: "not_paid" };

  try {
    const overdraft = await getOverdraftConfig();
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
          options: duels.options,
          openerOption: duels.openerOption,
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

      // Resolve the joiner's pick + multiplier for custom-option duels.
      // Validate it's a real option, it's not the opener's pick, and
      // freeze the multiplier so the bank.ts SQL never has to unpack the
      // jsonb array per row.
      let joinerOptionKey: string | null = null;
      let joinerMultiplierPct: number | null = null;
      if (d.options) {
        const opts = d.options as unknown as DuelOption[];
        if (typeof joinerOption !== "string" || joinerOption.length === 0) {
          return { ok: false as const, error: "invalid_options" as const };
        }
        const picked = findOption(opts, joinerOption);
        if (!picked) {
          return { ok: false as const, error: "invalid_options" as const };
        }
        if (picked.key === d.openerOption) {
          return { ok: false as const, error: "option_taken" as const };
        }
        joinerOptionKey = picked.key;
        joinerMultiplierPct = picked.multiplierPct;
      }

      // Re-check balance inside the txn so the bank read picks up any
      // other in-flight stake debits from the same user. Negative-balance
      // lock + overdraft cap also enforced here — joining is just as
      // bank-spending as opening.
      const balanceRows = await tx.execute(
        sql`select ${bankBalanceSql(user.id)} as balance`,
      );
      const balance =
        (balanceRows as unknown as Array<{ balance: number }>)[0]?.balance ??
        0;
      const guard = assertBettingAllowed({
        balance,
        stake: d.stake,
        maxOverdraft: overdraft.maxOverdraft,
        lockWhenNegative: overdraft.lockBetsWhenNegative,
      });
      if (!guard.ok) {
        if (guard.reason === "negative_balance_locked") {
          console.info("[duel join guard] negative_balance_locked", {
            userId: user.id,
            duelId: id,
            balance: guard.balance,
            stake: d.stake,
          });
          return {
            ok: false as const,
            error: "negative_balance_locked" as const,
          };
        }
        console.info("[duel join guard] overdraft_exceeded", {
          userId: user.id,
          duelId: id,
          balance: guard.balance,
          stake: d.stake,
          cap: guard.cap,
        });
        return { ok: false as const, error: "overdraft_exceeded" as const };
      }
      if (balance - d.stake < 0) {
        console.info("[duel join guard] overdraft_taken", {
          userId: user.id,
          duelId: id,
          balanceBefore: balance,
          balanceAfter: balance - d.stake,
          cap: overdraft.maxOverdraft,
        });
      }

      await tx
        .update(duels)
        .set({
          joinerId: user.id,
          joinedAt: new Date(),
          status: "matched",
          joinerOption: joinerOptionKey,
          joinerOptionMultiplierPct: joinerMultiplierPct,
        })
        .where(and(eq(duels.id, id), eq(duels.status, "open")));
      return {
        ok: true as const,
        stake: d.stake,
        openerId: d.openerId,
        joinerOption: joinerOptionKey,
      };
    });

    if (!result.ok) return result;
    console.info("[duel join]", {
      duelId: id,
      joinerId: user.id,
      stake: result.stake,
      joinerOption: result.joinerOption,
    });

    // Best-effort notification to the opener. Outside the txn so a
    // Resend hiccup never rolls back the join. notifyDuelJoined logs
    // its own failures and returns void.
    void notifyDuelJoined(id, user.id);

    // Both joiner AND opener now have a -stake debit. Drop both
    // bank caches so the opener's header pill reflects the new
    // "in flight" debit on their next nav.
    updateTag(bankCacheTag(user.id));
    if (result.openerId) updateTag(bankCacheTag(result.openerId));
    revalidatePath("/[lang]/duels", "layout");
    revalidatePath("/[lang]/me", "page");
    return { ok: true };
  } catch (err) {
    console.error("[duel join] failed:", err);
    return { ok: false, error: "db" };
  }
}

// Send the opener an email letting them know somebody joined their
// duel. Reads the opener's email from auth.users; if anything is
// missing (no email, Resend not configured, send fails) we log and
// return - joining is the source of truth, the email is gravy.
async function notifyDuelJoined(
  duelId: string,
  joinerId: string,
): Promise<void> {
  try {
    const r = await execFirstRow<{
      opener_email: string | null;
      opener_name: string;
      joiner_name: string;
      question_he: string;
      question_en: string;
      stake: number;
    }>(sql`
      select
        ou.email                  as "opener_email",
        op.display_name           as "opener_name",
        jp.display_name           as "joiner_name",
        d.question_he             as "question_he",
        d.question_en             as "question_en",
        d.stake                   as "stake"
      from public.duels d
      join public.profiles op on op.id = d.opener_id
      join public.profiles jp on jp.id = ${joinerId}::uuid
      left join auth.users ou on ou.id = d.opener_id
      where d.id = ${duelId}::uuid
      limit 1
    `);
    if (!r || !r.opener_email) {
      console.warn("[duel email skipped]", {
        duelId,
        reason: r ? "no_opener_email" : "duel_row_missing",
      });
      return;
    }

    const base =
      process.env.NEXT_PUBLIC_SITE_URL ??
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
    const duelUrl = base ? `${base}/he/duels/${duelId}` : `/he/duels/${duelId}`;

    const emails = await getEmailCopy("he");
    const duelCopy = emails.duelJoined;
    const slots = {
      openerName: r.opener_name,
      joinerName: r.joiner_name,
      stake: r.stake,
      questionEn: r.question_en,
    };
    await sendEmail({
      to: r.opener_email,
      subject: `${duelCopy.preview}: ${r.question_he.slice(0, 60)}`,
      react: DuelJoinedEmail({
        preview: duelCopy.preview,
        heading: interpolate(duelCopy.heading, slots),
        questionLabel: duelCopy.questionLabel,
        body: interpolate(duelCopy.body, slots),
        buttonText: duelCopy.buttonText,
        englishParagraph: interpolate(duelCopy.englishParagraph, slots),
        footer: duelCopy.footer,
        questionHe: r.question_he,
        duelUrl,
      }),
    });
  } catch (err) {
    console.error("[duel email failed]", { duelId, err });
  }
}

export type SettleDuelResult =
  | { ok: true }
  | { ok: false; error: DuelErr };

// Manual settle by an admin OR a scoped bet-manager (the `liveBets`
// permission). Accepts either a boolean (legacy yes/no duels) or a
// string option key (custom-option duels). The action picks the branch
// off the row's `options` column - the admin UI is responsible for
// sending the right shape, but the action revalidates so a wrong shape
// returns invalid_input rather than corrupting the row.
//
// `hasPermission(liveBets)` returns true for full admins too, so this
// single gate covers both audiences. Settling moves points between the
// two sides, so `settled_by` records the acting user for the audit log.
export async function settleDuel(
  id: string,
  resolved: boolean | string,
): Promise<SettleDuelResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauth" };
  if (!(await hasPermission(user.id, "liveBets")))
    return { ok: false, error: "forbidden" };

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
          options: duels.options,
          openerOption: duels.openerOption,
          joinerOption: duels.joinerOption,
        })
        .from(duels)
        .where(eq(duels.id, id))
        .limit(1);
      if (!d) return { ok: false as const, error: "duel_not_found" as const };
      if (d.status !== "matched")
        return { ok: false as const, error: "already_settled" as const };
      if (!d.joinerId)
        return { ok: false as const, error: "duel_not_found" as const };

      // New-style: admin picks an option key. Validate it belongs to the
      // duel's options array; ignore any boolean payload.
      if (d.options) {
        if (typeof resolved !== "string") {
          return { ok: false as const, error: "invalid_input" as const };
        }
        const opts = d.options as unknown as DuelOption[];
        const picked = findOption(opts, resolved);
        if (!picked) {
          return { ok: false as const, error: "invalid_input" as const };
        }
        await tx
          .update(duels)
          .set({
            status: "settled",
            resolvedOption: picked.key,
            settledAt: new Date(),
            settledBy: user.id,
          })
          .where(and(eq(duels.id, id), eq(duels.status, "matched")));
        const winnerId =
          picked.key === d.openerOption
            ? d.openerId
            : picked.key === d.joinerOption
              ? d.joinerId
              : null;
        const loserId =
          winnerId === d.openerId
            ? d.joinerId
            : winnerId === d.joinerId
              ? d.openerId
              : null;
        return {
          ok: true as const,
          winnerId,
          loserId,
          stake: d.stake,
          resolved: picked.key,
        };
      }

      // Legacy yes/no path.
      if (typeof resolved !== "boolean") {
        return { ok: false as const, error: "invalid_input" as const };
      }
      await tx
        .update(duels)
        .set({
          status: "settled",
          resolvedValue: resolved,
          settledAt: new Date(),
          settledBy: user.id,
        })
        .where(and(eq(duels.id, id), eq(duels.status, "matched")));
      return {
        ok: true as const,
        winnerId:
          resolved === d.openerAnswer ? d.openerId : d.joinerId,
        loserId:
          resolved === d.openerAnswer ? d.joinerId : d.openerId,
        stake: d.stake,
        resolved,
      };
    });

    if (!result.ok) return result;
    console.info("[duel settle]", {
      duelId: id,
      resolved: result.resolved,
      winnerId: result.winnerId,
      loserId: result.loserId,
      stake: result.stake,
      settledBy: user.id,
    });
    // Both sides' banks and the global leaderboard now reflect a new
    // delta. Tag-busts let every other user see fresh numbers on
    // their next nav, not just the admin who settled it.
    if (result.winnerId) updateTag(bankCacheTag(result.winnerId));
    if (result.loserId) updateTag(bankCacheTag(result.loserId));
    updateTag(CACHE_TAG_LEADERBOARD);
    revalidatePath("/[lang]/duels", "layout");
    revalidatePath("/[lang]/leaderboard", "page");
    return { ok: true };
  } catch (err) {
    console.error("[duel settle] failed:", err);
    return { ok: false, error: "db" };
  }
}

export type CancelDuelResult =
  | { ok: true }
  | { ok: false; error: DuelErr };

// Open duel can be cancelled by its opener (no joiner yet) OR by a
// bet-manager (admin or the `liveBets` permission). Matched / settled
// duels can only be cancelled by a manager - that path should be rare
// and is captured via console.info so we know it ran.
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
          joinerId: duels.joinerId,
        })
        .from(duels)
        .where(eq(duels.id, id))
        .limit(1);
      if (!d) return { ok: false as const, error: "duel_not_found" as const };
      if (d.status === "cancelled")
        return { ok: false as const, error: "already_settled" as const };

      const callerIsManager = await hasPermission(user.id, "liveBets");
      const callerIsOpenerOnOpen =
        d.status === "open" && d.openerId === user.id;
      if (!callerIsManager && !callerIsOpenerOnOpen)
        return { ok: false as const, error: "forbidden" as const };

      await tx
        .update(duels)
        .set({ status: "cancelled" })
        .where(eq(duels.id, id));
      return {
        ok: true as const,
        openerId: d.openerId,
        joinerId: d.joinerId,
      };
    });

    if (!result.ok) return result;
    console.info("[duel cancel]", {
      duelId: id,
      reason,
      cancelledBy: user.id,
    });
    // Stakes are refunded — both sides need a fresh bank read.
    updateTag(bankCacheTag(result.openerId));
    if (result.joinerId) updateTag(bankCacheTag(result.joinerId));
    updateTag(CACHE_TAG_LEADERBOARD);
    revalidatePath("/[lang]/duels", "layout");
    revalidatePath("/[lang]/me", "page");
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

// Fan out a "new duel opened" notification to every paid player except
// the opener. Push fires only for users who have BOTH the global
// push_opt_in flag AND the per-trigger push_duel_received flag on; the
// feed row is recorded for everyone so they see it in /notifications
// even if push is muted. Truncates the question to a tap-friendly
// length to avoid wrapping the device's push card.
//
// Called from openDuel after the DB insert succeeds. Best-effort: the
// caller `void`s the promise so a Resend / web-push hiccup never
// blocks the response.
async function notifyDuelOpened(
  duelId: string,
  openerId: string,
  questionHe: string,
  questionEn: string,
  stake: number,
): Promise<void> {
  try {
    // Recipients = paid players minus the opener, split by their
    // push_duel_received flag. Two pools so a single notifyUsers call
    // is enough per pool.
    const rows = await execRows<{ id: string; allow_push: boolean }>(sql`
      select p.id::text as "id",
             (p.push_opt_in and p.push_duel_received) as "allow_push"
      from public.profiles p
      where p.id <> ${openerId}::uuid
        and exists (
          select 1 from public.payments pm
          where pm.user_id = p.id and pm.status = 'approved'
        )
    `);
    if (rows.length === 0) return;

    // Opener display name for the title. One extra round trip but a
    // tiny query; worth the personalization in a friends pool.
    const opener = await execFirstRow<{ display_name: string }>(sql`
      select display_name from public.profiles where id = ${openerId}::uuid
    `);
    const openerName = opener?.display_name ?? "";

    const titleHe = openerName
      ? `${openerName} פתח/ה דו-קרב חדש`
      : "דו-קרב חדש פתוח לכניסה";
    const bodyHe = `על ${stake} נק' · ${truncate(questionHe, 100)}`;
    const titleEn = openerName
      ? `${openerName} just opened a duel`
      : "A new duel is open";
    const bodyEn = `${stake} pts on the line · ${truncate(questionEn, 100)}`;

    // We can't read per-user locale here; the feed page renders the
    // strings as stored, so we pick Hebrew (the primary locale) and
    // append English in the body for the EN subset. Same pattern as
    // the existing match_final notify.
    const pushTargets = rows.filter((r) => r.allow_push).map((r) => r.id);
    const feedOnlyTargets = rows.filter((r) => !r.allow_push).map((r) => r.id);

    const url = `/he/duels/${duelId}`;
    if (pushTargets.length > 0) {
      await notifyUsers(
        { kind: "users", userIds: pushTargets },
        {
          kind: "duel_received",
          title: titleHe,
          body: `${bodyHe}\n${titleEn} — ${bodyEn}`,
          url,
          push: true,
        },
      );
    }
    if (feedOnlyTargets.length > 0) {
      await notifyUsers(
        { kind: "users", userIds: feedOnlyTargets },
        {
          kind: "duel_received",
          title: titleHe,
          body: `${bodyHe}\n${titleEn} — ${bodyEn}`,
          url,
          push: false,
        },
      );
    }
    console.info("[duel notify opened]", {
      duelId,
      openerId,
      push: pushTargets.length,
      feedOnly: feedOnlyTargets.length,
    });
  } catch (err) {
    console.error("[duel notify opened failed]", { duelId, err });
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

async function firstKickoffOnDate(date: string): Promise<Date | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const r = await execFirstRow<{ kickoff_at: string | null }>(sql`
    select min(m.kickoff_at)::text as "kickoff_at"
    from public.matches m
    where (m.kickoff_at at time zone 'Asia/Jerusalem')::date = ${date}::date
      and m.status = 'scheduled'
  `);
  return r?.kickoff_at ? new Date(r.kickoff_at) : null;
}
