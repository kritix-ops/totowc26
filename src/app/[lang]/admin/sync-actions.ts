"use server";

import { revalidatePath, updateTag } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { getUser } from "@/lib/supabase/auth";
import { syncFixtures, type SyncReport } from "@/lib/sync";
import { CACHE_TAG_FIXTURES } from "@/db/queries";
import {
  fetchApiFootballStatus,
  type ApiFootballQuota,
} from "@/lib/api-football";

export type RunSyncResult =
  | { ok: true; report: SyncReport; durationMs: number }
  | { ok: false; error: "forbidden" | "sync_failed"; message?: string };

export async function runSyncNow(): Promise<RunSyncResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "forbidden" };
  const [p] = await db
    .select({ role: profiles.role })
    .from(profiles)
    .where(eq(profiles.id, user.id))
    .limit(1);
  if (!p || p.role !== "admin") return { ok: false, error: "forbidden" };

  const start = Date.now();
  try {
    const report = await syncFixtures(2026, {
      source: "admin",
      triggeredBy: user.id,
    });
    // Fixtures changed globally — propagate to every cached
    // getTournamentStart/getUpcomingFixtures consumer, not just this
    // admin's session. revalidatePath still drops the admin's local
    // route cache so the sync panel shows the new state.
    updateTag(CACHE_TAG_FIXTURES);
    revalidatePath("/", "layout");
    return { ok: true, report, durationMs: Date.now() - start };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("runSyncNow failed:", err);
    return { ok: false, error: "sync_failed", message: msg };
  }
}

// Quota card refresh. Cheap admin-only call: hits /status (1 API
// credit), busts the 30s fetch cache by revalidating the path, and
// returns the fresh quota. UI binds this to the "Refresh" pill so
// admins can pull a live number without waiting for the page TTL.
export type RefreshQuotaResult =
  | { ok: true; quota: ApiFootballQuota | null }
  | { ok: false; error: "forbidden" };

export async function refreshApiFootballQuota(): Promise<RefreshQuotaResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "forbidden" };
  const [p] = await db
    .select({ role: profiles.role })
    .from(profiles)
    .where(eq(profiles.id, user.id))
    .limit(1);
  if (!p || p.role !== "admin") return { ok: false, error: "forbidden" };

  const quota = await fetchApiFootballStatus();
  // Bust the route cache so the next render of /admin re-reads
  // /status (the server-component path) even if the fetch-level
  // revalidate window hasn't expired yet.
  revalidatePath("/", "layout");
  return { ok: true, quota };
}
