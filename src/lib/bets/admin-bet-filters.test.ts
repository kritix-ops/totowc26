import { describe, expect, it } from "vitest";
import {
  BETS_FILTER_KEYS,
  parseDayFilter,
  sanitizeReturnQuery,
} from "./admin-bet-filters";

describe("parseDayFilter", () => {
  it("accepts a well-formed YYYY-MM-DD", () => {
    expect(parseDayFilter("2026-06-24")).toBe("2026-06-24");
    expect(parseDayFilter(" 2026-06-24 ")).toBe("2026-06-24"); // trims
  });

  it("rejects the wrong shape", () => {
    expect(parseDayFilter("2026-6-24")).toBeNull(); // unpadded
    expect(parseDayFilter("24-06-2026")).toBeNull();
    expect(parseDayFilter("2026/06/24")).toBeNull();
    expect(parseDayFilter("2026-06-24T00:00")).toBeNull();
    expect(parseDayFilter("not-a-date")).toBeNull();
    expect(parseDayFilter("")).toBeNull();
  });

  it("rejects impossible calendar dates that pass the regex", () => {
    // Date() would normalise these to a different real day; we want them
    // to fall through to "no filter" rather than silently shift.
    expect(parseDayFilter("2026-13-01")).toBeNull(); // month 13
    expect(parseDayFilter("2026-02-30")).toBeNull(); // Feb 30 → Mar 02
    expect(parseDayFilter("2026-00-10")).toBeNull(); // month 0
  });

  it("handles array and undefined inputs", () => {
    expect(parseDayFilter(["2026-06-24", "x"])).toBe("2026-06-24");
    expect(parseDayFilter(undefined)).toBeNull();
    expect(parseDayFilter([])).toBeNull();
  });
});

describe("sanitizeReturnQuery", () => {
  it("keeps only whitelisted filter keys", () => {
    const out = sanitizeReturnQuery(
      "type=live&status=open&scope=match&match=abc&day=2026-06-24&q=goal",
    );
    const params = new URLSearchParams(out);
    expect(params.get("type")).toBe("live");
    expect(params.get("status")).toBe("open");
    expect(params.get("scope")).toBe("match");
    expect(params.get("match")).toBe("abc");
    expect(params.get("day")).toBe("2026-06-24");
    expect(params.get("q")).toBe("goal");
  });

  it("drops unknown / injected keys", () => {
    const out = sanitizeReturnQuery(
      "status=open&redirect=https://evil.example&__proto__=x&admin=1",
    );
    const params = new URLSearchParams(out);
    expect(params.get("status")).toBe("open");
    expect(params.has("redirect")).toBe(false);
    expect(params.has("__proto__")).toBe(false);
    expect(params.has("admin")).toBe(false);
  });

  it("tolerates a leading ? and empty / non-string input", () => {
    expect(sanitizeReturnQuery("?status=open")).toBe("status=open");
    expect(sanitizeReturnQuery("")).toBe("");
    expect(sanitizeReturnQuery(undefined)).toBe("");
    expect(sanitizeReturnQuery(["status=open", "x"])).toBe("status=open");
  });

  it("caps an over-long value instead of reflecting it whole", () => {
    const long = "a".repeat(500);
    const out = sanitizeReturnQuery(`q=${long}`);
    expect(new URLSearchParams(out).get("q")!.length).toBe(100);
  });

  it("never emits a path — a glued-in path fragment is dropped whole", () => {
    // URLSearchParams folds "/admin/secret?status" into one (non-whitelisted)
    // key, so nothing survives and the caller appends an empty query to the
    // fixed /admin/bets href. No redirect is possible.
    expect(sanitizeReturnQuery("/admin/secret?status=open")).toBe("");
  });
});

describe("BETS_FILTER_KEYS", () => {
  it("is the agreed filter vocabulary", () => {
    expect([...BETS_FILTER_KEYS]).toEqual([
      "type",
      "status",
      "scope",
      "match",
      "day",
      "q",
    ]);
  });
});
