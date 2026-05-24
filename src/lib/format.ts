import type { Locale } from "@/app/[lang]/dictionaries";

const IL_TIMEZONE = "Asia/Jerusalem";

export function formatDateTime(
  value: string | number | Date,
  locale: Locale,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-GB", {
    ...options,
    timeZone: IL_TIMEZONE,
  }).format(value instanceof Date ? value : new Date(value));
}
