import { describe, expect, it } from "vitest";
import {
  FREE_PICK_SCOPES,
  isFreePickScope,
  OUTRIGHT_GROUP_CEILING,
  OUTRIGHT_GROUP_FLOOR,
  OUTRIGHT_HOUSE_EDGE_PCT,
  OUTRIGHT_MAX_PAYOUT,
  OUTRIGHT_NOTIONAL_STAKE,
  OUTRIGHT_PLAYER_CEILING,
  OUTRIGHT_PLAYER_FLOOR,
  outrightCurveCeiling,
  outrightCurveFloor,
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

describe("outright curve floor (surface-aware)", () => {
  // The floor was lifted 20 → 35 for tournament surfaces on 2026-07-16 so a
  // whole-tournament favourite pays more than a pittance; group surfaces keep
  // the 20 floor so their tighter 20→50 range does not collapse. See
  // _plans/2026-07-16-raise-tournament-bet-floor-to-35.md. Pinned so a stray
  // edit fails CI.
  it("tournament floor is 35, group floor is 20", () => {
    expect(OUTRIGHT_PLAYER_FLOOR).toBe(35);
    expect(OUTRIGHT_GROUP_FLOOR).toBe(20);
  });

  it("lifts the floor to 35 for player + tournament-wide team surfaces", () => {
    for (const surface of [
      "top_scorer",
      "golden_ball",
      "champion",
      "runner_up",
      "third",
    ]) {
      expect(outrightCurveFloor(surface)).toBe(35);
    }
  });

  it("keeps the floor at 20 for every group surface", () => {
    for (const letter of "ABCDEFGHIJKL") {
      expect(outrightCurveFloor(`group_${letter}`)).toBe(20);
    }
  });

  it("keeps floor strictly below ceiling on every surface", () => {
    for (const surface of ["champion", "top_scorer", "group_A", "group_L"]) {
      expect(outrightCurveFloor(surface)).toBeLessThan(
        outrightCurveCeiling(surface),
      );
    }
  });

  it("leaves the ceilings unchanged (100 outright, 50 group)", () => {
    expect(outrightCurveCeiling("champion")).toBe(OUTRIGHT_PLAYER_CEILING);
    expect(outrightCurveCeiling("group_A")).toBe(OUTRIGHT_GROUP_CEILING);
    expect(OUTRIGHT_PLAYER_CEILING).toBe(100);
    expect(OUTRIGHT_GROUP_CEILING).toBe(50);
  });
});
