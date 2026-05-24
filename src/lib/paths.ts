import type { Locale } from "@/app/[lang]/dictionaries";

export function localePath(locale: Locale, path: string = "") {
  const trimmed = path.replace(/^\/+/, "");
  return trimmed ? `/${locale}/${trimmed}` : `/${locale}`;
}
