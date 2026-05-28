"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { isAdmin } from "@/lib/admin";
import { getUser } from "@/lib/supabase/auth";
import {
  MOBILE_NAV_BAR_MAX,
  MOBILE_NAV_BAR_MIN,
  MOBILE_NAV_KEY_SET,
  type MobileNavConfig,
  type MobileNavItemKey,
} from "@/lib/mobile-nav";

// Server action for /admin/settings/mobile-nav. Persists the admin's
// chosen mobile bottom-nav layout to the settings singleton. Hardens
// against tampered/stale clients: only known keys are accepted, dupes
// are dropped, the bar-count is clamped, and the visible list must be
// non-empty (DB CHECK constraint mirrors this).

export type SaveMobileNavResult =
  | { ok: true }
  | { ok: false; error: "unauth" | "forbidden" | "invalid" | "db" };

async function getAdminId(): Promise<string | null> {
  const user = await getUser();
  if (!user || !(await isAdmin(user.id))) return null;
  return user.id;
}

export async function saveMobileNavConfig(
  payload: MobileNavConfig,
): Promise<SaveMobileNavResult> {
  const adminId = await getAdminId();
  if (!adminId) {
    console.warn("[admin mobile-nav save denied]", {});
    return { ok: false, error: "forbidden" };
  }

  if (
    !payload ||
    typeof payload !== "object" ||
    !Array.isArray(payload.items) ||
    typeof payload.bottomBarCount !== "number"
  ) {
    return { ok: false, error: "invalid" };
  }

  // Dedupe + drop unknown keys.
  const seen = new Set<MobileNavItemKey>();
  const items: MobileNavItemKey[] = [];
  for (const raw of payload.items) {
    if (typeof raw !== "string") continue;
    if (!MOBILE_NAV_KEY_SET.has(raw as MobileNavItemKey)) continue;
    const k = raw as MobileNavItemKey;
    if (seen.has(k)) continue;
    seen.add(k);
    items.push(k);
  }
  if (items.length === 0) {
    return { ok: false, error: "invalid" };
  }

  let count = Math.trunc(payload.bottomBarCount);
  if (!Number.isFinite(count)) return { ok: false, error: "invalid" };
  if (count < MOBILE_NAV_BAR_MIN) count = MOBILE_NAV_BAR_MIN;
  if (count > MOBILE_NAV_BAR_MAX) count = MOBILE_NAV_BAR_MAX;

  const next: MobileNavConfig = { items, bottomBarCount: count };

  try {
    const [prevRow] = await db
      .select({ mobileNavConfig: settings.mobileNavConfig })
      .from(settings)
      .where(eq(settings.id, 1))
      .limit(1);

    await db
      .update(settings)
      .set({ mobileNavConfig: next, updatedAt: new Date() })
      .where(eq(settings.id, 1));

    console.info("[admin mobile-nav save]", {
      byUserId: adminId,
      prev: prevRow?.mobileNavConfig ?? null,
      next,
    });

    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    console.error("saveMobileNavConfig failed:", err);
    return { ok: false, error: "db" };
  }
}
