import { describe, expect, it } from "vitest";
import {
  buildLiveBetPushText,
  formatDayLabel,
  liveBetAnchor,
  type LiveBetPushAnchor,
} from "./live-bet-push";

const m = (key: string, label: string): LiveBetPushAnchor => ({ key, label });

describe("buildLiveBetPushText", () => {
  it("returns null for an empty selection", () => {
    expect(buildLiveBetPushText([], "he")).toBeNull();
    expect(buildLiveBetPushText([], "en")).toBeNull();
  });

  it("single bet, single anchor — title singular, body is the match name", () => {
    const res = buildLiveBetPushText([m("g1", "ברזיל נגד גרמניה")], "he");
    expect(res).toEqual({
      title: "הימור לייב חדש",
      body: "ברזיל נגד גרמניה",
    });
  });

  it("several bets on one match — title counts, body stays the match name", () => {
    const res = buildLiveBetPushText(
      [m("g1", "ברזיל נגד גרמניה"), m("g1", "ברזיל נגד גרמניה"), m("g1", "ברזיל נגד גרמניה")],
      "he",
    );
    expect(res).toEqual({
      title: "3 הימורי לייב חדשים",
      body: "ברזיל נגד גרמניה",
    });
  });

  it("bets across multiple anchors — body lists each with its own count", () => {
    const res = buildLiveBetPushText(
      [
        m("g1", "ברזיל נגד גרמניה"),
        m("g1", "ברזיל נגד גרמניה"),
        m("g2", "ארגנטינה נגד צרפת"),
        m("d1", "יום 13.6"),
      ],
      "he",
    );
    expect(res?.title).toBe("4 הימורי לייב חדשים");
    expect(res?.body).toBe(
      "ברזיל נגד גרמניה — 2\nארגנטינה נגד צרפת — 1\nיום 13.6 — 1",
    );
  });

  it("preserves first-seen anchor order", () => {
    const res = buildLiveBetPushText(
      [m("g2", "B"), m("g1", "A"), m("g2", "B")],
      "en",
    );
    expect(res?.body).toBe("B — 2\nA — 1");
  });

  it("renders English copy", () => {
    expect(buildLiveBetPushText([m("g1", "BRA vs GER")], "en")).toEqual({
      title: "New live bet",
      body: "BRA vs GER",
    });
    expect(
      buildLiveBetPushText([m("g1", "A"), m("g2", "B")], "en")?.title,
    ).toBe("2 new live bets");
  });
});

describe("formatDayLabel", () => {
  it("formats YYYY-MM-DD as D.M without leading zeros", () => {
    expect(formatDayLabel("2026-06-13")).toBe("13.6");
    expect(formatDayLabel("2026-07-01")).toBe("1.7");
  });

  it("returns the input unchanged when it isn't a date", () => {
    expect(formatDayLabel("not-a-date")).toBe("not-a-date");
  });
});

describe("liveBetAnchor", () => {
  it("builds a match anchor keyed by fixture with a localized matchup", () => {
    const row = {
      scope: "match" as const,
      matchId: "abc",
      homeName: "ברזיל",
      awayName: "גרמניה",
      matchdayDate: null,
    };
    expect(liveBetAnchor(row, "he")).toEqual({
      key: "m:abc",
      label: "ברזיל נגד גרמניה",
    });
    expect(
      liveBetAnchor({ ...row, homeName: "Brazil", awayName: "Germany" }, "en"),
    ).toEqual({ key: "m:abc", label: "Brazil vs Germany" });
  });

  it("falls back to a generic match label when names are missing", () => {
    expect(
      liveBetAnchor(
        { scope: "match", matchId: "x", homeName: null, awayName: null, matchdayDate: null },
        "he",
      ),
    ).toEqual({ key: "m:x", label: "משחק" });
  });

  it("builds a day anchor keyed by date with a D.M label", () => {
    expect(
      liveBetAnchor(
        { scope: "day", matchId: null, homeName: null, awayName: null, matchdayDate: "2026-06-13" },
        "he",
      ),
    ).toEqual({ key: "d:2026-06-13", label: "יום 13.6" });
  });
});
