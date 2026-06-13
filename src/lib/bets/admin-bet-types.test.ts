import { describe, expect, it } from "vitest";
import {
  BET_TYPES,
  betTypeLabel,
  duelScopeLabel,
  duelStatusLabel,
  duelStatusTone,
  parseBetType,
  scopeBelongsToType,
  scopesForBetType,
} from "./admin-bet-types";

describe("parseBetType", () => {
  it("accepts each valid bet type", () => {
    for (const t of BET_TYPES) {
      expect(parseBetType(t)).toBe(t);
    }
  });

  it("returns null for absent or garbage input", () => {
    expect(parseBetType(undefined)).toBeNull();
    expect(parseBetType("")).toBeNull();
    expect(parseBetType("1x2")).toBeNull();
    expect(parseBetType("DUEL")).toBeNull(); // case-sensitive on purpose
  });

  it("takes the first entry when the param is an array", () => {
    expect(parseBetType(["duel", "live"])).toBe("duel");
    expect(parseBetType(["junk"])).toBeNull();
  });
});

describe("scopesForBetType", () => {
  it("maps live to match + day", () => {
    expect(scopesForBetType("live")).toEqual(["match", "day"]);
  });

  it("maps tournament to stage + group + tournament", () => {
    expect(scopesForBetType("tournament")).toEqual([
      "stage",
      "group",
      "tournament",
    ]);
  });

  it("covers every custom-bet scope exactly once across the two families", () => {
    const all = [...scopesForBetType("live"), ...scopesForBetType("tournament")];
    expect(new Set(all).size).toBe(all.length);
    expect(all.sort()).toEqual(
      ["day", "group", "match", "stage", "tournament"].sort(),
    );
  });
});

describe("scopeBelongsToType", () => {
  it("keeps in-family scopes and rejects out-of-family ones", () => {
    expect(scopeBelongsToType("live", "match")).toBe(true);
    expect(scopeBelongsToType("live", "group")).toBe(false);
    expect(scopeBelongsToType("tournament", "stage")).toBe(true);
    expect(scopeBelongsToType("tournament", "day")).toBe(false);
  });
});

describe("label maps", () => {
  it("returns Hebrew and English for bet types", () => {
    expect(betTypeLabel("duel", true)).toBe("דו-קרב");
    expect(betTypeLabel("duel", false)).toBe("Duel");
    expect(betTypeLabel("live", true)).toBe("לייב");
  });

  it("returns Hebrew and English for duel statuses", () => {
    expect(duelStatusLabel("matched", true)).toBe("שובץ");
    expect(duelStatusLabel("matched", false)).toBe("Matched");
    expect(duelStatusLabel("settled", true)).toBe("הוכרע");
  });

  it("returns Hebrew and English for duel scopes", () => {
    expect(duelScopeLabel("day", true)).toBe("יום");
    expect(duelScopeLabel("day", false)).toBe("Day");
  });
});

describe("duelStatusTone", () => {
  it("matches the public duels colour language", () => {
    expect(duelStatusTone("open")).toBe("primary");
    expect(duelStatusTone("matched")).toBe("default");
    expect(duelStatusTone("settled")).toBe("secondary");
    expect(duelStatusTone("cancelled")).toBe("warning");
  });
});
