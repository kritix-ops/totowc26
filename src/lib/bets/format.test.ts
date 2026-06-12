import { describe, expect, it } from "vitest";
import { renderPickAnswer, type PlayerNameMap } from "./format";

// renderPickAnswer is the single source of truth for turning a stored
// custom-bet answer (yes/no, number, multi-choice, free text) into a
// human label. The cases below pin the behaviour each surface relies on
// — the original bug was the profile screen showing raw api_football_id
// (e.g. "386828") instead of the player name, because the dynamic
// player roster carries an empty `options` list and the helper falls
// back to the raw value when no `playerNames` map is supplied.

describe("renderPickAnswer", () => {
  it("renders yes_no answers in the active language", () => {
    expect(
      renderPickAnswer("yes_no", null, { type: "yes_no", value: true }, true),
    ).toBe("כן");
    expect(
      renderPickAnswer("yes_no", null, { type: "yes_no", value: false }, false),
    ).toBe("No");
  });

  it("renders number answers as a string", () => {
    expect(
      renderPickAnswer("number", null, { type: "number", value: 3 }, false),
    ).toBe("3");
  });

  it("resolves a multi_choice value against the option list", () => {
    const cfg = {
      kind: "multi_choice",
      options: [
        { value: "ARG", labelHe: "ארגנטינה", labelEn: "Argentina" },
        { value: "BRA", labelHe: "ברזיל", labelEn: "Brazil" },
      ],
    };
    expect(
      renderPickAnswer(
        "multi_choice",
        cfg,
        { type: "multi_choice", value: "ARG" },
        true,
      ),
    ).toBe("ארגנטינה");
    expect(
      renderPickAnswer(
        "multi_choice",
        cfg,
        { type: "multi_choice", value: "BRA" },
        false,
      ),
    ).toBe("Brazil");
  });

  it("resolves a dynamic-roster (top scorer / golden ball) player id through the player-name map", () => {
    const cfg = {
      kind: "multi_choice",
      dynamicSource: "players",
      options: [],
    };
    const playerNames: PlayerNameMap = new Map([
      ["386828", { he: "ארלינג הולנד", en: "Erling Haaland" }],
      ["278", { he: "ליאו מסי", en: "Lionel Messi" }],
    ]);
    expect(
      renderPickAnswer(
        "multi_choice",
        cfg,
        { type: "multi_choice", value: "386828" },
        true,
        playerNames,
      ),
    ).toBe("ארלינג הולנד");
    expect(
      renderPickAnswer(
        "multi_choice",
        cfg,
        { type: "multi_choice", value: "278" },
        false,
        playerNames,
      ),
    ).toBe("Lionel Messi");
  });

  it("falls back to the raw id when the player-name map is missing", () => {
    const cfg = {
      kind: "multi_choice",
      dynamicSource: "players",
      options: [],
    };
    expect(
      renderPickAnswer(
        "multi_choice",
        cfg,
        { type: "multi_choice", value: "386828" },
        true,
      ),
    ).toBe("386828");
  });

  it("falls back to the raw id when the player is no longer on the roster", () => {
    const cfg = {
      kind: "multi_choice",
      dynamicSource: "players",
      options: [],
    };
    const playerNames: PlayerNameMap = new Map([
      ["278", { he: "ליאו מסי", en: "Lionel Messi" }],
    ]);
    expect(
      renderPickAnswer(
        "multi_choice",
        cfg,
        { type: "multi_choice", value: "999999" },
        true,
        playerNames,
      ),
    ).toBe("999999");
  });

  it("returns — for a null or non-object answer", () => {
    expect(renderPickAnswer("yes_no", null, null, true)).toBe("—");
    expect(renderPickAnswer("yes_no", null, undefined, true)).toBe("—");
  });
});
