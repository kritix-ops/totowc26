import { describe, expect, it } from "vitest";
import {
  renderDossier,
  renderDayDossier,
  type MatchDossier,
  type DayFixtureDossier,
} from "./dossier";

// renderDossier turns the assembled dossier into the compact prompt text the
// generator reads. The contract that matters: real numbers land, player key
// lines carry the api id (the grader's join key), and empty sections are
// skipped rather than padded. See
// _plans/2026-06-13-live-bet-suggestions-enrichment.md Phase 1.

const full: MatchDossier = {
  prediction: {
    winnerTeamApiId: 16,
    winnerName: "Mexico",
    winnerComment: null,
    predictedScoreHome: "2",
    predictedScoreAway: "1",
    probHome: 0.55,
    probDraw: 0.25,
    probAway: 0.2,
    advice: "Combo Double chance: Mexico or draw",
  },
  home: {
    code: "MEX",
    nameHe: "מקסיקו",
    nameEn: "Mexico",
    stats: {
      played: 3,
      wins: 2,
      draws: 1,
      losses: 0,
      goalsFor: 5,
      goalsAgainst: 1,
      goalDifference: 4,
      cleanSheets: 2,
      failedToScore: 0,
      form: "WWD",
    },
    standing: { rank: 1, points: 7, group: "Group A" },
    injuries: [{ name: "Edson Álvarez", reason: "Hamstring" }],
    recent: [{ opponent: "South Africa", scored: 2, conceded: 0, result: "W" }],
    coach: "Javier Aguirre",
    keyPlayers: [
      { apiId: 35532, he: "חוליאן קיניונס", en: "Julián Quiñones", position: "Attacker", goals: 3, assists: 1, yellow: 0 },
    ],
  },
  away: {
    code: "RSA",
    nameHe: "דרום אפריקה",
    nameEn: "South Africa",
    stats: null,
    standing: null,
    injuries: [],
    recent: [],
    coach: null,
    keyPlayers: [],
  },
};

describe("renderDossier", () => {
  it("renders the prediction line with rounded percentages", () => {
    const text = renderDossier(full);
    expect(text).toContain("win prob home/draw/away 55%/25%/20%");
    expect(text).toContain("model leans Mexico");
    expect(text).toContain("advice: Combo Double chance: Mexico or draw");
  });

  it("includes a key player WITH the api id (the grader's join key)", () => {
    const text = renderDossier(full);
    expect(text).toContain("Julián Quiñones (id 35532");
    expect(text).toContain("3G");
    expect(text).toContain("1A");
  });

  it("renders real team stats and standing", () => {
    const text = renderDossier(full);
    expect(text).toContain("2W-1D-0L");
    expect(text).toContain("Group A: rank 1, 7 pts");
    expect(text).toContain("out/doubtful: Edson Álvarez (Hamstring)");
  });

  it("skips empty sections rather than padding them", () => {
    const text = renderDossier(full);
    // The away team has no stats / standing / players — none of those labels
    // should appear for it.
    expect(text).toContain("AWAY South Africa (RSA):");
    const awayBlock = text.slice(text.indexOf("AWAY South Africa"));
    expect(awayBlock).not.toContain("key players");
    expect(awayBlock).not.toContain("rank");
  });

  it("omits the prediction line entirely when there is no prediction", () => {
    const text = renderDossier({ ...full, prediction: null });
    expect(text).not.toContain("API-Football model:");
  });
});

describe("renderDayDossier", () => {
  const fixtureDossier = (homeEn: string, awayEn: string, playerId: number): DayFixtureDossier => ({
    homeNameEn: homeEn,
    awayNameEn: awayEn,
    dossier: {
      ...full,
      home: {
        ...full.home,
        nameEn: homeEn,
        keyPlayers: [
          { apiId: playerId, he: "שחקן", en: "Player", position: "Attacker", goals: 1, assists: 0, yellow: 0 },
        ],
      },
      away: { ...full.away, nameEn: awayEn },
    },
  });

  it("numbers each fixture and keeps every fixture's player ids", () => {
    const text = renderDayDossier([
      fixtureDossier("France", "England", 11),
      fixtureDossier("Brazil", "Spain", 22),
    ]);
    expect(text).toContain("Fixture 1: France vs England");
    expect(text).toContain("Fixture 2: Brazil vs Spain");
    // Both fixtures' player ids survive into the day prompt so a day-scope
    // player prop can still be validated against the union.
    expect(text).toContain("id 11");
    expect(text).toContain("id 22");
  });

  it("returns an empty string for no fixtures so the prompt can branch cleanly", () => {
    expect(renderDayDossier([])).toBe("");
  });
});
