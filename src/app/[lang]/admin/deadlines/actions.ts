"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  BET_TYPE_KEYS,
  betLockDefaults,
  matches,
  matchdays,
  settings,
  type BetTypeKey,
} from "@/db/schema";
import { isAdmin } from "@/lib/admin";
import { getUser } from "@/lib/supabase/auth";

// Server actions for /admin/deadlines. Three independent saves so the
// admin can edit one section at a time without losing in-flight values
// in the others. Each save is gated by isAdmin() and logs the diff.

export type SaveResult =
  | { ok: true }
  | { ok: false; error: "unauth" | "forbidden" | "invalid" | "db" };

async function requireAdminId(): Promise<string | null> {
  const user = await getUser();
  if (!user) return null;
  const ok = await isAdmin(user.id);
  return ok ? user.id : null;
}

// Section 1 - tournament anchor. Nullable: clearing returns to the
// derived fallback (MIN(matches.kickoff_at)).
export async function saveTournamentStart(
  isoOrNull: string | null,
): Promise<SaveResult> {
  const adminId = await requireAdminId();
  if (!adminId) return { ok: false, error: "forbidden" };

  let value: Date | null = null;
  if (isoOrNull !== null) {
    const d = new Date(isoOrNull);
    if (Number.isNaN(d.getTime())) return { ok: false, error: "invalid" };
    value = d;
  }
  try {
    const [oldRow] = await db
      .select({ tournamentStartAt: settings.tournamentStartAt })
      .from(settings)
      .where(eq(settings.id, 1))
      .limit(1);
    await db
      .update(settings)
      .set({ tournamentStartAt: value, updatedAt: new Date() })
      .where(eq(settings.id, 1));
    console.info("[admin deadlines tournament-start]", {
      adminId,
      oldValue: oldRow?.tournamentStartAt?.toISOString() ?? null,
      newValue: value?.toISOString() ?? null,
    });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    console.error("[admin deadlines tournament-start] failed:", err);
    return { ok: false, error: "db" };
  }
}

// Section 2 - per-type defaults. Validate the keys match the catalog
// and each offset is a non-negative integer (matches the CHECK in
// migration 0021).
export async function saveTypeDefaults(
  rows: Array<{ betType: string; offsetMinutes: number }>,
): Promise<SaveResult> {
  const adminId = await requireAdminId();
  if (!adminId) return { ok: false, error: "forbidden" };

  const known: Record<BetTypeKey, number> = {} as Record<BetTypeKey, number>;
  for (const r of rows) {
    if (!(BET_TYPE_KEYS as readonly string[]).includes(r.betType)) {
      return { ok: false, error: "invalid" };
    }
    if (
      !Number.isFinite(r.offsetMinutes) ||
      !Number.isInteger(r.offsetMinutes) ||
      r.offsetMinutes < 0 ||
      r.offsetMinutes > 60 * 24 * 14 // 14 days, generous upper bound
    ) {
      return { ok: false, error: "invalid" };
    }
    known[r.betType as BetTypeKey] = r.offsetMinutes;
  }

  try {
    const existing = await db
      .select({
        betType: betLockDefaults.betType,
        offsetMinutes: betLockDefaults.offsetMinutes,
      })
      .from(betLockDefaults);
    const diff: Array<{ betType: BetTypeKey; from: number | null; to: number }> =
      [];
    for (const [k, v] of Object.entries(known) as Array<[BetTypeKey, number]>) {
      const old = existing.find((e) => e.betType === k)?.offsetMinutes ?? null;
      if (old !== v) diff.push({ betType: k, from: old, to: v });
    }

    // Upsert each row. Six rows max, so a loop is fine - clearer than
    // a single multi-row INSERT ... ON CONFLICT.
    for (const [betType, offsetMinutes] of Object.entries(known) as Array<
      [BetTypeKey, number]
    >) {
      await db
        .insert(betLockDefaults)
        .values({
          betType,
          offsetMinutes,
          updatedBy: adminId,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: betLockDefaults.betType,
          set: {
            offsetMinutes,
            updatedBy: adminId,
            updatedAt: new Date(),
          },
        });
    }

    console.info("[admin deadlines save]", {
      adminId,
      section: "type_defaults",
      diff,
    });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    console.error("[admin deadlines save type-defaults] failed:", err);
    return { ok: false, error: "db" };
  }
}

