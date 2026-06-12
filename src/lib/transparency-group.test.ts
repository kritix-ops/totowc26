import { describe, expect, it } from "vitest";
import {
  attachNonBettors,
  filterRowsByQuery,
  filterToUser,
  groupPickerRows,
  type TransparencyPickerRow,
  type TransparencyQuestionRow,
} from "./transparency-group";

// Tiny row factory so each test reads as "this user picked X on this
// question" instead of a wall of property assignments. Keeps the test
// bodies focused on the assertion they care about.
function row(
  questionId: string,
  userId: string,
  overrides: Partial<TransparencyPickerRow> = {},
): TransparencyPickerRow {
  return {
    questionId,
    question: `Q-${questionId}`,
    eventTime: "2026-06-13T18:00:00Z",
    userId,
    displayName: `User ${userId}`,
    pickLabel: "Yes",
    stake: 0,
    pointsEarned: null,
    status: "open",
    ...overrides,
  };
}

describe("groupPickerRows", () => {
  it("folds picks for the same question into one row", () => {
    const out = groupPickerRows([
      row("q1", "u1", { pickLabel: "2-1" }),
      row("q1", "u2", { pickLabel: "1-1" }),
      row("q1", "u3", { pickLabel: "0-0" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].questionId).toBe("q1");
    expect(out[0].pickers.map((p) => p.pickLabel)).toEqual(["2-1", "1-1", "0-0"]);
    expect(out[0].nonBettors).toEqual([]);
  });

  it("preserves SQL insertion order across questions", () => {
    // The DB orders by event_time DESC; the page renders that order
    // directly, so this contract must hold or the page would silently
    // re-order matches by question_id alphabetical.
    const out = groupPickerRows([
      row("q-newest", "u1"),
      row("q-mid",    "u1"),
      row("q-mid",    "u2"),
      row("q-oldest", "u1"),
    ]);
    expect(out.map((r) => r.questionId)).toEqual(["q-newest", "q-mid", "q-oldest"]);
  });

  it("returns an empty list when there are no picker rows", () => {
    expect(groupPickerRows([])).toEqual([]);
  });

  it("does not drop picks from the same user on different questions", () => {
    const out = groupPickerRows([
      row("q1", "u1"),
      row("q2", "u1"),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].pickers).toHaveLength(1);
    expect(out[1].pickers).toHaveLength(1);
  });
});

describe("attachNonBettors", () => {
  const pool = [
    { userId: "u1", displayName: "Alice" },
    { userId: "u2", displayName: "Bob" },
    { userId: "u3", displayName: "Carol" },
    { userId: "u4", displayName: "Dan" },
  ];

  it("lists the paid pool minus current pickers", () => {
    const rows: TransparencyQuestionRow[] = [
      {
        questionId: "q1",
        question: "Q1",
        eventTime: "2026-06-13T18:00:00Z",
        pickers: [
          { userId: "u1", displayName: "Alice", pickLabel: "Yes", stake: 0, pointsEarned: null, status: "open" },
          { userId: "u2", displayName: "Bob",   pickLabel: "No",  stake: 0, pointsEarned: null, status: "open" },
        ],
        nonBettors: [],
      },
    ];
    attachNonBettors(rows, pool);
    expect(rows[0].nonBettors.map((nb) => nb.userId)).toEqual(["u3", "u4"]);
  });

  it("returns an empty non-bettor list when the whole pool bet", () => {
    const rows: TransparencyQuestionRow[] = [
      {
        questionId: "q1",
        question: "Q1",
        eventTime: "2026-06-13T18:00:00Z",
        pickers: pool.map((u) => ({
          userId: u.userId,
          displayName: u.displayName,
          pickLabel: "Yes",
          stake: 0,
          pointsEarned: null,
          status: "open",
        })),
        nonBettors: [],
      },
    ];
    attachNonBettors(rows, pool);
    expect(rows[0].nonBettors).toEqual([]);
  });

  it("returns the full pool as non-bettors when no one bet", () => {
    // Defensive sanity check — should never happen in practice since
    // grouping drops empty rows, but make sure the helper does not
    // silently include pickers in the non-bettor set.
    const rows: TransparencyQuestionRow[] = [
      {
        questionId: "q1",
        question: "Q1",
        eventTime: "2026-06-13T18:00:00Z",
        pickers: [],
        nonBettors: [],
      },
    ];
    attachNonBettors(rows, pool);
    expect(rows[0].nonBettors.map((nb) => nb.userId)).toEqual(["u1", "u2", "u3", "u4"]);
  });
});

describe("filterToUser", () => {
  function questionWith(picks: Array<{ userId: string; label: string }>): TransparencyQuestionRow {
    return {
      questionId: `q-${picks.map((p) => p.userId).join("-")}`,
      question: "Q",
      eventTime: "2026-06-13T18:00:00Z",
      pickers: picks.map((p) => ({
        userId: p.userId,
        displayName: `User ${p.userId}`,
        pickLabel: p.label,
        stake: 0,
        pointsEarned: null,
        status: "open",
      })),
      nonBettors: [
        { userId: "u-non1", displayName: "Non 1" },
        { userId: "u-non2", displayName: "Non 2" },
      ],
    };
  }

  it("keeps only questions where the target user bet", () => {
    const rows = [
      questionWith([{ userId: "u1", label: "Yes" }, { userId: "u2", label: "No" }]),
      questionWith([{ userId: "u2", label: "Yes" }]), // no u1
      questionWith([{ userId: "u1", label: "No" }]),
    ];
    const filtered = filterToUser(rows, "u1");
    expect(filtered).toHaveLength(2);
    expect(filtered[0].pickers.map((p) => p.userId)).toEqual(["u1"]);
    expect(filtered[1].pickers.map((p) => p.userId)).toEqual(["u1"]);
  });

  it("clears the non-bettor list when scoping to one user", () => {
    // The "+N didn't bet" affordance is for a pool-wide view; it
    // makes no sense for a single-user filter so the page must not
    // render it.
    const rows = [questionWith([{ userId: "u1", label: "Yes" }])];
    const filtered = filterToUser(rows, "u1");
    expect(filtered[0].nonBettors).toEqual([]);
  });

  it("returns no rows when the user did not bet anywhere", () => {
    const rows = [
      questionWith([{ userId: "u2", label: "Yes" }]),
      questionWith([{ userId: "u3", label: "No" }]),
    ];
    expect(filterToUser(rows, "u1")).toEqual([]);
  });
});

describe("filterRowsByQuery", () => {
  function q(
    question: string,
    pickerNames: string[],
  ): TransparencyQuestionRow {
    return {
      questionId: `q-${question}`,
      question,
      eventTime: "2026-06-13T18:00:00Z",
      pickers: pickerNames.map((name, i) => ({
        userId: `u-${name}-${i}`,
        displayName: name,
        pickLabel: "1-0",
        stake: 0,
        pointsEarned: null,
        status: "open",
      })),
      nonBettors: [{ userId: "nb1", displayName: "Someone Else" }],
    };
  }

  const rows = [
    q("מקסיקו vs דרום אפריקה", ["אוהד ניסן", "carozyotam", "אילן מזרחי"]),
    q("ארגנטינה vs ברזיל", ["יואב מזרחי", "Or Lederman"]),
  ];

  it("returns all rows untouched for an empty/whitespace query", () => {
    expect(filterRowsByQuery(rows, "")).toBe(rows);
    expect(filterRowsByQuery(rows, "   ")).toBe(rows);
  });

  it("keeps the whole card when the QUESTION matches", () => {
    const out = filterRowsByQuery(rows, "מקסיקו");
    expect(out).toHaveLength(1);
    // Question match → every picker stays, nonBettors preserved.
    expect(out[0].pickers).toHaveLength(3);
    expect(out[0].nonBettors).toHaveLength(1);
  });

  it("narrows to only the matching picker rows on a name search", () => {
    // This is the bug the redesign fixes: searching "אוהד" must collapse
    // the card to Ohad's single row, not show the whole roster.
    const out = filterRowsByQuery(rows, "אוהד");
    expect(out).toHaveLength(1);
    expect(out[0].pickers.map((p) => p.displayName)).toEqual(["אוהד ניסן"]);
    // Non-bettor list is dropped once narrowed to a person.
    expect(out[0].nonBettors).toEqual([]);
  });

  it("matches a name across multiple cards and keeps each card's matches", () => {
    const out = filterRowsByQuery(rows, "מזרחי");
    expect(out).toHaveLength(2);
    expect(out[0].pickers.map((p) => p.displayName)).toEqual(["אילן מזרחי"]);
    expect(out[1].pickers.map((p) => p.displayName)).toEqual(["יואב מזרחי"]);
  });

  it("is case-insensitive", () => {
    const out = filterRowsByQuery(rows, "OR LEDERMAN");
    expect(out).toHaveLength(1);
    expect(out[0].pickers.map((p) => p.displayName)).toEqual(["Or Lederman"]);
  });

  it("drops rows that match neither the question nor any picker", () => {
    expect(filterRowsByQuery(rows, "zzzznope")).toEqual([]);
  });
});
