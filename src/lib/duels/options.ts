// Pure helpers for custom-option duels (migration 0058).
//
// Why this exists: the duel server actions, the new-duel form, the duel
// detail page, the bank.ts SQL, and the API-Football quick-template
// module all need the same arithmetic for "what does option X pay?" and
// "is this a valid options array?". Centralising it here keeps the
// payout math in one place so the SQL fragment in bank.ts and the JS
// preview in the form can't drift.
//
// Multipliers travel as integer hundredths (1.5x = 150) end-to-end:
// jsonb storage, SQL CASE, server actions, client preview. Float math
// happens only at the UI presentation layer (`formatMultiplier`).

export const OPTION_MIN_COUNT = 2;
export const OPTION_MAX_COUNT = 5;
export const MULTIPLIER_MIN_PCT = 150; // 1.5x
export const MULTIPLIER_MAX_PCT = 500; // 5.0x

export type DuelOption = {
  // Stable key written into opener_option / joiner_option / resolved_option.
  // No whitespace, no commas - safe to compare with `=`.
  key: string;
  labelHe: string;
  labelEn: string;
  // Integer hundredths. 200 = 2.0x return on a winning pick.
  multiplierPct: number;
};

export type DuelOptionsValidation =
  | { ok: true; options: DuelOption[] }
  | {
      ok: false;
      error:
        | "too_few"
        | "too_many"
        | "duplicate_key"
        | "invalid_key"
        | "empty_label"
        | "label_too_long"
        | "multiplier_out_of_range";
    };

const KEY_RE = /^[a-z0-9_-]{1,32}$/i;
const LABEL_MAX = 40;

// Validate a raw options array (from a form payload). Returns the
// normalised list on success. Server-side guard against tampered
// clients and the DB CHECK twin.
export function validateOptions(raw: unknown): DuelOptionsValidation {
  if (!Array.isArray(raw)) return { ok: false, error: "too_few" };
  if (raw.length < OPTION_MIN_COUNT) return { ok: false, error: "too_few" };
  if (raw.length > OPTION_MAX_COUNT) return { ok: false, error: "too_many" };

  const seenKeys = new Set<string>();
  const out: DuelOption[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      return { ok: false, error: "invalid_key" };
    }
    const o = item as Partial<DuelOption>;
    if (typeof o.key !== "string" || !KEY_RE.test(o.key)) {
      return { ok: false, error: "invalid_key" };
    }
    if (seenKeys.has(o.key)) return { ok: false, error: "duplicate_key" };
    seenKeys.add(o.key);
    const labelHe = typeof o.labelHe === "string" ? o.labelHe.trim() : "";
    const labelEn = typeof o.labelEn === "string" ? o.labelEn.trim() : "";
    if (labelHe.length === 0 || labelEn.length === 0) {
      return { ok: false, error: "empty_label" };
    }
    if (labelHe.length > LABEL_MAX || labelEn.length > LABEL_MAX) {
      return { ok: false, error: "label_too_long" };
    }
    const m = Number(o.multiplierPct);
    if (
      !Number.isFinite(m) ||
      !Number.isInteger(m) ||
      m < MULTIPLIER_MIN_PCT ||
      m > MULTIPLIER_MAX_PCT
    ) {
      return { ok: false, error: "multiplier_out_of_range" };
    }
    out.push({ key: o.key, labelHe, labelEn, multiplierPct: m });
  }
  return { ok: true, options: out };
}

// Find a single option by key. Returns null if absent.
export function findOption(
  options: DuelOption[] | null | undefined,
  key: string | null | undefined,
): DuelOption | null {
  if (!options || !key) return null;
  return options.find((o) => o.key === key) ?? null;
}

// Net point delta for a single duel side under the new-style options model.
//
// Inputs:
//   stake               - the per-side stake (both sides paid the same)
//   pickedKey           - which option this side picked
//   resolvedKey         - which option won (null if not yet settled)
//   pickedMultiplierPct - the multiplier snapshotted onto the row for this
//                         side when they entered the duel
//
// Returns:
//   * not yet settled (resolvedKey null): -stake (in-flight debit)
//   * picked = resolved: +stake * (multiplierPct - 100) / 100  (net profit)
//   * picked != resolved: -stake (stake forfeited)
//
// Mirrors the SQL CASE in src/lib/bank.ts:duelCaseSql. Tests assert the
// matrix matches exactly.
export function resolveOptionDuelSideDelta(args: {
  stake: number;
  pickedKey: string | null;
  resolvedKey: string | null;
  pickedMultiplierPct: number | null;
}): number {
  if (args.resolvedKey == null) return -args.stake; // open/matched
  if (args.pickedKey == null || args.pickedMultiplierPct == null) {
    // No pick on this side at settle time - should be unreachable
    // because settleDuel rejects without a joiner_option, but fall
    // through safely.
    return -args.stake;
  }
  if (args.pickedKey === args.resolvedKey) {
    return Math.trunc((args.stake * (args.pickedMultiplierPct - 100)) / 100);
  }
  return -args.stake;
}

// Format a multiplierPct for UI display. 200 -> "2.0x".
export function formatMultiplier(pct: number, locale: "he" | "en"): string {
  const v = (pct / 100).toFixed(pct % 10 === 0 ? 1 : 2);
  return locale === "he" ? `×${v}` : `${v}x`;
}

// Compute the gross payout (stake + profit) a side WOULD see on win.
// Used in the bet card / picker scenarios so the opener and joiner can
// preview "if this wins, you get N points".
export function grossPayoutOnWin(stake: number, multiplierPct: number): number {
  return Math.trunc((stake * multiplierPct) / 100);
}
