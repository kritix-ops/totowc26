"use server";

import { revalidatePath, updateTag } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles, payments } from "@/db/schema";
import { getUser } from "@/lib/supabase/auth";
import { accessCacheTag } from "@/lib/access";
import { ENTRY_FEE_ILS } from "@/lib/paybox";

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

    revalidatePath("/[lang]/onboarding", "page");
    revalidatePath("/[lang]/profile", "page");
    return { ok: true };
  } catch (err) {
    console.error("saveProfile failed:", err);
    return { ok: false, error: "db" };
  }
}

export type RecordPaymentResult =
  | { ok: true }
  | { ok: false; error: "unauthorized" | "db" };

// Paybox is the only supported channel. The DB enum still allows "bit"
// for historical rows, but new payments are always Paybox.
export async function recordPayment(): Promise<RecordPaymentResult> {
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
      const inserted = await db
        .insert(payments)
        .values({
          userId: user.id,
          method: "paybox",
          amountIls: ENTRY_FEE_ILS,
        })
        .returning({ id: payments.id });
      console.info("[onboarding paybox]", {
        userId: user.id,
        paymentId: inserted[0]?.id ?? null,
      });
    } else {
      console.info("[onboarding paybox]", {
        userId: user.id,
        paymentId: existing[0].id,
        reused: true,
      });
    }
    // The unpaid-banner gate uses `getUserAccess`, which is cached
    // with `access:${userId}`. Bust it so the banner disappears on
    // the next nav once the admin approves the payment. Page-level
    // paths keep the surfaces that show payment state fresh.
    updateTag(accessCacheTag(user.id));
    revalidatePath("/[lang]/pay", "page");
    revalidatePath("/[lang]/onboarding", "page");
    return { ok: true };
  } catch (err) {
    console.error("recordPayment failed:", err);
    return { ok: false, error: "db" };
  }
}
