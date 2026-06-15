"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { getUser } from "@/lib/supabase/auth";
import { isAdmin } from "@/lib/admin";

export type SetTransparencyHistoryEnabledResult =
  | { ok: true }
  | { ok: false; error: "unauth" | "forbidden" | "db" };

export async function setTransparencyHistoryEnabled(
  enabled: boolean,
): Promise<SetTransparencyHistoryEnabledResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauth" };
  if (!(await isAdmin(user.id))) {
    console.warn("[transparency-history denied]", { userId: user.id });
    return { ok: false, error: "forbidden" };
  }

  try {
    await db
      .update(settings)
      .set({ transparencyHistoryEnabled: enabled, updatedAt: new Date() })
      .where(eq(settings.id, 1));
    console.info("[transparency-history toggled]", { userId: user.id, enabled });
    // The transparency page reads this flag; the admin system page renders
    // the toggle's current state.
    revalidatePath("/[lang]/transparency", "page");
    revalidatePath("/[lang]/admin/system", "page");
    return { ok: true };
  } catch (err) {
    console.error("setTransparencyHistoryEnabled failed:", err);
    return { ok: false, error: "db" };
  }
}
