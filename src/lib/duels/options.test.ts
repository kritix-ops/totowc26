import { describe, expect, it } from "vitest";
import {
  findOption,
  formatMultiplier,
  grossPayoutOnWin,
  MULTIPLIER_MAX_PCT,
  MULTIPLIER_MIN_PCT,
  OPTION_MAX_COUNT,
  OPTION_MIN_COUNT,
  resolveOptionDuelSideDelta,
  validateOptions,
  type DuelOption,
} from "./options";

const sample = (over?: Partial<DuelOption>[]): DuelOption[] => {
  const base: DuelOption[] = [
    { key: "yes", labelHe: "כן", labelEn: "Yes", multiplierPct: 200 },
    { key: "no", labelHe: "לא", labelEn: "No", multiplierPct: 200 },
  ];
  if (over) {
    for (let i = 0; i < over.length; i++) {
      base[i] = { ...base[i], ...over[i] };
    }
  }
  return base;
};

describe("validateOptions", () => {
  it("accepts a clean 2-option array", () => {
    const r = validateOptions(sample());
    expect(r.ok).toBe(true);
  });

  it("rejects below minimum", () => {
    const r = validateOptions([
      { key: "yes", labelHe: "כן", labelEn: "Yes", multiplierPct: 200 },
    ]);
    expect(r).toEqual({ ok: false, error: "too_few" });
  });

  it("rejects above maximum", () => {
    const arr = Array.from({ length: OPTION_MAX_COUNT + 1 }, (_, i) => ({
      key: `opt${i}`,
      labelHe: `אופציה ${i}`,
      labelEn: `Option ${i}`,
      multiplierPct: 200,
    }));
    const r = validateOptions(arr);
    expect(r).toEqual({ ok: false, error: "too_many" });
  });

  it("rejects duplicate keys", () => {
    const r = validateOptions([
      { key: "yes", labelHe: "כן", labelEn: "Yes", multiplierPct: 200 },
      { key: "yes", labelHe: "Y2", labelEn: "Y2", multiplierPct: 200 },
    ]);
    expect(r).toEqual({ ok: false, error: "duplicate_key" });
  });

  it("rejects invalid key characters", () => {
    const r = validateOptions([
      { key: "yes!", labelHe: "כן", labelEn: "Yes", multiplierPct: 200 },
      { key: "no", labelHe: "לא", labelEn: "No", multiplierPct: 200 },
    ]);
    expect(r).toEqual({ ok: false, error: "invalid_key" });
  });

  it("rejects empty Hebrew label", () => {
    const r = validateOptions([
      { key: "yes", labelHe: "  ", labelEn: "Yes", multiplierPct: 200 },
      { key: "no", labelHe: "לא", labelEn: "No", multiplierPct: 200 },
    ]);
    expect(r).toEqual({ ok: false, error: "empty_label" });
  });

  it("rejects multiplier below floor", () => {
    const r = validateOptions([
      { key: "yes", labelHe: "כן", labelEn: "Yes", multiplierPct: MULTIPLIER_MIN_PCT - 1 },
      { key: "no", labelHe: "לא", labelEn: "No", multiplierPct: 200 },
    ]);
    expect(r).toEqual({ ok: false, error: "multiplier_out_of_range" });
  });

  it("rejects multiplier above ceiling", () => {
    const r = validateOptions([
      { key: "yes", labelHe: "כן", labelEn: "Yes", multiplierPct: MULTIPLIER_MAX_PCT + 1 },
      { key: "no", labelHe: "לא", labelEn: "No", multiplierPct: 200 },
    ]);
    expect(r).toEqual({ ok: false, error: "multiplier_out_of_range" });
  });

  it("trims label whitespace", () => {
    const r = validateOptions([
      { key: "yes", labelHe: " כן ", labelEn: " Yes ", multiplierPct: 200 },
      { key: "no", labelHe: "לא", labelEn: "No", multiplierPct: 200 },
    ]);
    if (!r.ok) throw new Error("expected ok");
    expect(r.options[0]).toEqual({
      key: "yes",
      labelHe: "כן",
      labelEn: "Yes",
      multiplierPct: 200,
    });
  });

  it("accepts the minimum count", () => {
    const arr = Array.from({ length: OPTION_MIN_COUNT }, (_, i) => ({
      key: `opt${i}`,
      labelHe: `אופציה ${i}`,
      labelEn: `Option ${i}`,
      multiplierPct: 200,
    }));
    const r = validateOptions(arr);
    expect(r.ok).toBe(true);
  });
});

