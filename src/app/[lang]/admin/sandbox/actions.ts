"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  settings,
  groups,
  teams,
  players,
  matchdays,
  matches,
  syncRuns,
  betLockDefaults,
  stageLockDefaults,
  contentOverrides,
  liveOddsSnapshot,
  outrightOddsSnapshot,
  newsItems,
  newsSyncCursors,
} from "@/db/schema";
import { prodDb } from "@/db/prod-db";
import { getUser } from "@/lib/supabase/auth";
import { isAdmin } from "@/lib/admin";
import { isSandbox } from "@/lib/env";
import {
  diffSettings,
  readSettings,
  type SettingsDiffEntry,
  type SettingsRow,
} from "./diff-helpers";
import {
  compareBranches,
  mergeBranches,
  readGithubEnv,
  type CompareResult,
} from "./github";

// ---------------------------------------------------------------------------
// Common error shape
// ---------------------------------------------------------------------------

export type SandboxErrorCode =
  | "unauth"
  | "forbidden"
  | "not-sandbox"
  | "missing"
  | "db"
  | "auth"
  | "conflict"
  | "github";

// Every action returns a finishedAt so the client can render a
// "completed N seconds ago" line and pin the run to a wall-clock moment.
type Stamped = { startedAt: string; finishedAt: string; durationMs: number };

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

async function requireAdminSandbox(): Promise<
  { ok: true; adminId: string } | { ok: false; error: "unauth" | "forbidden" | "not-sandbox" }
> {
  if (!isSandbox()) {
    console.warn("[admin sandbox guard] denied: not in sandbox env");
    return { ok: false, error: "not-sandbox" };
  }
  const user = await getUser();
  if (!user) return { ok: false, error: "unauth" };
  if (!(await isAdmin(user.id))) {
    console.warn("[admin sandbox guard] denied: not admin", { userId: user.id });
    return { ok: false, error: "forbidden" };
  }
  return { ok: true, adminId: user.id };
}

function nowStamps(started: number): Stamped {
  const finished = Date.now();
  return {
    startedAt: new Date(started).toISOString(),
    finishedAt: new Date(finished).toISOString(),
    durationMs: finished - started,
  };
}

// ---------------------------------------------------------------------------
// pushSettingsToProd
// ---------------------------------------------------------------------------

export type PushSettingsResult =
  | (Stamped & {
      ok: true;
      changedColumns: string[];
      diff: SettingsDiffEntry[];
    })
  | (Stamped & {
      ok: false;
      error: Extract<SandboxErrorCode, "unauth" | "forbidden" | "not-sandbox" | "missing" | "db">;
      detail?: string;
    });

export async function pushSettingsToProd(): Promise<PushSettingsResult> {
  const started = Date.now();
  const guard = await requireAdminSandbox();
  if (!guard.ok) return { ok: false, error: guard.error, ...nowStamps(started) };

  try {
    const [sandboxRow, prodRow] = await Promise.all([
      readSettings(db),
      readSettings(prodDb()),
    ]);
    const diff = diffSettings(sandboxRow, prodRow);
    if (diff.length === 0) {
      console.info("[admin sandbox push-settings] no-op", {
        adminId: guard.adminId,
      });
      return {
        ok: true,
        changedColumns: [],
        diff: [],
        ...nowStamps(started),
      };
    }
    // Build a partial update with only the columns that differ. Drizzle
    // accepts a typed Partial<SettingsRow> shape; cast at the boundary
    // because we're populating keys dynamically from the diff.
    const updates: Partial<SettingsRow> = { updatedAt: new Date() };
    for (const entry of diff) {
      (updates as Record<string, unknown>)[entry.column] = entry.sandboxValue;
    }
    await prodDb()
      .update(settings)
      .set(updates as Partial<typeof settings.$inferInsert>)
      .where(eq(settings.id, 1));
    const stamps = nowStamps(started);
    console.info("[admin sandbox push-settings]", {
      adminId: guard.adminId,
      changedCount: diff.length,
      columns: diff.map((d) => d.column),
      durationMs: stamps.durationMs,
    });
    revalidatePath("/", "layout");
    return {
      ok: true,
      changedColumns: diff.map((d) => d.column),
      diff,
      ...stamps,
    };
  } catch (err) {
    console.error("[admin sandbox push-settings] failed:", err);
    return {
      ok: false,
      error: "db",
      detail: (err as Error).message?.slice(0, 300),
      ...nowStamps(started),
    };
  }
}

// ---------------------------------------------------------------------------
// pushCodeToProd / pullCodeFromProd
// ---------------------------------------------------------------------------

export type CodeSyncResult =
  | (Stamped & {
      ok: true;
      direction: "push" | "pull";
      merged: boolean;
      mergeSha?: string;
      mergeUrl?: string;
      reason?: "up-to-date";
      aheadBy: number;
      commits: { sha: string; message: string; author: string | null }[];
      base: string;
      head: string;
    })
  | (Stamped & {
      ok: false;
      direction: "push" | "pull";
      error: Extract<SandboxErrorCode, "unauth" | "forbidden" | "not-sandbox" | "auth" | "conflict" | "github">;
      detail?: string;
    });

