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
} from "./github";

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

// ---------------------------------------------------------------------------
// pushSettingsToProd
// ---------------------------------------------------------------------------

export type PushSettingsResult =
  | {
      ok: true;
      changedColumns: string[];
      diff: SettingsDiffEntry[];
    }
  | {
      ok: false;
      error: "unauth" | "forbidden" | "not-sandbox" | "missing" | "db";
    };

export async function pushSettingsToProd(): Promise<PushSettingsResult> {
  const guard = await requireAdminSandbox();
  if (!guard.ok) return { ok: false, error: guard.error };

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
      return { ok: true, changedColumns: [], diff: [] };
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
    console.info("[admin sandbox push-settings]", {
      adminId: guard.adminId,
      changedCount: diff.length,
      columns: diff.map((d) => d.column),
    });
    revalidatePath("/", "layout");
    return {
      ok: true,
      changedColumns: diff.map((d) => d.column),
      diff,
    };
  } catch (err) {
    console.error("[admin sandbox push-settings] failed:", err);
    return { ok: false, error: "db" };
  }
}

// ---------------------------------------------------------------------------
// pushCodeToProd
// ---------------------------------------------------------------------------

export type PushCodeResult =
  | {
      ok: true;
      merged: boolean;
      mergeSha?: string;
      reason?: "up-to-date";
      aheadBy: number;
    }
  | {
      ok: false;
      error: "unauth" | "forbidden" | "not-sandbox" | "auth" | "conflict" | "github";
      detail?: string;
    };

const PROD_BRANCH = "master";
const SANDBOX_BRANCH = "sandbox";

export async function pushCodeToProd(
  rawMessage: string,
): Promise<PushCodeResult> {
  const guard = await requireAdminSandbox();
  if (!guard.ok) return { ok: false, error: guard.error };

  const message = (rawMessage || "").trim().slice(0, 200) ||
    `chore: promote sandbox to production (${formatIlNow()})`;

  let env;
  try {
    env = readGithubEnv();
  } catch (err) {
    console.error("[admin sandbox push-code] missing env:", err);
    return { ok: false, error: "github", detail: (err as Error).message };
  }

  try {
    const compare = await compareBranches(env, PROD_BRANCH, SANDBOX_BRANCH);
    if (compare.aheadBy === 0) {
      console.info("[admin sandbox push-code] up-to-date", {
        adminId: guard.adminId,
      });
      return { ok: true, merged: false, reason: "up-to-date", aheadBy: 0 };
    }
    const outcome = await mergeBranches(
      env,
      PROD_BRANCH,
      SANDBOX_BRANCH,
      message,
    );
    if (outcome.kind === "conflict") {
      console.warn("[admin sandbox push-code] conflict", {
        adminId: guard.adminId,
        detail: outcome.detail.slice(0, 200),
      });
      return { ok: false, error: "conflict", detail: outcome.detail };
    }
    if (outcome.kind === "up-to-date") {
      return { ok: true, merged: false, reason: "up-to-date", aheadBy: 0 };
    }
    console.info("[admin sandbox push-code]", {
      adminId: guard.adminId,
      mergeSha: outcome.sha,
      aheadBy: compare.aheadBy,
    });
    return {
      ok: true,
      merged: true,
      mergeSha: outcome.sha,
      aheadBy: compare.aheadBy,
    };
  } catch (err) {
    const msg = (err as Error).message || String(err);
    if (msg.includes("(401)") || msg.includes("(403)")) {
      console.error("[admin sandbox push-code] auth failed:", err);
      return { ok: false, error: "auth", detail: msg };
    }
    console.error("[admin sandbox push-code] failed:", err);
    return { ok: false, error: "github", detail: msg.slice(0, 300) };
  }
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
// user_notifications, push_subscriptions, content_override_history.
// Rationale: those tables hold real users' real bets/money and must
// never be overwritten by sandbox test data. See
// _plans/2026-05-29-sandbox-environment.md §5.3.
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
] as const;

export type RefreshResult =
  | {
      ok: true;
      perTable: Record<string, number>;
      durationMs: number;
    }
  | {
      ok: false;
      error: "unauth" | "forbidden" | "not-sandbox" | "db";
      detail?: string;
    };

export async function refreshSandboxFromProd(): Promise<RefreshResult> {
  const guard = await requireAdminSandbox();
  if (!guard.ok) return { ok: false, error: guard.error };

  const started = Date.now();
  const perTable: Record<string, number> = {};
  const tableList = REFRESH_TABLES.map((t) => t.name).join(", ");

  try {
    // Read everything from prod first so a network blip leaves the
    // sandbox DB untouched. Then truncate + insert inside one
    // transaction so a failure mid-restore rolls back.
    const prodRows: Record<string, unknown[]> = {};
    for (const t of REFRESH_TABLES) {
      const rows = await prodDb().select().from(t.schema as never);
      prodRows[t.name] = rows;
    }

    await db.transaction(async (tx) => {
      // One TRUNCATE ... CASCADE wipes every refreshable table in a
      // single statement. CASCADE follows FKs so dependent rows in the
      // same group go with them; profiles/bets/payments are excluded
      // from this list and won't be touched unless a FK from a
      // refreshable table reaches into them (they don't - the bet
      // tables point at profiles/matches, not the reverse).
      await tx.execute(
        sql.raw(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`),
      );
      for (const t of REFRESH_TABLES) {
        const rows = prodRows[t.name]!;
        if (rows.length > 0) {
          await tx
            .insert(t.schema as never)
            .values(rows as never[]);
        }
        perTable[t.name] = rows.length;
      }
    });

    const durationMs = Date.now() - started;
    console.info("[admin sandbox refresh-data]", {
      adminId: guard.adminId,
      perTable,
      durationMs,
    });
    revalidatePath("/", "layout");
    return { ok: true, perTable, durationMs };
  } catch (err) {
    console.error("[admin sandbox refresh-data] failed:", err);
    return {
      ok: false,
      error: "db",
      detail: (err as Error).message?.slice(0, 300),
    };
  }
}
