import "server-only";

const dictionaries = {
  he: () => import("./dictionaries/he.json").then((m) => m.default),
  en: () => import("./dictionaries/en.json").then((m) => m.default),
};

export type Locale = keyof typeof dictionaries;
export const LOCALES = Object.keys(dictionaries) as Locale[];
export const DEFAULT_LOCALE: Locale = "he";

export const hasLocale = (value: string): value is Locale =>
  value in dictionaries;

export const getDictionary = async (locale: Locale) => dictionaries[locale]();

export type Dictionary = Awaited<ReturnType<typeof getDictionary>>;

export const dirFor = (locale: Locale) => (locale === "he" ? "rtl" : "ltr");
export const otherLocale = (locale: Locale): Locale =>
  locale === "he" ? "en" : "he";
