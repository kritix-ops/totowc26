"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles, payments } from "@/db/schema";
import { getUser } from "@/lib/supabase/auth";

export type SaveProfileResult =
  | { ok: true }
  | { ok: false; error: "unauthorized" | "invalid" | "db" };

export async function saveProfile(formData: FormData): Promise<SaveProfileResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauthorized" };

  const displayName = String(formData.get("displayName") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();

  if (displayName.length < 2 || phone.length < 7) {
    return { ok: false, error: "invalid" };
  }

  try {
    // Upsert. The DB trigger may have created a stub row; we update it.
    await db
      .insert(profiles)
      .values({ id: user.id, displayName, phone })
      .onConflictDoUpdate({
        target: profiles.id,
        set: { displayName, phone },
      });

    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    console.error("saveProfile failed:", err);
    return { ok: false, error: "db" };
  }
}

export type RecordPaymentResult =
  | { ok: true }
  | { ok: false; error: "unauthorized" | "db" };

export async function recordPayment(
  method: "bit" | "paybox",
): Promise<RecordPaymentResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauthorized" };

  try {
    // One pending payment per user at a time. If one exists, keep it.
    const existing = await db
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.userId, user.id))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(payments).values({
        userId: user.id,
        method,
        amountIls: 100,
      });
    }
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    console.error("recordPayment failed:", err);
    return { ok: false, error: "db" };
  }
}