describe("findOption", () => {
  it("returns the matching option", () => {
    const found = findOption(sample(), "yes");
    expect(found?.labelHe).toBe("כן");
  });
  it("returns null on miss", () => {
    expect(findOption(sample(), "maybe")).toBeNull();
  });
  it("returns null on null inputs", () => {
    expect(findOption(null, "yes")).toBeNull();
    expect(findOption(sample(), null)).toBeNull();
  });
});

describe("resolveOptionDuelSideDelta", () => {
  it("returns -stake while unresolved (open/matched)", () => {
    expect(
      resolveOptionDuelSideDelta({
        stake: 5,
        pickedKey: "yes",
        resolvedKey: null,
        pickedMultiplierPct: 200,
      }),
    ).toBe(-5);
  });

  it("winner with 2.0x gets +stake net profit", () => {
    // stake=5, picked matches resolved, multiplier=200 -> +5*(200-100)/100=+5
    expect(
      resolveOptionDuelSideDelta({
        stake: 5,
        pickedKey: "yes",
        resolvedKey: "yes",
        pickedMultiplierPct: 200,
      }),
    ).toBe(5);
  });

  it("winner with 3.0x gets +2*stake net profit", () => {
    expect(
      resolveOptionDuelSideDelta({
        stake: 5,
        pickedKey: "yes",
        resolvedKey: "yes",
        pickedMultiplierPct: 300,
      }),
    ).toBe(10);
  });

  it("winner with 1.5x gets +stake/2 net profit (truncated)", () => {
    // stake=5, multiplier=150 -> 5*50/100 = 2.5 -> 2 (trunc)
    expect(
      resolveOptionDuelSideDelta({
        stake: 5,
        pickedKey: "yes",
        resolvedKey: "yes",
        pickedMultiplierPct: 150,
      }),
    ).toBe(2);
  });

  it("loser gets -stake", () => {
    expect(
      resolveOptionDuelSideDelta({
        stake: 5,
        pickedKey: "yes",
        resolvedKey: "no",
        pickedMultiplierPct: 200,
      }),
    ).toBe(-5);
  });

  it("missing pick on settle falls back to -stake", () => {
    expect(
      resolveOptionDuelSideDelta({
        stake: 5,
        pickedKey: null,
        resolvedKey: "yes",
        pickedMultiplierPct: null,
      }),
    ).toBe(-5);
  });
});

describe("formatMultiplier", () => {
  it("renders integers cleanly", () => {
    expect(formatMultiplier(200, "en")).toBe("2.0x");
    expect(formatMultiplier(200, "he")).toBe("×2.0");
  });
  it("renders fractional values", () => {
    expect(formatMultiplier(175, "en")).toBe("1.75x");
    expect(formatMultiplier(175, "he")).toBe("×1.75");
  });
});

describe("grossPayoutOnWin", () => {
  it("returns total payout including stake", () => {
    expect(grossPayoutOnWin(5, 200)).toBe(10);
    expect(grossPayoutOnWin(5, 250)).toBe(12); // 12.5 truncated
    expect(grossPayoutOnWin(3, 150)).toBe(4); // 4.5 truncated
  });
});

describe("multiplier cap (3.0x)", () => {
  // The cap is a product rule, not an arbitrary constant. Pin it so a
  // future change is deliberate and forces an update to the UI choices,
  // dictionary copy, and DB-backstop note alongside it.
  it("caps the multiplier ceiling at 3.0x", () => {
    expect(MULTIPLIER_MAX_PCT).toBe(300);
  });

  it("accepts exactly 3.0x", () => {
    const r = validateOptions(sample([{ multiplierPct: 300 }]));
    expect(r.ok).toBe(true);
  });

  it("rejects 3.25x (allowed under the old 5.0x cap)", () => {
    const r = validateOptions(sample([{ multiplierPct: 325 }]));
    expect(r).toEqual({ ok: false, error: "multiplier_out_of_range" });
  });
});
