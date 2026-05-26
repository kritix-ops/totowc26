import "server-only";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { PAYBOX_FALLBACK_URL } from "./paybox";

// Reads the admin-controlled Paybox URL from `settings`. Lives in its
// own file (rather than `paybox.ts`) so the constants module stays
// importable from Client Components without dragging in `server-only`
// and the postgres driver.
//
// Settings is a singleton (id = 1). Cached per request - the URL is read
// on every payment-related page render and we don't want a DB round-trip
// each time.
export const getPayboxUrl = cache(async (): Promise<string> => {
  try {
    const [row] = await db
      .select({ payboxUrl: settings.payboxUrl })
      .from(settings)
      .where(eq(settings.id, 1))
      .limit(1);
    const stored = row?.payboxUrl?.trim();
    return stored && stored.length > 0 ? stored : PAYBOX_FALLBACK_URL;
  } catch {
    // Settings row may be missing in fresh installs / failed migrations.
    // Falling back keeps the button usable instead of crashing the page.
    return PAYBOX_FALLBACK_URL;
  }
});
