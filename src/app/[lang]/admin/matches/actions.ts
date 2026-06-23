"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { customBets, matches, matchStatusAudit } from "@/db/schema";
import { getUser } from "@/lib/supabase/auth";
import { isAdmin } from "@/lib/admin";
import { notifyUsers } from "@/lib/notifications";
import { cascadeVoidMatchLiveBets } from "@/lib/matches/cascade-live-bets";
import { scoreCanceledMatch } from "@/lib/matches/score-canceled";
import {
  validateCancelResolution,
  type CancelResolution,
  type CancelResolutionConfig,
} from "@/lib/matches/cancel";

// Manual match-status control: postpone / reschedule / cancel / resolve a
// canceled match / reopen. Gated on FULL admin (not the scoped liveBets
// operator) because cancellation rewrites the 1/X/2 scoring of every player,
// not just live bets. See _plans/2026-06-22-match-cancel-postpone-admin.md.

type Err =
  | "unauth"
  | "forbidden"
  | "match_not_found"
  | "invalid_status"
  | "invalid_reason"
  | "invalid_resolution"
  | "invalid_awarded_score"
  | "invalid_split_points"
  | "invalid_kickoff"
  | "already_resolved"
  | "db";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: Err };

// FULL-admin gate for these server actions. requireAdmin() in @/lib/admin is
// a page-level redirect; server actions need a boolean, so we check isAdmin().
async function requireFullAdmin(): Promise<
  { ok: true; userId: string } | { ok: false; error: "unauth" | "forbidden" }
> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauth" };
  if (!(await isAdmin(user.id))) return { ok: false, error: "forbidden" };
  return { ok: true, userId: user.id };
}

// Every surface that reads match status, the player's guess, or the
// leaderboard must drop its cached RSC output after a status move.
function revalidateMatchSurfaces(matchId: string) {
  revalidatePath("/[lang]/admin/matches", "page");
  revalidatePath("/[lang]/admin", "page");
  revalidatePath("/[lang]/play", "layout");
  revalidatePath("/[lang]/leaderboard", "page");
  revalidatePath(`/[lang]/match/${matchId}`, "page");
  revalidatePath("/[lang]/bets/live", "page");
  revalidatePath("/[lang]/bets/tournament", "page");
}

// Mark a match as postponed: temporary hold, no scoring, picks frozen. New
// picks are already blocked because write-core gates on status='scheduled'.
export async function postponeMatch(
  matchId: string,
  reason: string,
): Promise<Result> {
  const auth = await requireFullAdmin();
  if (!auth.ok) return auth;
  const trimmed = reason.trim();
  if (trimmed.length < 3) return { ok: false, error: "invalid_reason" };

  try {
    const [m] = await db
      .select({ status: matches.status })
      .from(matches)
      .where(eq(matches.id, matchId))
      .limit(1);
    if (!m) return { ok: false, error: "match_not_found" };
    // Only a live or not-yet-started match can be postponed.
    if (m.status !== "scheduled" && m.status !== "live") {
      return { ok: false, error: "invalid_status" };
    }

    await db.transaction(async (tx) => {
      await tx
        .update(matches)
        .set({ status: "postponed", statusChangedAt: new Date() })
        .where(eq(matches.id, matchId));
      await tx.insert(matchStatusAudit).values({
        matchId,
        action: "postpone",
        previousStatus: m.status,
        newStatus: "postponed",
        payload: null,
        reason: trimmed,
        performedBy: auth.userId,
      });
    });

    console.info("[match postpone]", {
      matchId,
      from: m.status,
      by: auth.userId,
    });
    revalidateMatchSurfaces(matchId);
    return { ok: true };
  } catch (err) {
    console.error("[match postpone] failed:", err);
    return { ok: false, error: "db" };
  }
}

