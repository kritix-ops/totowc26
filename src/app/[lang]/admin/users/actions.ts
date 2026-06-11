"use server";

import { revalidatePath } from "next/cache";
import { eq, sql, desc, and, inArray } from "drizzle-orm";
import { db } from "@/db";
import { execRows } from "@/db/helpers";
import {
  profiles,
  payments,
  pointAdjustments,
  passwordResetAudit,
} from "@/db/schema";
import { isAdmin } from "@/lib/admin";
import { buildAuthConfirmUrl, getUser } from "@/lib/supabase/auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { lockUserForBetting, getBankBalanceWith } from "@/lib/bank";
import { ENTRY_FEE_ILS } from "@/lib/paybox";

type Ok = { ok: true };
type Err = { ok: false; error: string };
type Result = Ok | Err;

async function assertAdmin(): Promise<{ adminId: string } | Err> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauthorized" };
  if (!(await isAdmin(user.id))) return { ok: false, error: "forbidden" };
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

  // Approving must not create a second approved row for the user — the
  // payments table allows only one (migration 0046; rationale in
  // src/db/pot.ts). If they're already paid on another row, refuse rather
  // than hit the unique constraint.
  if (decision === "approved") {
    const [target] = await db
      .select({ userId: payments.userId })
      .from(payments)
      .where(eq(payments.id, paymentId));
    if (target) {
      const approved = await db
        .select({ id: payments.id })
        .from(payments)
        .where(
          and(
            eq(payments.userId, target.userId),
            eq(payments.status, "approved"),
          ),
        );
      if (approved.some((p) => p.id !== paymentId)) {
        return { ok: false, error: "already_paid" };
      }
    }
  }

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

  // Never stack a second approved row on a user — that double-counts in the
  // pot (see src/db/pot.ts for the history behind this). If the user is
  // already paid, this is a no-op the caller should be told about. If they
  // have a pending payment (e.g. a Paybox submission awaiting approval),
  // approve that row in place instead of inserting a parallel one. Only
  // when there is nothing to approve do we create a fresh approved row.
  const existing = await db
    .select({ id: payments.id, status: payments.status })
    .from(payments)
    .where(eq(payments.userId, userId))
    .orderBy(desc(payments.submittedAt));

  if (existing.some((p) => p.status === "approved")) {
    return { ok: false, error: "already_paid" };
  }

  const pending = existing.find((p) => p.status === "pending");
  if (pending) {
    await db
      .update(payments)
      .set({
        status: "approved",
        method,
        decidedAt: new Date(),
        decidedBy: adminId,
        note: note ?? "marked paid by admin",
      })
      .where(eq(payments.id, pending.id));
  } else {
    await db.insert(payments).values({
      userId,
      method,
      amountIls: ENTRY_FEE_ILS,
      status: "approved",
      decidedAt: new Date(),
      decidedBy: adminId,
      note: note ?? "marked paid by admin",
    });
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function bulkApprovePending(): Promise<{ ok: true; n: number } | Err> {
  const guard = await assertAdmin();
  if ("ok" in guard && guard.ok === false) return guard;
  const adminId = (guard as { adminId: string }).adminId;

  // Approve at most one pending payment per user, and only for users who
  // are not already approved, so a bulk run can never produce a second
  // approved row (enforced by the unique index in migration 0046). Without
  // this, one stray pending+approved pair would fail the whole batch.
  const eligible = await execRows<{ id: string }>(sql`
    select distinct on (user_id) id
    from public.payments p
    where p.status = 'pending'
      and not exists (
        select 1 from public.payments a
        where a.user_id = p.user_id and a.status = 'approved'
      )
    order by user_id, submitted_at asc
  `);
  if (eligible.length === 0) {
    revalidatePath("/", "layout");
    return { ok: true, n: 0 };
  }

  await db
    .update(payments)
    .set({ status: "approved", decidedAt: new Date(), decidedBy: adminId })
    .where(inArray(payments.id, eligible.map((r) => r.id)));
  revalidatePath("/", "layout");
  return { ok: true, n: eligible.length };
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
  });
  if (link.error) {
    return { ok: false, error: link.error.message };
  }
  const hashedToken = link.data.properties?.hashed_token;
  if (!hashedToken) return { ok: false, error: "no_link" };
  const url = buildAuthConfirmUrl({
    origin,
    hashedToken,
    type: "recovery",
    next: "/he/set-password",
  });

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
  });
  if (link.error) return { ok: false, error: link.error.message };
  const hashedToken = link.data.properties?.hashed_token;
  if (!hashedToken) return { ok: false, error: "no_link" };
  const url = buildAuthConfirmUrl({
    origin,
    hashedToken,
    type: "recovery",
    next: "/he/set-password",
  });
  const userId = link.data.user?.id ?? "";
  return { ok: true, inviteUrl: url, userId };
}

// Reset a user's password: generate a one-time recovery link that lands
// them on /set-password, and record the reset in the append-only
// password_reset_audit log (who reset whom, when).
//
// The target email is read server-side from the user id rather than passed
// from the client, so the link and the audit row can never be aimed at a
// different account. Generating the link does not invalidate the current
// password — the old one simply stops mattering once a new one is set, and
// the link is single-use and time-limited by Supabase.
export async function resetUserPassword(
  targetUserId: string,
  origin: string,
): Promise<InviteResult> {
  const guard = await assertAdmin();
  if ("ok" in guard && guard.ok === false) return guard;
  const adminId = (guard as { adminId: string }).adminId;

  try {
    const admin = getSupabaseAdmin();

    const found = await admin.auth.admin.getUserById(targetUserId);
    if (found.error) return { ok: false, error: found.error.message };
    const email = found.data.user?.email;
    if (!email) return { ok: false, error: "no_email" };

    const link = await admin.auth.admin.generateLink({
      type: "recovery",
      email,
    });
    if (link.error) return { ok: false, error: link.error.message };
    const hashedToken = link.data.properties?.hashed_token;
    if (!hashedToken) return { ok: false, error: "no_link" };
    const url = buildAuthConfirmUrl({
      origin,
      hashedToken,
      type: "recovery",
      next: "/he/set-password",
    });

    await db.insert(passwordResetAudit).values({ adminId, targetUserId });
    console.info("[admin password reset]", { targetUserId, by: adminId });

    return { ok: true, inviteUrl: url, userId: targetUserId };
  } catch (err) {
    console.error("resetUserPassword failed:", err);
    return { ok: false, error: "db" };
  }
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

// Reset a user's bets - main match picks plus every custom-bet pick.
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
