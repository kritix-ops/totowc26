import "server-only";

// API-Football data wrappers - slow-moving stuff that powers the
// "World Cup zone" pages (squads, top scorers, team stats, recent
// fixtures). Kept in a separate file from src/lib/api-football.ts so
// the live-grading wrapper and the odds wrapper (PR 2 of the betting
// overhaul) can iterate independently without merge churn.
//
// Every export here returns null (not throws) when API_FOOTBALL_KEY is
// missing or the upstream call fails - so the World Cup zone pages can
// render an empty-state card and the rest of the app stays alive.
//
// Caching: callers pass `next.revalidate` to fetch; the SSR pages set
// 3600s (1 hour) by default for tournament-wide endpoints and 86400s
// (24 hours) for slowly-changing team metadata. Budget headroom is
// large - see _plans/2026-05-25-matchday-custom-bets-system.md §6.5
// and the activation notes.

const BASE = "https://v3.football.api-sports.io";
const WC_LEAGUE = 15;

function headers(): Record<string, string> | null {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) return null;
  return {
    "x-rapidapi-key": key,
    "x-rapidapi-host": "v3.football.api-sports.io",
  };
}

async function get<TParsed>(
  path: string,
  parse: (json: unknown) => TParsed,
  revalidate = 3600,
): Promise<TParsed | null> {
  const h = headers();
  if (!h) {
    console.warn("[api-football stubbed]", { path, reason: "API_FOOTBALL_KEY not set" });
    return null;
  }
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: h,
      next: { revalidate },
    });
    if (!res.ok) {
      console.warn("[api-football error]", { path, status: res.status });
      return null;
    }
    const json = await res.json();
    return parse(json);
  } catch (err) {
    console.error("[api-football fetch failed]", { path, err });
    return null;
  }
}

// ---------- Teams ----------

export type ApiTeam = {
  apiId: number;
  name: string;
  code: string | null;     // 3-letter, uppercase
  country: string | null;
  logoUrl: string | null;
};

export async function fetchTeams(
  season = 2026,
): Promise<ApiTeam[] | null> {
  return get(
    `/teams?league=${WC_LEAGUE}&season=${season}`,
    (json) => {
      const rows = (json as { response?: Array<{ team: RawTeam }> }).response ?? [];
      return rows.map(parseTeam);
    },
    86400,
  );
}

// ---------- Squad (per team) ----------

export type ApiPlayer = {
  apiId: number;
  name: string;
  age: number | null;
  number: number | null;        // jersey number
  position: string | null;      // "Attacker" / "Midfielder" / "Defender" / "Goalkeeper"
  photoUrl: string | null;
};

export async function fetchSquad(
  apiTeamId: number,
): Promise<ApiPlayer[] | null> {
  return get(
    `/players/squads?team=${apiTeamId}`,
    (json) => {
      const list = (json as { response?: Array<{ players: RawSquadPlayer[] }> }).response ?? [];
      const players = list[0]?.players ?? [];
      return players.map(parseSquadPlayer);
    },
    86400,
  );
}

// ---------- Top scorers / Top assists ----------

export type ApiScorer = {
  apiId: number;
  name: string;
  photoUrl: string | null;
  teamCode: string | null;
  teamName: string;
  goals: number;
  assists: number;
  minutes: number | null;
  shotsTotal: number | null;
  shotsOnGoal: number | null;
};

export async function fetchTopScorers(
  season = 2026,
): Promise<ApiScorer[] | null> {
  return get(
    `/players/topscorers?league=${WC_LEAGUE}&season=${season}`,
    (json) => {
      const rows = (json as { response?: RawScorerRow[] }).response ?? [];
      return rows.map(parseScorerRow);
    },
    3600,
  );
}

export async function fetchTopAssists(
  season = 2026,
): Promise<ApiScorer[] | null> {
  return get(
    `/players/topassists?league=${WC_LEAGUE}&season=${season}`,
    (json) => {
      const rows = (json as { response?: RawScorerRow[] }).response ?? [];
      return rows.map(parseScorerRow);
    },
    3600,
  );
}

// ---------- Team statistics ----------

export type ApiTeamStatistics = {
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  cleanSheets: number;
  failedToScore: number;
  // Recent 5 results, oldest → newest. "W" / "D" / "L".
  form: string;
};

export async function fetchTeamStatistics(
  apiTeamId: number,
  season = 2026,
): Promise<ApiTeamStatistics | null> {
  return get(
    `/teams/statistics?league=${WC_LEAGUE}&season=${season}&team=${apiTeamId}`,
    (json) => {
      const r = (json as { response?: RawTeamStatistics }).response;
      if (!r) return null as unknown as ApiTeamStatistics;
      return parseTeamStatistics(r);
    },
    3600,
  );
}

