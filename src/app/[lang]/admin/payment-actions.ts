"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { payments, profiles } from "@/db/schema";
import { getUser } from "@/lib/supabase/auth";

export type PaymentDecisionResult =
  | { ok: true; status: "approved" | "rejected" }
  | { ok: false; error: "forbidden" | "not_found" | "db" };

async function requireAdminUser() {
  const user = await getUser();
  if (!user) return null;
  const [p] = await db
    .select({ role: profiles.role })
    .from(profiles)
    .where(eq(profiles.id, user.id))
    .limit(1);
  if (!p || p.role !== "admin") return null;
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
      .returning({ id: payments.id });
    if (updated.length === 0) return { ok: false, error: "not_found" };
    revalidatePath("/", "layout");
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
      .returning({ id: payments.id });
    if (updated.length === 0) return { ok: false, error: "not_found" };
    revalidatePath("/", "layout");
    return { ok: true, status: "approved" }; // status field reused as discriminant; reopen result not surfaced separately
  } catch (err) {
    console.error("payment reopen failed:", err);
    return { ok: false, error: "db" };
  }
}
