import type { Locale } from "@/app/[lang]/dictionaries";
import { MS_PER_MINUTE } from "./time";

const IL_TIMEZONE = "Asia/Jerusalem";

export function formatDateTime(
  value: string | number | Date,
  locale: Locale,
  options: Intl.DateTimeFormatOptions,
): string {
  const raw = new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-GB", {
    ...options,
    timeZone: IL_TIMEZONE,
  }).format(value instanceof Date ? value : new Date(value));
  // Intl returns weekday="שבת" while every other Hebrew weekday comes
  // through as "יום X" — the only day without the "יום" prefix. The
  // QA agent flagged the inconsistency. Prepend "יום" so all seven days
  // start the same way visually. Only applied when a weekday is
  // actually present in `options`, to avoid prepending to bare-date
  // strings that happen to contain "שבת" by coincidence (extremely
  // unlikely, but the guard is cheap).
  if (locale === "he" && options.weekday) {
    // The earlier version used `\b` after "שבת" - which does not work
    // for Hebrew letters because `\b` is defined relative to `\w`
    // (ASCII word chars only). So the replace silently no-op'd. The
    // QA agent re-flagged "שבת, 13 ביוני" without the "יום" prefix.
    // The lookahead form below uses an explicit "follow with comma /
    // space / end-of-string" check that does not depend on `\w`, and
    // the leading group still requires start-of-string or whitespace
    // or comma so we do not prepend inside words like "שבתות".
    return raw.replace(/(^|[\s,])שבת(?=[,\s]|$)/gu, "$1יום שבת");
  }
  return raw;
}

// Convert a UTC ISO string to the "YYYY-MM-DDTHH:mm" wall-clock string
// that an <input type="datetime-local"> widget consumes, projected onto
// Asia/Jerusalem so the admin always sees IL time regardless of where
// their browser thinks it is.
export function isoToLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const parts = ilDateParts(new Date(iso).getTime());
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

// Re-interpret a "YYYY-MM-DDTHH:mm" string from the widget as
// Asia/Jerusalem wall time and return its UTC ISO. DST transitions
// stay correct because the IL offset is resolved against the resulting
// instant rather than assumed constant.
//
// Returns null for empty or malformed input; callers should treat that
// as "leave existing value alone" rather than "save as null".
export function localInputValueToIso(value: string): string | null {
  if (!value) return null;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, da, h, mi] = m;
  const utcGuess = Date.UTC(+y, +mo - 1, +da, +h, +mi);
  const tzMinutes = ilOffsetMinutesAt(utcGuess);
  return new Date(utcGuess - tzMinutes * MS_PER_MINUTE).toISOString();
}

// Offset of Asia/Jerusalem at the given UTC instant, in minutes east of
// UTC. Format the instant as IL wall-clock, reinterpret those parts as
// UTC, and take the delta — Intl's tzdb knowledge handles the DST flip
// for us so we never hard-code +120/+180.
function ilOffsetMinutesAt(utcMs: number): number {
  const p = ilDateParts(utcMs);
  const wallUtcMs = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return Math.round((wallUtcMs - utcMs) / MS_PER_MINUTE);
}

// Format a UTC instant as Asia/Jerusalem wall-clock parts. Shared by the
// helpers above; exported so callers that need their own composition
// (e.g. building a derived date key) don't have to re-implement.
export function ilDateParts(utcMs: number): {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
} {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: IL_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]),
  );
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
  };
}
