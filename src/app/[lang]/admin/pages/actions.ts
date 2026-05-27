"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { isAdmin } from "@/lib/admin";
import { getUser } from "@/lib/supabase/auth";
import { validateHiddenKeys } from "@/lib/page-visibility";

// Save the admin-controlled visibility list. Validates every key
// against HIDEABLE_PAGE_KEYS - unknown keys (including the system keys
// admin/login/profile/signup/home, which are intentionally never
// hideable) are rejected. The shape constraint on the DB column
// (jsonb array) is a second line of defence.
//
// See _plans/2026-05-27-page-visibility.md.

export type SaveResult =
  | { ok: true }
  | { ok: false; error: "unauth" | "forbidden" | "invalid" | "db" };

export async function saveHiddenPages(keys: unknown): Promise<SaveResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauth" };
  if (!(await isAdmin(user.id))) return { ok: false, error: "forbidden" };

  const cleaned = validateHiddenKeys(keys);
  if (cleaned === null) return { ok: false, error: "invalid" };

  try {
    const [oldRow] = await db
      .select({ hiddenPages: settings.hiddenPages })
      .from(settings)
      .where(eq(settings.id, 1))
      .limit(1);
    const oldList: string[] = Array.isArray(oldRow?.hiddenPages)
      ? (oldRow.hiddenPages as string[])
      : [];

    await db
      .update(settings)
      .set({ hiddenPages: cleaned, updatedAt: new Date() })
      .where(eq(settings.id, 1));

    const added = cleaned.filter((k) => !oldList.includes(k));
    const removed = oldList.filter((k) => !cleaned.includes(k));
    console.info("[page visibility save]", {
      adminId: user.id,
      oldList,
      newList: cleaned,
      diff: { added, removed },
    });

    // Revalidate the whole layout so the bottom-nav re-renders without
    // a hard refresh and so any user mid-session loses access to a
    // newly-hidden page on their next navigation.
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    console.error("[page visibility save] failed:", err);
    return { ok: false, error: "db" };
  }
}
