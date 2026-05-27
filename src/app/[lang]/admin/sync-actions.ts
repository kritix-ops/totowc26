"use server";

import { revalidatePath, updateTag } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { profiles, teams } from "@/db/schema";
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

// Inline "Map manually" save from the unmapped-team chips in the
// admin sync panel. Sets teams.api_football_team_id for one team
// after light validation so an operator can patch a stragglers list
// without dropping to a SQL shell or re-running the map-teams script.
//
// Returns a structured error rather than throwing so the chip's
// useTransition can branch on the result without try/catch noise.
export type SetTeamApiFootballIdResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | "forbidden"
        | "bad_input"
        | "team_not_found"
        | "id_already_in_use";
    };

export async function setTeamApiFootballId(
  code: string,
  apiFootballTeamId: number,
): Promise<SetTeamApiFootballIdResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "forbidden" };
  const [p] = await db
    .select({ role: profiles.role })
    .from(profiles)
    .where(eq(profiles.id, user.id))
    .limit(1);
  if (!p || p.role !== "admin") return { ok: false, error: "forbidden" };

  // Defensive validation. Code is always a 3-letter uppercase ISO-ish
  // string in our DB; api_football_team_id is a positive integer.
  const normalisedCode = String(code ?? "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalisedCode)) {
    return { ok: false, error: "bad_input" };
  }
  if (
    !Number.isInteger(apiFootballTeamId) ||
    apiFootballTeamId <= 0 ||
    apiFootballTeamId > 2_000_000_000
  ) {
    return { ok: false, error: "bad_input" };
  }

  // Reject if some other team is already mapped to this id. The DB
  // would also reject via the unique partial index, but catching it
  // here gives the chip a typed error instead of a generic throw.
  const conflict = await db
    .select({ code: teams.code })
    .from(teams)
    .where(sql`api_football_team_id = ${apiFootballTeamId} and code <> ${normalisedCode}`)
    .limit(1);
  if (conflict.length > 0) {
    return { ok: false, error: "id_already_in_use" };
  }

  const updated = await db
    .update(teams)
    .set({ apiFootballTeamId })
    .where(eq(teams.code, normalisedCode))
    .returning({ code: teams.code });
  if (updated.length === 0) {
    return { ok: false, error: "team_not_found" };
  }

  console.info("[sync team-map manual]", {
    code: normalisedCode,
    apiFootballTeamId,
    by: user.id,
  });
  revalidatePath("/", "layout");
  return { ok: true };
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
