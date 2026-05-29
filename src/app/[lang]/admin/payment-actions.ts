"use server";

import { revalidatePath, updateTag } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { payments } from "@/db/schema";
import { isAdmin } from "@/lib/admin";
import { getUser } from "@/lib/supabase/auth";
import { accessCacheTag } from "@/lib/access";
import { CACHE_TAG_POOL } from "@/db/queries";

export type PaymentDecisionResult =
  | { ok: true; status: "approved" | "rejected" }
  | { ok: false; error: "forbidden" | "not_found" | "db" };

async function requireAdminUser() {
  const user = await getUser();
  if (!user || !(await isAdmin(user.id))) return null;
  return user;
}

async function decide(
  paymentId: string,
  status: "approved" | "rejected",
  note: string | null,
): Promise<PaymentDecisionResult> {
  const user = await requireAdminUser();
  if (!user) return { ok: false, error: "forbidden" };
  try {
    const updated = await db
      .update(payments)
      .set({
        status,
        decidedAt: new Date(),
        decidedBy: user.id,
        ...(note != null ? { note } : {}),
      })
      .where(eq(payments.id, paymentId))
      .returning({ id: payments.id, userId: payments.userId });
    if (updated.length === 0) return { ok: false, error: "not_found" };
    // Drop the affected user's cached access (so their bank pill /
    // pay-gate banner flips on their next nav) and bust the global
    // pool / prize aggregates. revalidatePath also drops these
    // implicitly for the admin's own session — the tag calls are
    // what propagate the fresh state to every other user's render.
    const affectedUserId = updated[0]?.userId;
    if (affectedUserId) updateTag(accessCacheTag(affectedUserId));
    updateTag(CACHE_TAG_POOL);
    // Surfaces the admin sees right after deciding: payments panel,
    // signup-requests panel, the affected user's profile, transparency.
    // Tag invalidation above already covers other users on their next
    // nav, so the layout-wide nuke was overkill and made the
    // approve/reject buttons feel "stuck".
    revalidatePath("/[lang]/admin", "page");
    revalidatePath("/[lang]/transparency", "page");
    return { ok: true, status };
  } catch (err) {
    console.error("payment decide failed:", err);
    return { ok: false, error: "db" };
  }
}

export async function approvePayment(
  paymentId: string,
): Promise<PaymentDecisionResult> {
  return decide(paymentId, "approved", null);
}

export async function rejectPayment(
  paymentId: string,
  note?: string,
): Promise<PaymentDecisionResult> {
  return decide(paymentId, "rejected", note?.trim() || null);
}

// Reopen a previously decided payment (admin made a mistake). Sets status
// back to 'pending' and clears the decision audit columns.
export async function reopenPayment(
  paymentId: string,
): Promise<PaymentDecisionResult> {
  const user = await requireAdminUser();
  if (!user) return { ok: false, error: "forbidden" };
  try {
    const updated = await db
      .update(payments)
      .set({
        status: "pending",
        decidedAt: null,
        decidedBy: null,
      })
      .where(eq(payments.id, paymentId))
      .returning({ id: payments.id, userId: payments.userId });
    if (updated.length === 0) return { ok: false, error: "not_found" };
    const affectedUserId = updated[0]?.userId;
    if (affectedUserId) updateTag(accessCacheTag(affectedUserId));
    updateTag(CACHE_TAG_POOL);
    revalidatePath("/[lang]/admin", "page");
    revalidatePath("/[lang]/transparency", "page");
    return { ok: true, status: "approved" }; // status field reused as discriminant; reopen result not surfaced separately
  } catch (err) {
    console.error("payment reopen failed:", err);
    return { ok: false, error: "db" };
  }
}
