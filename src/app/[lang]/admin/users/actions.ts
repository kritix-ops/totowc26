"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { profiles, payments, pointAdjustments } from "@/db/schema";
import { getUser } from "@/lib/supabase/auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { lockUserForBetting, getBankBalanceWith } from "@/lib/bank";

type Ok = { ok: true };
type Err = { ok: false; error: string };
type Result = Ok | Err;

async function assertAdmin(): Promise<{ adminId: string } | Err> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauthorized" };
  const [me] = await db
    .select({ role: profiles.role })
    .from(profiles)
    .where(eq(profiles.id, user.id))
    .limit(1);
  if (!me || me.role !== "admin") return { ok: false, error: "forbidden" };
  return { adminId: user.id };
}

export async function setUserRole(
  userId: string,
  role: "player" | "admin",
): Promise<Result> {
  const guard = await assertAdmin();
  if ("ok" in guard && guard.ok === false) return guard;
  const adminId = (guard as { adminId: string }).adminId;

  // Prevent removing the last admin.
  if (role === "player") {
    const admins = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.role, "admin"));
    if (admins.length <= 1 && admins[0]?.id === userId) {
      return { ok: false, error: "last_admin" };
    }
  }
  // Prevent admin from demoting themselves.
  if (role === "player" && userId === adminId) {
    return { ok: false, error: "cannot_demote_self" };
  }

  await db.update(profiles).set({ role }).where(eq(profiles.id, userId));
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateUserProfile(
  userId: string,
  displayName: string,
  phone: string,
): Promise<Result> {
  const guard = await assertAdmin();
  if ("ok" in guard && guard.ok === false) return guard;

  const name = displayName.trim();
  const tel = phone.trim();
  if (name.length < 2 || tel.length < 7) return { ok: false, error: "invalid" };

  await db
    .update(profiles)
    .set({ displayName: name, phone: tel })
    .where(eq(profiles.id, userId));
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function decidePayment(
  paymentId: string,
  decision: "approved" | "rejected",
  note?: string,
): Promise<Result> {
  const guard = await assertAdmin();
  if ("ok" in guard && guard.ok === false) return guard;
  const adminId = (guard as { adminId: string }).adminId;

  await db
    .update(payments)
    .set({
      status: decision,
      decidedAt: new Date(),
      decidedBy: adminId,
      ...(note ? { note } : {}),
    })
    .where(eq(payments.id, paymentId));
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function manualMarkPaid(
  userId: string,
  method: "bit" | "paybox",
  note?: string,
): Promise<Result> {
  const guard = await assertAdmin();
  if ("ok" in guard && guard.ok === false) return guard;
  const adminId = (guard as { adminId: string }).adminId;

  await db.insert(payments).values({
    userId,
    method,
    amountIls: 100,
    status: "approved",
    decidedAt: new Date(),
    decidedBy: adminId,
    note: note ?? "marked paid by admin",
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function bulkApprovePending(): Promise<{ ok: true; n: number } | Err> {
  const guard = await assertAdmin();
  if ("ok" in guard && guard.ok === false) return guard;
  const adminId = (guard as { adminId: string }).adminId;

  const rows = await db
    .update(payments)
    .set({ status: "approved", decidedAt: new Date(), decidedBy: adminId })
    .where(eq(payments.status, "pending"))
    .returning({ id: payments.id });
  revalidatePath("/", "layout");
  return { ok: true, n: rows.length };
}

export async function removeUser(userId: string): Promise<Result> {
  const guard = await assertAdmin();
  if ("ok" in guard && guard.ok === false) return guard;
  const adminId = (guard as { adminId: string }).adminId;

  if (userId === adminId) return { ok: false, error: "cannot_remove_self" };

  try {
    const admin = getSupabaseAdmin();
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) return { ok: false, error: error.message };
    // The auth.users delete cascades to public.profiles and onward via FKs.
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    console.error("removeUser failed:", err);
    return { ok: false, error: "db" };
  }
}

export async function resendMagicLink(email: string): Promise<Result> {
  const guard = await assertAdmin();
  if ("ok" in guard && guard.ok === false) return guard;

  try {
    const admin = getSupabaseAdmin();
    const { error } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    console.error("resendMagicLink failed:", err);
    return { ok: false, error: "db" };
  }
}

export type InviteResult =
  | { ok: true; inviteUrl: string; userId: string }
  | Err;

// Create an auth user with admin-supplied profile data, then generate a
// one-time password-set link that the admin shares via WhatsApp / email.
export async function invitePlayer(
  displayName: string,
  phone: string,
  email: string,
  origin: string,
): Promise<InviteResult> {
  const guard = await assertAdmin();
  if ("ok" in guard && guard.ok === false) return guard;

  const name = displayName.trim();
  const tel = phone.trim();
  const mail = email.trim().toLowerCase();
  if (name.length < 2) return { ok: false, error: "name_too_short" };
  if (tel.length < 7) return { ok: false, error: "phone_too_short" };
  if (!mail.includes("@")) return { ok: false, error: "invalid_email" };

  const admin = getSupabaseAdmin();

  // 1) Create the auth user. The DB trigger creates a profile row from
  //    user_metadata. We also explicitly upsert the profile below as a
  //    safety net in case the trigger doesn't pick up the metadata.
  const created = await admin.auth.admin.createUser({
    email: mail,
    email_confirm: true,
    user_metadata: { display_name: name, phone: tel },
  });
  if (created.error) {
    const msg = created.error.message.toLowerCase();
    if (msg.includes("already") || msg.includes("exists")) {
      return { ok: false, error: "email_taken" };
    }
    return { ok: false, error: created.error.message };
  }
  const userId = created.data.user?.id;
  if (!userId) return { ok: false, error: "create_failed" };

  // 2) Safety-net upsert in case the trigger races or the metadata path
  //    differs across Supabase versions.
  await db
    .insert(profiles)
    .values({ id: userId, displayName: name, phone: tel })
    .onConflictDoUpdate({
      target: profiles.id,
      set: { displayName: name, phone: tel },
    });

  // 3) Generate a recovery link so the invitee can set their password
  //    and sign in on first visit.
  const link = await admin.auth.admin.generateLink({
    type: "recovery",
    email: mail,
    options: {
      redirectTo: `${origin}/auth/callback?next=/he/set-password`,
    },
  });
  if (link.error) {
    return { ok: false, error: link.error.message };
  }
  const url = link.data.properties?.action_link;
  if (!url) return { ok: false, error: "no_link" };

  revalidatePath("/", "layout");
  return { ok: true, inviteUrl: url, userId };
}

// Re-generate an invite link for an existing user, e.g. they lost the original.
export async function regenerateInviteLink(
  email: string,
  origin: string,
): Promise<InviteResult> {
  const guard = await assertAdmin();
  if ("ok" in guard && guard.ok === false) return guard;

  const admin = getSupabaseAdmin();
  const link = await admin.auth.admin.generateLink({
    type: "recovery",
    email: email.trim().toLowerCase(),
    options: {
      redirectTo: `${origin}/auth/callback?next=/he/set-password`,
    },
  });
  if (link.error) return { ok: false, error: link.error.message };
  const url = link.data.properties?.action_link;
  if (!url) return { ok: false, error: "no_link" };
  const userId = link.data.user?.id ?? "";
  return { ok: true, inviteUrl: url, userId };
}

// Adjust a user's points bank by a signed delta. Append-only audit log.
// Constraints (also enforced at the DB level via CHECK):
//   - delta non-zero
//   - |delta| <= 500  (per-row sanity cap; admin can split into multiple rows)
//   - reason length >= 3
// The point_adjustments table has REVOKE UPDATE/DELETE on client roles, so
// once written this row cannot be edited or removed by any non-superuser.
export async function adjustUserPoints(
  targetUserId: string,
  delta: number,
  reason: string,
): Promise<
  | { ok: true; newBalance: number; oldBalance: number }
  | { ok: false; error: string }
> {
  const guard = await assertAdmin();
  if ("ok" in guard && guard.ok === false) return guard;
  const adminId = (guard as { adminId: string }).adminId;

  const d = Math.trunc(Number(delta));
  if (!Number.isFinite(d) || d === 0) return { ok: false, error: "invalid" };
  if (Math.abs(d) > 500) return { ok: false, error: "invalid" };
  const r = reason.trim();
  if (r.length < 3) return { ok: false, error: "invalid" };

  try {
    const result = await db.transaction(async (tx) => {
      // Lock the target user so this insert and the balance read are
      // serialised against concurrent bet submissions from that user.
      await lockUserForBetting(tx, targetUserId);
      const oldBalance = await getBankBalanceWith(tx, targetUserId);
      await tx.insert(pointAdjustments).values({
        userId: targetUserId,
        delta: d,
        reason: r,
        createdBy: adminId,
      });
      const newBalance = oldBalance + d;
      console.info("[admin adjustment]", {
        targetUserId,
        delta: d,
        reason: r,
        by: adminId,
        oldBalance,
        newBalance,
      });
      return { ok: true as const, oldBalance, newBalance };
    });
    revalidatePath("/", "layout");
    return result;
  } catch (err) {
    console.error("adjustUserPoints failed:", err);
    return { ok: false, error: "db" };
  }
}

// Reset a user's bets — main match picks plus every custom-bet pick.
// Useful before the tournament starts if a player wants to redo their
// picks. Adjustments and approved payment stay intact.
export async function resetUserPicks(userId: string): Promise<Result> {
  const guard = await assertAdmin();
  if ("ok" in guard && guard.ok === false) return guard;

  await db.execute(sql`delete from public.match_bets where user_id = ${userId}`);
  await db.execute(
    sql`delete from public.user_custom_bet_picks where user_id = ${userId}`,
  );
  revalidatePath("/", "layout");
  return { ok: true };
}