// Backward-compatible alias.
export type PushCodeResult = CodeSyncResult;

const PROD_BRANCH = "master";
const SANDBOX_BRANCH = "sandbox";

async function syncCode(
  direction: "push" | "pull",
  rawMessage: string,
): Promise<CodeSyncResult> {
  const started = Date.now();
  const guard = await requireAdminSandbox();
  if (!guard.ok) {
    return { ok: false, direction, error: guard.error, ...nowStamps(started) };
  }

  // push: base=master, head=sandbox → sandbox into master.
  // pull: base=sandbox, head=master → master into sandbox.
  const base = direction === "push" ? PROD_BRANCH : SANDBOX_BRANCH;
  const head = direction === "push" ? SANDBOX_BRANCH : PROD_BRANCH;
  const defaultMsg =
    direction === "push"
      ? `chore: promote sandbox to production (${formatIlNow()})`
      : `chore: sync master into sandbox (${formatIlNow()})`;
  const message = (rawMessage || "").trim().slice(0, 200) || defaultMsg;
  const ns = direction === "push" ? "push-code" : "pull-code";

  let env;
  try {
    env = readGithubEnv();
  } catch (err) {
    console.error(`[admin sandbox ${ns}] missing env:`, err);
    return {
      ok: false,
      direction,
      error: "github",
      detail: (err as Error).message,
      ...nowStamps(started),
    };
  }

  try {
    const compare: CompareResult = await compareBranches(env, base, head);
    if (compare.aheadBy === 0) {
      console.info(`[admin sandbox ${ns}] up-to-date`, {
        adminId: guard.adminId,
        base,
        head,
      });
      return {
        ok: true,
        direction,
        merged: false,
        reason: "up-to-date",
        aheadBy: 0,
        commits: [],
        base,
        head,
        ...nowStamps(started),
      };
    }
    const outcome = await mergeBranches(env, base, head, message);
    if (outcome.kind === "conflict") {
      console.warn(`[admin sandbox ${ns}] conflict`, {
        adminId: guard.adminId,
        base,
        head,
        detail: outcome.detail.slice(0, 200),
      });
      return {
        ok: false,
        direction,
        error: "conflict",
        detail: outcome.detail,
        ...nowStamps(started),
      };
    }
    if (outcome.kind === "up-to-date") {
      return {
        ok: true,
        direction,
        merged: false,
        reason: "up-to-date",
        aheadBy: 0,
        commits: [],
        base,
        head,
        ...nowStamps(started),
      };
    }
    const stamps = nowStamps(started);
    const mergeUrl = `https://github.com/${env.owner}/${env.repo}/commit/${outcome.sha}`;
    console.info(`[admin sandbox ${ns}]`, {
      adminId: guard.adminId,
      base,
      head,
      mergeSha: outcome.sha,
      aheadBy: compare.aheadBy,
      durationMs: stamps.durationMs,
    });
    return {
      ok: true,
      direction,
      merged: true,
      mergeSha: outcome.sha,
      mergeUrl,
      aheadBy: compare.aheadBy,
      commits: compare.commits.slice(-20),
      base,
      head,
      ...stamps,
    };
  } catch (err) {
    const msg = (err as Error).message || String(err);
    if (msg.includes("(401)") || msg.includes("(403)")) {
      console.error(`[admin sandbox ${ns}] auth failed:`, err);
      return {
        ok: false,
        direction,
        error: "auth",
        detail: msg,
        ...nowStamps(started),
      };
    }
    console.error(`[admin sandbox ${ns}] failed:`, err);
    return {
      ok: false,
      direction,
      error: "github",
      detail: msg.slice(0, 300),
      ...nowStamps(started),
    };
  }
}

export async function pushCodeToProd(rawMessage: string): Promise<CodeSyncResult> {
  return syncCode("push", rawMessage);
}

export async function pullCodeFromProd(rawMessage: string): Promise<CodeSyncResult> {
  return syncCode("pull", rawMessage);
}

function formatIlNow(): string {
  const fmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  return fmt.format(new Date());
}

// ---------------------------------------------------------------------------
// refreshSandboxFromProd
// ---------------------------------------------------------------------------