// Section 3 - per-matchday override. null clears the override and falls
// back to the type default for that day's bets.
export async function saveMatchdayOverride(
  matchdayId: string,
  offsetMinutes: number | null,
): Promise<SaveResult> {
  const adminId = await requireAdminId();
  if (!adminId) return { ok: false, error: "forbidden" };

  if (offsetMinutes !== null) {
    if (
      !Number.isFinite(offsetMinutes) ||
      !Number.isInteger(offsetMinutes) ||
      offsetMinutes < 0 ||
      offsetMinutes > 60 * 24 * 14
    ) {
      return { ok: false, error: "invalid" };
    }
  }

  try {
    const [oldRow] = await db
      .select({ value: matchdays.lockOffsetOverrideMinutes })
      .from(matchdays)
      .where(eq(matchdays.id, matchdayId))
      .limit(1);
    if (!oldRow) return { ok: false, error: "invalid" };

    await db
      .update(matchdays)
      .set({ lockOffsetOverrideMinutes: offsetMinutes })
      .where(eq(matchdays.id, matchdayId));

    console.info("[admin deadlines matchday-override]", {
      adminId,
      matchdayId,
      oldValue: oldRow.value,
      newValue: offsetMinutes,
    });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    console.error("[admin deadlines matchday-override] failed:", err);
    return { ok: false, error: "db" };
  }
}

// Lock-reminder offset (settings.reminder_offset_minutes). 0 disables
// the feature entirely; the sync pass skips its candidate query.
export async function saveReminderOffset(
  minutes: number,
): Promise<SaveResult> {
  const adminId = await requireAdminId();
  if (!adminId) return { ok: false, error: "forbidden" };
  if (
    !Number.isFinite(minutes) ||
    !Number.isInteger(minutes) ||
    minutes < 0 ||
    minutes > 60 * 24 * 7
  ) {
    return { ok: false, error: "invalid" };
  }
  try {
    const [oldRow] = await db
      .select({ value: settings.reminderOffsetMinutes })
      .from(settings)
      .where(eq(settings.id, 1))
      .limit(1);
    await db
      .update(settings)
      .set({ reminderOffsetMinutes: minutes, updatedAt: new Date() })
      .where(eq(settings.id, 1));
    console.info("[admin deadlines reminder-offset]", {
      adminId,
      oldValue: oldRow?.value ?? null,
      newValue: minutes,
    });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    console.error("[admin deadlines reminder-offset] failed:", err);
    return { ok: false, error: "db" };
  }
}

// Per-match override for the 1/X/2 score bet on a single fixture.
// Used by the per-match override UI (section in /admin/deadlines or in
// the match admin). null clears the override.
export async function saveMatchLockOverride(
  matchId: string,
  isoOrNull: string | null,
): Promise<SaveResult> {
  const adminId = await requireAdminId();
  if (!adminId) return { ok: false, error: "forbidden" };

  let value: Date | null = null;
  if (isoOrNull !== null) {
    const d = new Date(isoOrNull);
    if (Number.isNaN(d.getTime())) return { ok: false, error: "invalid" };
    value = d;
  }
  try {
    const [oldRow] = await db
      .select({
        kickoffAt: matches.kickoffAt,
        lockAtOverride: matches.lockAtOverride,
      })
      .from(matches)
      .where(eq(matches.id, matchId))
      .limit(1);
    if (!oldRow) return { ok: false, error: "invalid" };

    // Reject overrides past kickoff - a lock time after the match has
    // started is never what the admin wants.
    if (value && value.getTime() >= oldRow.kickoffAt.getTime()) {
      return { ok: false, error: "invalid" };
    }

    await db
      .update(matches)
      .set({ lockAtOverride: value })
      .where(eq(matches.id, matchId));

    console.info("[admin deadlines match-override]", {
      adminId,
      matchId,
      oldValue: oldRow.lockAtOverride?.toISOString() ?? null,
      newValue: value?.toISOString() ?? null,
    });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    console.error("[admin deadlines match-override] failed:", err);
    return { ok: false, error: "db" };
  }
}
