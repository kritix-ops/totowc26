"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { getUser } from "@/lib/supabase/auth";
import { isAdmin } from "@/lib/admin";

export type SetDashboardDigestEnabledResult =
  | { ok: true }
  | { ok: false; error: "unauth" | "forbidden" | "db" };

export async function setDashboardDigestEnabled(
  enabled: boolean,
): Promise<SetDashboardDigestEnabledResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauth" };
  if (!(await isAdmin(user.id))) {
    console.warn("[dashboard-digest denied]", { userId: user.id });
    return { ok: false, error: "forbidden" };
  }

  try {
    await db
      .update(settings)
      .set({ dashboardDigestEnabled: enabled, updatedAt: new Date() })
      .where(eq(settings.id, 1));
    console.info("[dashboard-digest toggled]", { userId: user.id, enabled });
    // Home dashboard + system admin page both read this flag.
    revalidatePath("/[lang]", "page");
    revalidatePath("/[lang]/admin/system", "page");
    return { ok: true };
  } catch (err) {
    console.error("setDashboardDigestEnabled failed:", err);
    return { ok: false, error: "db" };
  }
}
