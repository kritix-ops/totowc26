import "server-only";

import { cache } from "react";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { localePath } from "@/lib/paths";
import {
  HIDEABLE_PAGE_KEYS,
  type HideablePageKey,
} from "./page-visibility-catalog";

// Server-only helpers for the page-visibility feature. The catalog
// (keys, labels, validator) lives in page-visibility-catalog.ts so
// client components can import it without dragging the db/postgres
// chain into the browser bundle. See
// _plans/2026-05-27-page-visibility.md.

// Re-export the catalog so existing server callers (admin page,
// gatePage callers in server-side page.tsx files) can keep importing
// from a single module.
export {
  HIDEABLE_PAGE_KEYS,
  HIDEABLE_PAGE_LABELS,
  NEVER_HIDEABLE,
  validateHiddenKeys,
  isHideablePageKey,
  type HideablePageKey,
} from "./page-visibility-catalog";

const HIDEABLE_SET: ReadonlySet<string> = new Set(HIDEABLE_PAGE_KEYS);

// Cached per-request read of settings.hidden_pages. Defensive: a row
// that returns a non-array (corrupt write) is normalised to [].
export const readHiddenPages = cache(async (): Promise<string[]> => {
  try {
    const [row] = await db
      .select({ hiddenPages: settings.hiddenPages })
      .from(settings)
      .where(eq(settings.id, 1))
      .limit(1);
    const raw = row?.hiddenPages;
    if (!Array.isArray(raw)) return [];
    return raw.filter((k): k is string => typeof k === "string");
  } catch (err) {
    console.warn("[page visibility read failed]", { err });
    return [];
  }
});

// Used by page.tsx (or its segment layout). If the key is in the hidden
// list, redirects to `/<lang>?hidden=<key>` and never returns. Safe to
// call from server components - never blows up; on read failure it
// errs open (page renders) and emits a warning.
export async function gatePage(
  key: HideablePageKey,
  lang: string,
): Promise<void> {
  if (!HIDEABLE_SET.has(key)) return;
  const hidden = await readHiddenPages();
  if (!hidden.includes(key)) return;
  console.info("[page visibility gate]", { key, lang, action: "redirect" });
  redirect(`${localePath(lang as "he" | "en")}?hidden=${key}`);
}

// Convenience for nav rendering and the admin UI.
export async function isPageHidden(key: HideablePageKey): Promise<boolean> {
  const list = await readHiddenPages();
  return list.includes(key);
}