// Set a new kickoff for a postponed match and flip it back to scheduled.
// Existing 1/X/2 guesses are preserved and become editable again (they were
// never locked or scored); clearing lockAtOverride lets the deadline fall back
// to the new kickoff. Match-scoped live bets have their lock_at shifted by the
// same delta so they reopen in step with the new date.
export async function rescheduleMatch(
  matchId: string,
  newKickoffIso: string,
  reason: string,
): Promise<Result<{ newKickoffAt: string }>> {
  const auth = await requireFullAdmin();
  if (!auth.ok) return auth;
  const trimmed = reason.trim();
  if (trimmed.length < 3) return { ok: false, error: "invalid_reason" };

  const newKickoff = new Date(newKickoffIso);
  if (Number.isNaN(newKickoff.getTime())) {
    return { ok: false, error: "invalid_kickoff" };
  }

  try {
    const [m] = await db
      .select({ status: matches.status, kickoffAt: matches.kickoffAt })
      .from(matches)
      .where(eq(matches.id, matchId))
      .limit(1);
    if (!m) return { ok: false, error: "match_not_found" };
    if (m.status !== "postponed") return { ok: false, error: "invalid_status" };

    const deltaSeconds = Math.round(
      (newKickoff.getTime() - m.kickoffAt.getTime()) / 1000,
    );

    await db.transaction(async (tx) => {
      await tx
        .update(matches)
        .set({
          kickoffAt: newKickoff,
          status: "scheduled",
          statusChangedAt: new Date(),
          lockAtOverride: null,
        })
        .where(eq(matches.id, matchId));

      // Shift match-scoped live-bet locks by the same delta so the relative
      // offset to kickoff is preserved.
      await tx
        .update(customBets)
        .set({
          lockAt: sql`${customBets.lockAt} + make_interval(secs => ${deltaSeconds})`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(customBets.matchId, matchId),
            eq(customBets.scope, "match"),
            inArray(customBets.status, ["open", "locked"]),
          ),
        );

      // Reopen any that the postponement had auto-locked, now that their lock
      // is back in the future.
      await tx
        .update(customBets)
        .set({ status: "open", updatedAt: new Date() })
        .where(
          and(
            eq(customBets.matchId, matchId),
            eq(customBets.scope, "match"),
            eq(customBets.status, "locked"),
            sql`${customBets.lockAt} > now()`,
          ),
        );

      await tx.insert(matchStatusAudit).values({
        matchId,
        action: "reschedule",
        previousStatus: "postponed",
        newStatus: "scheduled",
        payload: {
          previousKickoffAt: m.kickoffAt.toISOString(),
          newKickoffAt: newKickoff.toISOString(),
          deltaSeconds,
        },
        reason: trimmed,
        performedBy: auth.userId,
      });
    });

    console.info("[match reschedule]", {
      matchId,
      previousKickoffAt: m.kickoffAt.toISOString(),
      newKickoffAt: newKickoff.toISOString(),
      deltaSeconds,
      by: auth.userId,
    });
    revalidateMatchSurfaces(matchId);
    return { ok: true, newKickoffAt: newKickoff.toISOString() };
  } catch (err) {
    console.error("[match reschedule] failed:", err);
    return { ok: false, error: "db" };
  }
}

// Mark a match as canceled. Sits PENDING (no 1/X/2 scoring) until the admin
// resolves it, but its match-scoped live bets are voided + refunded right away
// — they can never settle on a match that was not played.
export async function cancelMatch(
  matchId: string,
  reason: string,
): Promise<Result<{ liveBetsVoided: number; picksRefunded: number }>> {
  const auth = await requireFullAdmin();
  if (!auth.ok) return auth;
  const trimmed = reason.trim();
  if (trimmed.length < 3) return { ok: false, error: "invalid_reason" };

  try {
    const [m] = await db
      .select({ status: matches.status })
      .from(matches)
      .where(eq(matches.id, matchId))
      .limit(1);
    if (!m) return { ok: false, error: "match_not_found" };
    // A final match is already scored; a canceled one is already canceled.
    if (
      m.status !== "scheduled" &&
      m.status !== "live" &&
      m.status !== "postponed"
    ) {
      return { ok: false, error: "invalid_status" };
    }

    const cascaded = await db.transaction(async (tx) => {
      const voided = await cascadeVoidMatchLiveBets(
        tx,
        matchId,
        auth.userId,
        trimmed,
      );
      await tx
        .update(matches)
        .set({
          status: "canceled",
          cancelResolution: null,
          cancelResolutionConfig: null,
          statusChangedAt: new Date(),
        })
        .where(eq(matches.id, matchId));
      await tx.insert(matchStatusAudit).values({
        matchId,
        action: "cancel",
        previousStatus: m.status,
        newStatus: "canceled",
        payload: { liveBetsVoided: voided.length },
        reason: trimmed,
        performedBy: auth.userId,
      });
      return voided;
    });

    // Feed-only notices to live-bet pickers, AFTER the refund committed.
    const allPickerIds = [...new Set(cascaded.flatMap((b) => b.pickerIds))];
    let picksRefunded = 0;
    cascaded.forEach((b) => (picksRefunded += b.pickerIds.length));
    if (allPickerIds.length > 0) {
      try {
        await notifyUsers(
          { kind: "users", userIds: allPickerIds },
          {
            kind: "bet_cancelled",
            title: "המשחק בוטל",
            body: "המשחק בוטל וכל ההימורים שלך עליו הוחזרו.",
            url: "/he/bets/live",
            push: false,
            createdBy: auth.userId,
          },
        );
      } catch (err) {
        console.error(
          "[match cancel] notify failed (refund already committed):",
          err,
        );
      }
    }

    console.info("[match cancel]", {
      matchId,
      from: m.status,
      liveBetsVoided: cascaded.length,
      picksRefunded,
      by: auth.userId,
    });
    revalidateMatchSurfaces(matchId);
    return { ok: true, liveBetsVoided: cascaded.length, picksRefunded };
  } catch (err) {
    console.error("[match cancel] failed:", err);
    return { ok: false, error: "db" };
  }
}

