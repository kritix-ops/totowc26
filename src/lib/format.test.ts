import { describe, expect, it } from "vitest";
import { formatDateTime } from "./format";

// A real WC2026 Saturday match in Asia/Jerusalem: 2026-06-13 04:00 IL.
const SAT_IL = new Date("2026-06-13T01:00:00Z");
// A Thursday for comparison: 2026-06-11 22:00 IL.
const THU_IL = new Date("2026-06-11T19:00:00Z");

describe("formatDateTime — Hebrew Saturday prefix", () => {
  it("yields exactly one יום שבת for Saturday with weekday=long", () => {
    const out = formatDateTime(SAT_IL, "he", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    expect(out).toContain("יום שבת");
    expect(out).not.toMatch(/^שבת/);
    // The 2026-06-05 13:05 QA run caught this exact regression
    // because the regex previously fired on "יום שבת" too: ICU
    // ships "יום שבת" for weekday=long, the old regex added
    // another "יום ", producing "יום יום שבת". Guard against the
    // double prefix explicitly.
    expect(out).not.toContain("יום יום");
  });

  it("prepends יום to bare שבת produced by weekday=short", () => {
    const out = formatDateTime(SAT_IL, "he", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
    expect(out).toContain("יום שבת");
    expect(out).not.toMatch(/^שבת/);
    expect(out).not.toContain("יום יום");
  });

  it("leaves other weekdays alone (they already have יום)", () => {
    const out = formatDateTime(THU_IL, "he", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    expect(out).toContain("יום");
    expect(out).not.toContain("יום יום");
  });

  it("does not touch English locale output", () => {
    const out = formatDateTime(SAT_IL, "en", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    expect(out).toContain("Saturday");
    expect(out).not.toContain("יום");
  });

  it("does not prepend when weekday option is absent", () => {
    const out = formatDateTime(SAT_IL, "he", {
      day: "numeric",
      month: "long",
    });
    expect(out).not.toContain("יום שבת");
  });

  it("is idempotent on its own output", () => {
    const once = formatDateTime(SAT_IL, "he", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    // Running the post-process step on already-fixed output must
    // not add another "יום ". This protects against future ICU
    // changes that might flip what bare "שבת" vs "יום שבת" looks
    // like in different formats.
    const twice = once.replace(/(^|[\s,])(?<!יום )שבת(?=[,\s]|$)/gu, "$1יום שבת");
    expect(twice).toBe(once);
  });
});

describe("formatDateTime — invalid input guard", () => {
  // Intl.DateTimeFormat.format() throws RangeError on a NaN date. Because
  // this helper renders inside server components on every list page, an
  // unhandled throw 500s the whole page. The guard must degrade to a
  // dash instead. These cover every way a bad value can reach the parse.
  const opts: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  };

  it("returns an em-dash for an unparseable string instead of throwing", () => {
    expect(() => formatDateTime("not-a-date", "he", opts)).not.toThrow();
    expect(formatDateTime("not-a-date", "he", opts)).toBe("—");
  });

  it("returns an em-dash for an empty string", () => {
    expect(formatDateTime("", "en", opts)).toBe("—");
  });

  it("returns an em-dash for an Invalid Date object", () => {
    expect(formatDateTime(new Date("nope"), "en", opts)).toBe("—");
  });

  it("returns an em-dash for NaN", () => {
    expect(formatDateTime(Number.NaN, "he", opts)).toBe("—");
  });

  it("still formats a Postgres text timestamp (space separator, +00)", () => {
    // The transparency feed casts timestamptz to ::text, producing
    // "2026-06-11 22:00:00+00" (space, not ISO 'T'). V8 parses it; the
    // guard must NOT swallow a valid value.
    const out = formatDateTime("2026-06-11 19:00:00+00", "en", opts);
    expect(out).not.toBe("—");
    expect(out).toMatch(/\d/);
  });
});
