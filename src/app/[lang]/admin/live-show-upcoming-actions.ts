"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { getUser } from "@/lib/supabase/auth";
import { isAdmin } from "@/lib/admin";

export type SetLiveShowUpcomingResult =
  | { ok: true }
  | { ok: false; error: "unauth" | "forbidden" | "db" };

export async function setLiveShowUpcoming(
  enabled: boolean,
): Promise<SetLiveShowUpcomingResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauth" };
  if (!(await isAdmin(user.id))) {
    console.warn("[live-show-upcoming denied]", { userId: user.id });
    return { ok: false, error: "forbidden" };
  }

  try {
    await db
      .update(settings)
      .set({ liveShowUpcoming: enabled, updatedAt: new Date() })
      .where(eq(settings.id, 1));
    console.info("[live-show-upcoming toggled]", { userId: user.id, enabled });
    revalidatePath("/[lang]/live", "page");
    revalidatePath("/[lang]/admin/system", "page");
    return { ok: true };
  } catch (err) {
    console.error("setLiveShowUpcoming failed:", err);
    return { ok: false, error: "db" };
  }
}