// Pick how a canceled match's 1/X/2 guesses settle, then grade them inline.
// Only valid on a canceled match that has not been resolved yet.
export async function resolveCanceledMatch(
  matchId: string,
  resolution: CancelResolution,
  config: CancelResolutionConfig,
  reason: string,
): Promise<Result<{ scored: number }>> {
  const auth = await requireFullAdmin();
  if (!auth.ok) return auth;
  const trimmed = reason.trim();
  if (trimmed.length < 3) return { ok: false, error: "invalid_reason" };

  const invalid = validateCancelResolution(resolution, config);
  if (invalid) return { ok: false, error: invalid };

  // Normalize: void stores null; awarded/split store their typed config.
  const storedConfig: CancelResolutionConfig =
    resolution === "void" ? null : config;

  try {
    const [m] = await db
      .select({
        status: matches.status,
        resolution: matches.cancelResolution,
      })
      .from(matches)
      .where(eq(matches.id, matchId))
      .limit(1);
    if (!m) return { ok: false, error: "match_not_found" };
    if (m.status !== "canceled") return { ok: false, error: "invalid_status" };
    if (m.resolution !== null) return { ok: false, error: "already_resolved" };

    await db.transaction(async (tx) => {
      await tx
        .update(matches)
        .set({
          cancelResolution: resolution,
          cancelResolutionConfig: storedConfig,
          statusChangedAt: new Date(),
        })
        .where(eq(matches.id, matchId));
      await tx.insert(matchStatusAudit).values({
        matchId,
        action: "resolve",
        previousStatus: "canceled",
        newStatus: "canceled",
        payload: { resolution, config: storedConfig },
        reason: trimmed,
        performedBy: auth.userId,
      });
    });

    // Grade the 1/X/2 guesses immediately. The sync sweep is the safety net if
    // this is interrupted; both share the idempotent scoreCanceledMatch path.
    const scored = await scoreCanceledMatch(matchId);

    console.info("[match resolve]", {
      matchId,
      resolution,
      config: storedConfig,
      scored,
      by: auth.userId,
    });
    revalidateMatchSurfaces(matchId);
    return { ok: true, scored };
  } catch (err) {
    console.error("[match resolve] failed:", err);
    return { ok: false, error: "db" };
  }
}

// Undo a postpone or a not-yet-resolved cancel, returning the match to
// scheduled. NOTE: live bets voided by a prior cancel are NOT auto-restored —
// the admin recreates them if needed. A canceled match whose guesses were
// already resolved/scored cannot be reopened here (would need a score unwind).
export async function reopenMatch(
  matchId: string,
  reason: string,
): Promise<Result> {
  const auth = await requireFullAdmin();
  if (!auth.ok) return auth;
  const trimmed = reason.trim();
  if (trimmed.length < 3) return { ok: false, error: "invalid_reason" };

  try {
    const [m] = await db
      .select({
        status: matches.status,
        resolution: matches.cancelResolution,
      })
      .from(matches)
      .where(eq(matches.id, matchId))
      .limit(1);
    if (!m) return { ok: false, error: "match_not_found" };
    if (m.status !== "postponed" && m.status !== "canceled") {
      return { ok: false, error: "invalid_status" };
    }
    // A resolved+scored cancel is not reversible from here.
    if (m.status === "canceled" && m.resolution !== null) {
      return { ok: false, error: "already_resolved" };
    }

    await db.transaction(async (tx) => {
      await tx
        .update(matches)
        .set({
          status: "scheduled",
          cancelResolution: null,
          cancelResolutionConfig: null,
          statusChangedAt: new Date(),
        })
        .where(eq(matches.id, matchId));
      await tx.insert(matchStatusAudit).values({
        matchId,
        action: "reopen",
        previousStatus: m.status,
        newStatus: "scheduled",
        payload: null,
        reason: trimmed,
        performedBy: auth.userId,
      });
    });

    console.info("[match reopen]", { matchId, from: m.status, by: auth.userId });
    revalidateMatchSurfaces(matchId);
    return { ok: true };
  } catch (err) {
    console.error("[match reopen] failed:", err);
    return { ok: false, error: "db" };
  }
}
