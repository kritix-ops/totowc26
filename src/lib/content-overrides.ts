import "server-only";

import { and, eq } from "drizzle-orm";
import { unstable_cache } from "next/cache";

import { db } from "@/db";
import { contentOverrides, contentOverrideHistory } from "@/db/schema";

// Cache tag shared by every override row. The admin save action calls
// revalidateTag(CONTENT_OVERRIDES_TAG) after writing so every server
// render reading the dictionary picks up the new value within the next
// request cycle.
export const CONTENT_OVERRIDES_TAG = "content-overrides";

export type SupportedLocale = "he" | "en";

// Flat shape: { "section.key": "value" }. The dictionary loader walks
// the keys and applies them on top of the JSON default. Keys not present
// here keep the JSON default verbatim.
export type OverrideMap = Record<string, string>;

// Drops the override (back to JSON default). Server action helper.
export type OverrideMutation =
  | { type: "set"; value: string }
  | { type: "reset" };

async function loadOverridesFromDb(
  locale: SupportedLocale,
): Promise<OverrideMap> {
  console.info("[dict load] cache_miss", { locale });
  const rows = await db
    .select({ key: contentOverrides.key, value: contentOverrides.value })
    .from(contentOverrides)
    .where(eq(contentOverrides.locale, locale));

  const map: OverrideMap = {};
  for (const row of rows) {
    map[row.key] = row.value;
  }
  console.info("[dict load] overrides_applied", {
    locale,
    count: rows.length,
  });
  return map;
}

// Cached read used by every page render. Tagged so the admin save can
// invalidate every cached locale at once.
export async function getOverrides(
  locale: SupportedLocale,
): Promise<OverrideMap> {
  const cached = unstable_cache(
    async () => loadOverridesFromDb(locale),
    ["content-overrides", locale],
    { tags: [CONTENT_OVERRIDES_TAG], revalidate: 600 },
  );
  return cached();
}

// Walks a dotted key like "rules.bankBody" and assigns into a nested
// dictionary object. Used by the loader to merge overrides on top of
// the JSON default. Silently no-ops if the path doesn't exist in the
// default (stale key from a previous version).
export function applyOverride(
  // Generic JSON-shaped value; using unknown here would force a cast at
  // every level of the walk. The dictionary itself is a Record so this
  // is consistent with how the caller treats it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  target: any,
  dottedKey: string,
  value: string,
): void {
  const parts = dottedKey.split(".");
  let node = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const segment = parts[i];
    if (
      node == null ||
      typeof node !== "object" ||
      !Object.prototype.hasOwnProperty.call(node, segment)
    ) {
      return;
    }
    node = node[segment];
  }
  const leaf = parts[parts.length - 1];
  if (
    node != null &&
    typeof node === "object" &&
    Object.prototype.hasOwnProperty.call(node, leaf) &&
    typeof node[leaf] === "string"
  ) {
    node[leaf] = value;
  }
}

// Admin server-action helper. Writes the override (or deletes it), then
// appends a history row. Caller is responsible for revalidateTag and
// auth gating.
export async function writeOverride(
  key: string,
  locale: SupportedLocale,
  mutation: OverrideMutation,
  updatedBy: string,
): Promise<void> {
  const [existing] = await db
    .select({ value: contentOverrides.value })
    .from(contentOverrides)
    .where(
      and(eq(contentOverrides.key, key), eq(contentOverrides.locale, locale)),
    )
    .limit(1);

  const oldValue = existing?.value ?? null;

  if (mutation.type === "reset") {
    if (existing) {
      await db
        .delete(contentOverrides)
        .where(
          and(
            eq(contentOverrides.key, key),
            eq(contentOverrides.locale, locale),
          ),
        );
    }
    await db.insert(contentOverrideHistory).values({
      key,
      locale,
      oldValue,
      newValue: null,
      updatedBy,
    });
    return;
  }

  if (existing) {
    await db
      .update(contentOverrides)
      .set({ value: mutation.value, updatedBy, updatedAt: new Date() })
      .where(
        and(
          eq(contentOverrides.key, key),
          eq(contentOverrides.locale, locale),
        ),
      );
  } else {
    await db.insert(contentOverrides).values({
      key,
      locale,
      value: mutation.value,
      updatedBy,
    });
  }
  await db.insert(contentOverrideHistory).values({
    key,
    locale,
    oldValue,
    newValue: mutation.value,
    updatedBy,
  });
}

// Lists every override row for the admin editor. Not cached - the
// editor wants live truth so the admin sees the result of a save the
// moment it lands.
export async function listAllOverrides(): Promise<
  Array<{
    key: string;
    locale: SupportedLocale;
    value: string;
    updatedAt: Date;
  }>
> {
  const rows = await db
    .select({
      key: contentOverrides.key,
      locale: contentOverrides.locale,
      value: contentOverrides.value,
      updatedAt: contentOverrides.updatedAt,
    })
    .from(contentOverrides);
  return rows.map((r) => ({
    ...r,
    locale: r.locale as SupportedLocale,
  }));
}
