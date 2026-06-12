import { describe, expect, it } from "vitest";
import { parseBetsView } from "./BetsSubTabs";

describe("parseBetsView", () => {
  it("defaults to upcoming when the param is absent", () => {
    expect(parseBetsView(undefined)).toBe("upcoming");
  });

  it("returns past only for the exact 'past' value", () => {
    expect(parseBetsView("past")).toBe("past");
    expect(parseBetsView("upcoming")).toBe("upcoming");
    // Anything unexpected falls back to upcoming rather than 404ing the
    // page or rendering a blank surface.
    expect(parseBetsView("PAST")).toBe("upcoming");
    expect(parseBetsView("history")).toBe("upcoming");
    expect(parseBetsView("")).toBe("upcoming");
  });

  it("reads the first value when Next hands an array (?view=past&view=x)", () => {
    expect(parseBetsView(["past", "upcoming"])).toBe("past");
    expect(parseBetsView(["upcoming", "past"])).toBe("upcoming");
    expect(parseBetsView([])).toBe("upcoming");
  });
});
