import { describe, expect, it } from "vitest";
import { formatDateTime } from "./format";

// A real WC2026 Saturday match in Asia/Jerusalem: 2026-06-13 04:00 IL.
const SAT_IL = new Date("2026-06-13T01:00:00Z");
// A Thursday for comparison: 2026-06-11 22:00 IL.
const THU_IL = new Date("2026-06-11T19:00:00Z");

describe("formatDateTime — Hebrew Saturday prefix", () => {
  it("prepends יום to Saturday so all weekdays start the same way", () => {
    const out = formatDateTime(SAT_IL, "he", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    expect(out).toContain("יום שבת");
    expect(out).not.toMatch(/^שבת/);
  });

  it("leaves other weekdays alone (they already have יום)", () => {
    const out = formatDateTime(THU_IL, "he", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    expect(out).toContain("יום");
    // No double-prepending: "יום יום חמישי" would be a bug.
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
});