// Operational tables only. Excluded by design: profiles, payments,
// match_bets, custom_bets, user_custom_bet_picks, duels, signup_requests,
// point_adjustments, bet_grading_audit, bet_reminder_sent,
// user_notifications, push_subscriptions, content_override_history,
// user_moment_dismissals. Rationale: those tables hold real users' real
// bets/money/state and must never be overwritten by sandbox test data.
// See _plans/2026-05-29-sandbox-environment.md §5.3.
//
// Caveat: "excluded" means not copied. The TRUNCATE ... CASCADE below
// still EMPTIES any excluded table that has a foreign key into a
// refreshed one (match_bets, custom_bets, user_custom_bet_picks, duels,
// bet_grading_audit, bet_reminder_sent). On the sandbox DB that is
// acceptable — it is test data — and the refresh UI states it plainly.
// profiles, payments, signup_requests, point_adjustments and
// user_notifications have no such FK and survive.
//
// live_odds_snapshot has a FK into matches and must be inserted AFTER
// matches (its insert order in this array enforces that, since the
// transaction inserts table-by-table top-to-bottom).
const REFRESH_TABLES = [
  { name: "groups", schema: groups },
  { name: "teams", schema: teams },
  { name: "players", schema: players },
  { name: "matchdays", schema: matchdays },
  { name: "matches", schema: matches },
  { name: "settings", schema: settings },
  { name: "sync_runs", schema: syncRuns },
  { name: "bet_lock_defaults", schema: betLockDefaults },
  { name: "stage_lock_defaults", schema: stageLockDefaults },
  { name: "content_overrides", schema: contentOverrides },
  { name: "live_odds_snapshot", schema: liveOddsSnapshot },
  { name: "outright_odds_snapshot", schema: outrightOddsSnapshot },
  { name: "news_items", schema: newsItems },
  { name: "news_sync_cursors", schema: newsSyncCursors },
] as const;

// Columns in the copied tables that FK into `profiles` — a table the
// refresh excludes by design (real user data). A copied row carrying a
// prod user/admin id would violate that FK against the sandbox profiles
// table (e.g. sync_runs_triggered_by_fkey), so we null these on copy.
// Every one is nullable with onDelete "set null", so null is exactly
// what the constraint would resolve the value to anyway. Keys here are
// JS property names (drizzle row keys), not DB column names, and must
// match a `name` in REFRESH_TABLES above.
const PROFILE_REF_COLUMNS: Record<string, readonly string[]> = {
  sync_runs: ["triggeredBy"],
  bet_lock_defaults: ["updatedBy"],
  stage_lock_defaults: ["updatedBy"],
  content_overrides: ["updatedBy"],
};

export type RefreshTableStep = {
  table: string;
  rowsCopied: number;
  fetchMs: number;
  insertMs: number;
};

export type RefreshResult =
  | (Stamped & {
      ok: true;
      perTable: Record<string, number>;
      steps: RefreshTableStep[];
      truncateMs: number;
      totalRows: number;
    })
  | (Stamped & {
      ok: false;
      error: Extract<SandboxErrorCode, "unauth" | "forbidden" | "not-sandbox" | "db">;
      detail?: string;
      steps?: RefreshTableStep[];
    });

export async function refreshSandboxFromProd(): Promise<RefreshResult> {
  const started = Date.now();
  const guard = await requireAdminSandbox();
  if (!guard.ok) return { ok: false, error: guard.error, ...nowStamps(started) };

  const perTable: Record<string, number> = {};
  const steps: RefreshTableStep[] = [];
  const tableList = REFRESH_TABLES.map((t) => t.name).join(", ");

  try {
    // Read everything from prod first so a network blip leaves the
    // sandbox DB untouched. Then truncate + insert inside one
    // transaction so a failure mid-restore rolls back.
    const prodRows: Record<string, unknown[]> = {};
    const fetchTimings: Record<string, number> = {};
    for (const t of REFRESH_TABLES) {
      const t0 = Date.now();
      const rows = await prodDb().select().from(t.schema as never);
      fetchTimings[t.name] = Date.now() - t0;
      prodRows[t.name] = rows;
    }

    const truncateStart = Date.now();
    let truncateMs = 0;

    await db.transaction(async (tx) => {
      await tx.execute(
        sql.raw(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`),
      );
      truncateMs = Date.now() - truncateStart;
      for (const t of REFRESH_TABLES) {
        const clearCols = PROFILE_REF_COLUMNS[t.name];
        const rows = clearCols
          ? prodRows[t.name]!.map((r) => ({
              ...(r as Record<string, unknown>),
              ...Object.fromEntries(clearCols.map((c) => [c, null])),
            }))
          : prodRows[t.name]!;
        const insertStart = Date.now();
        if (rows.length > 0) {
          await tx
            .insert(t.schema as never)
            .values(rows as never[]);
        }
        const insertMs = Date.now() - insertStart;
        perTable[t.name] = rows.length;
        steps.push({
          table: t.name,
          rowsCopied: rows.length,
          fetchMs: fetchTimings[t.name] ?? 0,
          insertMs,
        });
      }
    });

    const stamps = nowStamps(started);
    const totalRows = Object.values(perTable).reduce((s, n) => s + n, 0);
    console.info("[admin sandbox refresh-data]", {
      adminId: guard.adminId,
      perTable,
      totalRows,
      truncateMs,
      durationMs: stamps.durationMs,
    });
    revalidatePath("/", "layout");
    return {
      ok: true,
      perTable,
      steps,
      truncateMs,
      totalRows,
      ...stamps,
    };
  } catch (err) {
    console.error("[admin sandbox refresh-data] failed:", err);
    return {
      ok: false,
      error: "db",
      detail: (err as Error).message?.slice(0, 300),
      steps,
      ...nowStamps(started),
    };
  }
}
