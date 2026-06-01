import { describe, expect, it } from "vitest";
import {
  FREE_PICK_SCOPES,
  isFreePickScope,
  OUTRIGHT_HOUSE_EDGE_PCT,
  OUTRIGHT_MAX_PAYOUT,
  OUTRIGHT_NOTIONAL_STAKE,
} from "./free-pick-scopes";

describe("isFreePickScope", () => {
  it("recognises tournament / stage / group as free", () => {
    expect(isFreePickScope("tournament")).toBe(true);
    expect(isFreePickScope("stage")).toBe(true);
    expect(isFreePickScope("group")).toBe(true);
  });

  it("rejects match / day (live bets — keep the stake)", () => {
    expect(isFreePickScope("match")).toBe(false);
    expect(isFreePickScope("day")).toBe(false);
  });

  it("rejects unknown scope strings", () => {
    expect(isFreePickScope("")).toBe(false);
    expect(isFreePickScope("Tournament")).toBe(false); // case-sensitive on purpose
    expect(isFreePickScope("other")).toBe(false);
  });
});

describe("FREE_PICK_SCOPES catalogue", () => {
  it("is exactly the three scopes the plan defines", () => {
    expect([...FREE_PICK_SCOPES]).toEqual(["tournament", "stage", "group"]);
  });
});

describe("outright payout constants", () => {
  // These are the contract the migration + publish flow + tests depend
  // on. Changing them is a deliberate policy shift, not a refactor —
  // the test pins them so a stray edit fails CI.
  it("notional unit is 1", () => {
    expect(OUTRIGHT_NOTIONAL_STAKE).toBe(1);
  });
  it("cap matches settings.liveOddsMaxPayout default (25)", () => {
    expect(OUTRIGHT_MAX_PAYOUT).toBe(25);
  });
  it("house edge is 5 %", () => {
    expect(OUTRIGHT_HOUSE_EDGE_PCT).toBe(5);
  });
});
