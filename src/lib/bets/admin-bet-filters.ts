// Pure filter-param helpers for the /admin/bets management surface.
//
// These are extracted from the page component so they can be unit-tested
// without rendering React: the matchday-date parser the live-bets quick
// filter relies on, and the "return to the list with my filters intact"
// query sanitiser the bet round-trip relies on. Keeping them pure also
// keeps the server component readable.

// The filter dimensions allowed to survive a detail round-trip. Anything
// outside this set (a path fragment, a stray param) is dropped, so the
// reflected `return` value can only ever rebuild the bets-list query —
// never a different route or an injected param.
export const BETS_FILTER_KEYS = [
  "type",
  "status",
  "scope",
  "match",
  "day",
  "q",
] as const;

// localStorage key the admin bets list uses to remember the last filter
// query string across fresh visits. Versioned so the shape can change
// without reading a stale value. Shared by the memory + clear islands.
export const BETS_FILTER_STORAGE_KEY = "admin-bets-filters-v1";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// Strict YYYY-MM-DD matchday filter. Rejects junk and impossible calendar
// dates (e.g. 2026-13-40) so a hand-edited or stale URL falls through to
// "no day filter" instead of throwing on the ::date cast in SQL.
export function parseDayFilter(
  raw: string | string[] | undefined,
): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (!DAY_RE.test(trimmed)) return null;
  const d = new Date(`${trimmed}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  // Date() normalises overflow (2026-02-30 → 2026-03-02); compare back so
  // those slip through as "no filter" rather than a silently-shifted day.
  return d.toISOString().slice(0, 10) === trimmed ? trimmed : null;
}

// Turn a reflected `?return=` value back into a safe bets-list query
// string. The value arrives already URL-decoded by Next, so we parse it,
// keep only whitelisted filter keys, cap each value, and re-encode. The
// result never carries a path or an unknown key, so the caller can append
// it to a fixed /admin/bets href without an open-redirect or injection.
export function sanitizeReturnQuery(
  raw: string | string[] | undefined,
): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== "string" || v === "") return "";
  const source = v.startsWith("?") ? v.slice(1) : v;
  let parsed: URLSearchParams;
  try {
    parsed = new URLSearchParams(source);
  } catch {
    return "";
  }
  const out = new URLSearchParams();
  for (const key of BETS_FILTER_KEYS) {
    const val = parsed.get(key);
    if (val != null && val !== "") out.set(key, val.slice(0, 100));
  }
  return out.toString();
}
