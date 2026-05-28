import "server-only";

import {
  applyOverride,
  getOverrides,
  type SupportedLocale,
} from "@/lib/content-overrides";

const dictionaries = {
  he: () => import("./dictionaries/he.json").then((m) => m.default),
  en: () => import("./dictionaries/en.json").then((m) => m.default),
};

export type Locale = keyof typeof dictionaries;
export const LOCALES = Object.keys(dictionaries) as Locale[];
export const DEFAULT_LOCALE: Locale = "he";

export const hasLocale = (value: string): value is Locale =>
  value in dictionaries;

// Loads the JSON default, clones it so we never mutate the cached
// module export, and layers any rows from content_overrides on top.
// The override read is cached by tag (CONTENT_OVERRIDES_TAG), so an
// admin save instantly invalidates every locale.
export const getDictionary = async (locale: Locale) => {
  const base = await dictionaries[locale]();
  const overrides = await getOverrides(locale as SupportedLocale);
  if (Object.keys(overrides).length === 0) {
    return base;
  }
  const merged = structuredClone(base);
  for (const [key, value] of Object.entries(overrides)) {
    applyOverride(merged, key, value);
  }
  return merged;
};

// The JSON default - no override layer applied. Used by /admin/content
// so the editor always knows what would ship if every override were
// cleared.
export const getDefaultDictionary = async (locale: Locale) =>
  dictionaries[locale]();

export type Dictionary = Awaited<ReturnType<typeof getDictionary>>;

export const dirFor = (locale: Locale) => (locale === "he" ? "rtl" : "ltr");
export const otherLocale = (locale: Locale): Locale =>
  locale === "he" ? "en" : "he";
