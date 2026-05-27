import "server-only";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { settings } from "@/db/schema";
import {
  DEFAULT_MOBILE_NAV_CONFIG,
  normalizeMobileNavConfig,
  type MobileNavConfig,
} from "./mobile-nav";

// Reads the admin-controlled mobile nav layout from the settings
// singleton. Cached per request because every signed-in mobile page
// load needs it once. The cache resets on each request (React `cache`)
// and we re-read after server-action mutations via revalidatePath.
//
// Defensive on read: a corrupted or stale row falls back to the
// default catalog rather than crashing the layout. `normalize` also
// drops unknown keys (handy if a key was removed from the catalog
// without a migration backfill).
export const getMobileNavConfig = cache(async (): Promise<MobileNavConfig> => {
  try {
    const [row] = await db
      .select({ mobileNavConfig: settings.mobileNavConfig })
      .from(settings)
      .where(eq(settings.id, 1))
      .limit(1);
    if (!row) return { ...DEFAULT_MOBILE_NAV_CONFIG };
    return normalizeMobileNavConfig(row.mobileNavConfig);
  } catch (err) {
    console.warn("[mobile nav config load failed]", { err });
    return { ...DEFAULT_MOBILE_NAV_CONFIG };
  }
});