// ---------- Recent + upcoming fixtures (per team) ----------

export type ApiTeamFixture = {
  fixtureId: number;
  kickoffAt: string;
  status: string;
  homeTeamId: number;
  homeName: string;
  homeCode: string | null;
  homeScore: number | null;
  awayTeamId: number;
  awayName: string;
  awayCode: string | null;
  awayScore: number | null;
  venue: string | null;
};

export async function fetchTeamFixtures(
  apiTeamId: number,
  season = 2026,
): Promise<ApiTeamFixture[] | null> {
  return get(
    `/fixtures?team=${apiTeamId}&season=${season}`,
    (json) => {
      const rows = (json as { response?: RawFixtureRow[] }).response ?? [];
      return rows.map(parseFixtureRow);
    },
    3600,
  );
}

// ---------- response shapes + parsers ----------

type RawTeam = {
  id: number;
  name: string;
  code?: string | null;
  country?: string | null;
  logo?: string | null;
};

function parseTeam(row: { team: RawTeam }): ApiTeam {
  return {
    apiId: row.team.id,
    name: row.team.name,
    code: row.team.code ? row.team.code.toUpperCase() : null,
    country: row.team.country ?? null,
    logoUrl: row.team.logo ?? null,
  };
}

type RawSquadPlayer = {
  id: number;
  name: string;
  age?: number | null;
  number?: number | null;
  position?: string | null;
  photo?: string | null;
};

function parseSquadPlayer(p: RawSquadPlayer): ApiPlayer {
  return {
    apiId: p.id,
    name: p.name,
    age: p.age ?? null,
    number: p.number ?? null,
    position: p.position ?? null,
    photoUrl: p.photo ?? null,
  };
}

type RawScorerRow = {
  player: {
    id: number;
    name: string;
    photo?: string | null;
  };
  statistics: Array<{
    team: { id: number; name: string; code?: string | null };
    goals: { total: number | null; assists: number | null };
    games: { minutes?: number | null };
    shots?: { total?: number | null; on?: number | null };
  }>;
};

function parseScorerRow(row: RawScorerRow): ApiScorer {
  // World Cup is one tournament per player → statistics[0] is sufficient.
  const stat = row.statistics[0];
  return {
    apiId: row.player.id,
    name: row.player.name,
    photoUrl: row.player.photo ?? null,
    teamCode: stat?.team.code ? stat.team.code.toUpperCase() : null,
    teamName: stat?.team.name ?? "",
    goals: stat?.goals.total ?? 0,
    assists: stat?.goals.assists ?? 0,
    minutes: stat?.games.minutes ?? null,
    shotsTotal: stat?.shots?.total ?? null,
    shotsOnGoal: stat?.shots?.on ?? null,
  };
}

type RawTeamStatistics = {
  fixtures: {
    played: { total: number };
    wins: { total: number };
    draws: { total: number };
    loses: { total: number };
  };
  goals: {
    for: { total: { total: number } };
    against: { total: { total: number } };
  };
  clean_sheet: { total: number };
  failed_to_score: { total: number };
  form: string;
};

function parseTeamStatistics(r: RawTeamStatistics): ApiTeamStatistics {
  const gf = r.goals.for.total.total ?? 0;
  const ga = r.goals.against.total.total ?? 0;
  return {
    played: r.fixtures.played.total ?? 0,
    wins: r.fixtures.wins.total ?? 0,
    draws: r.fixtures.draws.total ?? 0,
    losses: r.fixtures.loses.total ?? 0,
    goalsFor: gf,
    goalsAgainst: ga,
    goalDifference: gf - ga,
    cleanSheets: r.clean_sheet.total ?? 0,
    failedToScore: r.failed_to_score.total ?? 0,
    form: (r.form ?? "").slice(-5),
  };
}

type RawFixtureRow = {
  fixture: { id: number; date: string; status: { short: string }; venue: { name: string | null } };
  teams: {
    home: { id: number; name: string; code?: string | null };
    away: { id: number; name: string; code?: string | null };
  };
  goals: { home: number | null; away: number | null };
};

function parseFixtureRow(row: RawFixtureRow): ApiTeamFixture {
  return {
    fixtureId: row.fixture.id,
    kickoffAt: row.fixture.date,
    status: row.fixture.status.short,
    homeTeamId: row.teams.home.id,
    homeName: row.teams.home.name,
    homeCode: row.teams.home.code ? row.teams.home.code.toUpperCase() : null,
    homeScore: row.goals.home,
    awayTeamId: row.teams.away.id,
    awayName: row.teams.away.name,
    awayCode: row.teams.away.code ? row.teams.away.code.toUpperCase() : null,
    awayScore: row.goals.away,
    venue: row.fixture.venue?.name ?? null,
  };
}
