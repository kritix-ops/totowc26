import { describe, expect, it } from "vitest";
import {
  HIDEABLE_PAGE_KEYS,
  HIDEABLE_PAGE_LABELS,
  isHideablePageKey,
  NEVER_HIDEABLE,
  validateHiddenKeys,
} from "./page-visibility-catalog";

describe("validateHiddenKeys", () => {
  it("accepts an empty array", () => {
    expect(validateHiddenKeys([])).toEqual([]);
  });

  it("accepts every catalog key", () => {
    const all = [...HIDEABLE_PAGE_KEYS];
    expect(validateHiddenKeys(all)).toEqual(all);
  });

  it("rejects non-arrays", () => {
    expect(validateHiddenKeys(null)).toBeNull();
    expect(validateHiddenKeys("bets")).toBeNull();
    expect(validateHiddenKeys({})).toBeNull();
    expect(validateHiddenKeys(undefined)).toBeNull();
  });

  it("rejects arrays containing non-strings", () => {
    expect(validateHiddenKeys([42])).toBeNull();
    expect(validateHiddenKeys(["bets", null])).toBeNull();
  });

  it("rejects unknown keys (catalog defends the API boundary)", () => {
    expect(validateHiddenKeys(["bets", "admin"])).toBeNull(); // admin is system, never hideable
    expect(validateHiddenKeys(["nonsense"])).toBeNull();
    expect(validateHiddenKeys(["home"])).toBeNull(); // home is the redirect target
  });

  it("de-duplicates while preserving first-seen order", () => {
    expect(validateHiddenKeys(["bets", "duels", "bets"])).toEqual([
      "bets",
      "duels",
    ]);
  });
});

describe("isHideablePageKey", () => {
  it("returns true for every catalog member", () => {
    for (const k of HIDEABLE_PAGE_KEYS) {
      expect(isHideablePageKey(k)).toBe(true);
    }
  });

  it("returns false for system keys (admin / home / profile / login / signup)", () => {
    for (const sys of NEVER_HIDEABLE) {
      expect(isHideablePageKey(sys.key)).toBe(false);
    }
  });

  it("returns false for junk", () => {
    expect(isHideablePageKey(undefined)).toBe(false);
    expect(isHideablePageKey(null)).toBe(false);
    expect(isHideablePageKey(42)).toBe(false);
    expect(isHideablePageKey("random-page")).toBe(false);
  });
});

describe("catalog completeness", () => {
  it("HIDEABLE_PAGE_LABELS has an entry for every key", () => {
    for (const k of HIDEABLE_PAGE_KEYS) {
      expect(HIDEABLE_PAGE_LABELS[k]).toBeDefined();
      expect(HIDEABLE_PAGE_LABELS[k].he).toBeTruthy();
      expect(HIDEABLE_PAGE_LABELS[k].en).toBeTruthy();
      expect(HIDEABLE_PAGE_LABELS[k].pathSegment).toMatch(/^\//);
    }
  });

  it("NEVER_HIDEABLE keys do not collide with the hideable catalog", () => {
    const hideable = new Set<string>(HIDEABLE_PAGE_KEYS);
    for (const sys of NEVER_HIDEABLE) {
      expect(hideable.has(sys.key)).toBe(false);
    }
  });
});
