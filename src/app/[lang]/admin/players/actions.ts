"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { players, profiles } from "@/db/schema";
import { getUser } from "@/lib/supabase/auth";

// Server actions backing the /admin/players review queue.
//
// Three primitives:
//   * approveTranslation(id)       — admin agrees with current name_he
//   * rejectTranslation(id)        — admin wants the row redone from
//                                    scratch; name_he is cleared so
//                                    the pipeline picks it up next
//                                    run, verdict marked 'reject'
//   * setManualHebrewName(id, name) — admin types the Hebrew name
//                                     themselves. Sets verdict to
//                                     'approved', source to 'manual',
//                                     confidence to 100, and crucially
//                                     locks the row so future
//                                     automated pipeline runs do not
//                                     stomp the admin's correction.
//
// Every action requires admin role (server-side check, same pattern
// as the rest of the admin actions in this app), revalidates the
// review queue page, and logs the change so the audit trail is
// reconstructable.

export type ReviewActionResult =
  | { ok: true }
  | { ok: false; error: "unauth" | "forbidden" | "not_found" | "invalid" | "db" };

async function isAdminUser(): Promise<string | null> {
  const user = await getUser();
  if (!user) return null;
  const [p] = await db
    .select({ role: profiles.role })
    .from(profiles)
    .where(eq(profiles.id, user.id))
    .limit(1);
  if (!p || p.role !== "admin") return null;
  return user.id;
}

export async function approveTranslation(
  playerId: string,
): Promise<ReviewActionResult> {
  const adminId = await isAdminUser();
  if (!adminId) return { ok: false, error: "forbidden" };
  if (!playerId || typeof playerId !== "string") {
    return { ok: false, error: "invalid" };
  }
  try {
    const [row] = await db
      .select({ id: players.id, nameHe: players.nameHe })
      .from(players)
      .where(eq(players.id, playerId))
      .limit(1);
    if (!row) return { ok: false, error: "not_found" };
    if (!row.nameHe) {
      // Cannot approve a row that has no Hebrew name yet — the admin
      // should either type a name or reject so the pipeline tries again.
      return { ok: false, error: "invalid" };
    }
    await db
      .update(players)
      .set({
        nameHeReviewVerdict: "approved",
        nameHeReviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(players.id, playerId));
    console.info("[player review approved]", { by: adminId, playerId });
    revalidatePath("/[lang]/admin/players", "page");
    return { ok: true };
  } catch (err) {
    console.error("approveTranslation failed:", err);
    return { ok: false, error: "db" };
  }
}

export async function rejectTranslation(
  playerId: string,
): Promise<ReviewActionResult> {
  const adminId = await isAdminUser();
  if (!adminId) return { ok: false, error: "forbidden" };
  if (!playerId || typeof playerId !== "string") {
    return { ok: false, error: "invalid" };
  }
  try {
    await db
      .update(players)
      .set({
        nameHe: null,
        nameHeSource: null,
        nameHeConfidence: null,
        nameHeReviewVerdict: "reject",
        nameHeReviewedAt: new Date(),
        // Do NOT set admin_locked — a rejected row should be picked
        // up by the next pipeline run, NOT permanently skipped.
        updatedAt: new Date(),
      })
      .where(eq(players.id, playerId));
    console.info("[player review rejected]", { by: adminId, playerId });
    revalidatePath("/[lang]/admin/players", "page");
    return { ok: true };
  } catch (err) {
    console.error("rejectTranslation failed:", err);
    return { ok: false, error: "db" };
  }
}

export async function setManualHebrewName(
  playerId: string,
  nameHe: string,
): Promise<ReviewActionResult> {
  const adminId = await isAdminUser();
  if (!adminId) return { ok: false, error: "forbidden" };
  if (!playerId || typeof playerId !== "string") {
    return { ok: false, error: "invalid" };
  }
  const trimmed = nameHe.trim();
  // Sanity bounds: blank disallowed (use reject instead), absurdly
  // long disallowed (Hebrew player names sit comfortably under 60
  // chars even with patronymic + suffix).
  if (trimmed.length < 1 || trimmed.length > 100) {
    return { ok: false, error: "invalid" };
  }
  try {
    await db
      .update(players)
      .set({
        nameHe: trimmed,
        nameHeSource: "manual",
        nameHeConfidence: 100,
        nameHeReviewVerdict: "approved",
        nameHeReviewReason: null,
        nameHeReviewedAt: new Date(),
        nameHeAdminLocked: true,
        updatedAt: new Date(),
      })
      .where(eq(players.id, playerId));
    console.info("[player manual name set]", {
      by: adminId,
      playerId,
      length: trimmed.length,
    });
    revalidatePath("/[lang]/admin/players", "page");
    return { ok: true };
  } catch (err) {
    console.error("setManualHebrewName failed:", err);
    return { ok: false, error: "db" };
  }
}
