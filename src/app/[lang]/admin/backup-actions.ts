"use server";

import { revalidatePath } from "next/cache";
import { isAdmin } from "@/lib/admin";
import { getUser } from "@/lib/supabase/auth";
import { runBackup, type BackupReport } from "@/lib/backup";

export type RunBackupResult =
  | { ok: true; report: BackupReport; durationMs: number }
  | { ok: false; error: "forbidden" | "backup_failed"; message?: string };

// Manual trigger for the daily GitHub-backup pipeline. Same logic the
// /api/cron/backup route runs at 03:00 IL, but flagged as source
// 'admin-backup' so /admin/sync's backup history distinguishes manual
// fires from the cron's automatic ones.
export async function runBackupNow(): Promise<RunBackupResult> {
  const user = await getUser();
  if (!user || !(await isAdmin(user.id))) return { ok: false, error: "forbidden" };

  const start = Date.now();
  try {
    const report = await runBackup({
      source: "admin-backup",
      triggeredBy: user.id,
    });
    // The backup writes a sync_runs row that the BackupPanel history
    // list reads back. Revalidate so the new row appears without a
    // full page refresh.
    revalidatePath("/", "layout");
    return { ok: true, report, durationMs: Date.now() - start };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("runBackupNow failed:", err);
    return { ok: false, error: "backup_failed", message: msg };
  }
}
