import "server-only";

import { API_FOOTBALL_BASE, API_FOOTBALL_WC_LEAGUE_ID } from "./api-football";

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

const BASE = API_FOOTBALL_BASE;
const WC_LEAGUE = API_FOOTBALL_WC_LEAGUE_ID;

function headers(): Record<string, string> | null {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) return null;
  return {
    "x-rapidapi-key": key,
    "x-rapidapi-host": "v3.football.api-sports.io",
  };
}

// `parse` may return null when the response is shaped wrong or holds no
// rows the caller cares about; the outer null branches (key unset,
// upstream error) carry through unchanged. Letting the parser return
// null directly is what kills the `null as unknown as T` casts that
// each `rows[0] ?? null` callsite used to need.
async function get<TParsed>(
  path: string,
  parse: (json: unknown) => TParsed | null,
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

// ---------- Top yellow cards ----------

export type ApiCardLeader = {
  apiId: number;
  name: string;
  photoUrl: string | null;
  teamCode: string | null;
  teamName: string;
  yellow: number;
  red: number;
  minutes: number | null;
};

export async function fetchTopYellowCards(
  season = 2026,
): Promise<ApiCardLeader[] | null> {
  return get(
    `/players/topyellowcards?league=${WC_LEAGUE}&season=${season}`,
    (json) => {
      const rows = (json as { response?: RawCardLeaderRow[] }).response ?? [];
      return rows.map(parseCardLeaderRow);
    },
    3600,
  );
}

// ---------- Injuries + suspensions ----------

export type ApiInjury = {
  playerApiId: number;
  playerName: string;
  playerPhotoUrl: string | null;
  teamCode: string | null;
  teamName: string;
  type: string;   // e.g. "Missing Fixture", "Questionable"
  reason: string; // e.g. "Hamstring Injury", "Suspended"
};

export async function fetchInjuries(
  season = 2026,
): Promise<ApiInjury[] | null> {
  return get(
    `/injuries?league=${WC_LEAGUE}&season=${season}`,
    (json) => {
      const rows = (json as { response?: RawInjuryRow[] }).response ?? [];
      return rows.map(parseInjuryRow);
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
      if (!r) return null;
      return parseTeamStatistics(r);
    },
    3600,
  );
}

// ---------- Match details (lineups + events + statistics + players) ----------
//
// /fixtures?id=X returns one rich object with embedded sub-resources. We
// expose only the slices the UI consumes. Player ratings come back as
// strings ("7.8") which we coerce to number.

export type ApiMatchEvent = {
  minute: number;
  extraMinute: number | null;
  teamApiId: number;
  teamName: string;
  player: string;
  type: "Goal" | "Card" | "subst" | "Var" | string;
  detail: string; // "Normal Goal", "Yellow Card", "Red Card", "Substitution 1", etc.
};

export type ApiLineupPlayer = {
  apiId: number;
  name: string;
  number: number | null;
  position: string; // "G" / "D" / "M" / "F"
  grid: string | null; // "1:1" formation slot, may be null
};

export type ApiLineup = {
  teamApiId: number;
  teamName: string;
  formation: string;
  startXI: ApiLineupPlayer[];
  substitutes: ApiLineupPlayer[];
};

export type ApiMatchDetails = {
  fixtureId: number;
  status: string;       // "FT" / "1H" / "HT" / "2H" / etc.
  elapsed: number | null;
  events: ApiMatchEvent[];
  lineups: ApiLineup[];
  // Player ratings: one row per player who took the field, with a 0-10
  // rating string + key boolean flags. Empty until the match starts.
  playerRatings: Array<{
    teamApiId: number;
    teamName: string;
    apiId: number;
    name: string;
    rating: number | null;
    captain: boolean;
    substitute: boolean;
    minutes: number | null;
    goals: number;
    assists: number;
    yellow: number;
    red: number;
  }>;
};

export async function fetchMatchDetails(
  fixtureId: number,
  // Live matches get a 30s revalidate. Finished matches lock to 12h so we
  // don't burn API calls re-reading the same /fixtures payload.
  liveMode = false,
): Promise<ApiMatchDetails | null> {
  return get(
    `/fixtures?id=${fixtureId}`,
    (json) => {
      const rows = (json as { response?: RawFixtureDetailRow[] }).response ?? [];
      const r = rows[0];
      if (!r) return null;
      return parseFixtureDetailRow(r);
    },
    liveMode ? 30 : 43200,
  );
}

// ---------- Pre-match predictions ----------
//
// /predictions?fixture=X returns API-Football's own model output: a
// suggested winner, an estimated score range, and home/draw/away win
// probabilities (as "53%" strings - we coerce to number 0-1).
// Useful pre-kickoff context but not deterministic - we surface as
// "AI suggestion" with a disclaimer to keep expectations honest.

export type ApiPrediction = {
  winnerTeamApiId: number | null;
  winnerName: string | null;
  winnerComment: string | null;
  predictedScoreHome: string | null;
  predictedScoreAway: string | null;
  // Probabilities sum to ~1.0. Use the fractional values for bar widths.
  probHome: number;
  probDraw: number;
  probAway: number;
  advice: string | null;
};

export async function fetchPrediction(
  fixtureId: number,
): Promise<ApiPrediction | null> {
  return get(
    `/predictions?fixture=${fixtureId}`,
    (json) => {
      const rows = (json as { response?: RawPredictionRow[] }).response ?? [];
      const r = rows[0];
      if (!r) return null;
      return parsePrediction(r);
    },
    3600,
  );
}

// ---------- Head coach (per team) ----------

export type ApiCoach = {
  apiId: number;
  name: string;
  age: number | null;
  nationality: string | null;
  photoUrl: string | null;
  startYear: number | null;
};

export async function fetchHeadCoach(apiTeamId: number): Promise<ApiCoach | null> {
  return get(
    `/coachs?team=${apiTeamId}`,
    (json) => {
      const rows = (json as { response?: RawCoachRow[] }).response ?? [];
      const current = rows.find((r) => !r.career?.some((c) => c.end != null && c.team.id === apiTeamId))
        ?? rows[0];
      if (!current) return null;
      return parseCoachRow(current);
    },
    86400,
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

// ---------- Group standings (with 5-match form) ----------

export type ApiStandingRow = {
  rank: number;
  teamApiId: number;
  teamName: string;
  teamCode: string | null;
  played: number;
  win: number;
  draw: number;
  lose: number;
  goalsFor: number;
  goalsAgainst: number;
  goalsDiff: number;
  points: number;
  form: string;        // "WDLWW" up to 5 chars, newest at the right
  group: string;       // "Group A"
  description: string | null;
};

export async function fetchStandings(
  season = 2026,
): Promise<ApiStandingRow[] | null> {
  return get(
    `/standings?league=${WC_LEAGUE}&season=${season}`,
    (json) => {
      const blocks = (json as { response?: RawStandingsResponse[] }).response ?? [];
      const first = blocks[0];
      if (!first) return [];
      // The standings field is a 2-D array: one outer entry per group (or per
      // "round" in knockout). Flatten and tag each row with the group name.
      const out: ApiStandingRow[] = [];
      for (const groupArr of first.league.standings) {
        for (const row of groupArr) {
          out.push(parseStandingRow(row));
        }
      }
      return out;
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

// Top yellow cards leader row + parser.
type RawCardLeaderRow = {
  player: { id: number; name: string; photo?: string | null };
  statistics: Array<{
    team: { id: number; name: string; code?: string | null };
    games: { minutes?: number | null };
    cards: { yellow: number | null; red: number | null };
  }>;
};

function parseCardLeaderRow(row: RawCardLeaderRow): ApiCardLeader {
  const stat = row.statistics[0];
  return {
    apiId: row.player.id,
    name: row.player.name,
    photoUrl: row.player.photo ?? null,
    teamCode: stat?.team.code ? stat.team.code.toUpperCase() : null,
    teamName: stat?.team.name ?? "",
    yellow: stat?.cards.yellow ?? 0,
    red: stat?.cards.red ?? 0,
    minutes: stat?.games.minutes ?? null,
  };
}

// Injury row + parser.
type RawInjuryRow = {
  player: { id: number; name: string; photo?: string | null; type?: string; reason?: string };
  team: { id: number; name: string; logo?: string | null };
};

function parseInjuryRow(row: RawInjuryRow): ApiInjury {
  // API-Football puts `type` ("Missing Fixture" / "Questionable") and
  // `reason` (the actual injury) inside the player block. Fall back to
  // empty strings so the UI can branch safely.
  // The team object doesn't carry a TLA in this endpoint - we resolve
  // the code from name at the call site if needed.
  return {
    playerApiId: row.player.id,
    playerName: row.player.name,
    playerPhotoUrl: row.player.photo ?? null,
    teamCode: null,
    teamName: row.team.name,
    type: row.player.type ?? "",
    reason: row.player.reason ?? "",
  };
}

// Standings: outer `response` is one block per league, with a 2-D
// `standings` array (groups → rows).
type RawStandingsResponse = {
  league: {
    id: number;
    name: string;
    season: number;
    standings: RawStandingRow[][];
  };
};

type RawStandingRow = {
  rank: number;
  team: { id: number; name: string; logo: string };
  points: number;
  goalsDiff: number;
  group: string;
  form: string | null;
  status: string | null;
  description: string | null;
  all: {
    played: number;
    win: number;
    draw: number;
    lose: number;
    goals: { for: number; against: number };
  };
};

// Prediction row + parser. API-Football returns "53%" strings.
type RawPredictionRow = {
  predictions: {
    winner: { id: number | null; name: string | null; comment: string | null };
    win_or_draw: boolean;
    under_over: string | null;
    goals: { home: string | null; away: string | null };
    advice: string | null;
    percent: { home: string; draw: string; away: string };
  };
};

function parsePrediction(r: RawPredictionRow): ApiPrediction {
  const pct = (raw: string): number => {
    if (!raw) return 0;
    const n = Number(raw.replace("%", "").trim());
    return Number.isFinite(n) ? n / 100 : 0;
  };
  return {
    winnerTeamApiId: r.predictions.winner.id,
    winnerName: r.predictions.winner.name,
    winnerComment: r.predictions.winner.comment,
    predictedScoreHome: r.predictions.goals.home,
    predictedScoreAway: r.predictions.goals.away,
    probHome: pct(r.predictions.percent.home),
    probDraw: pct(r.predictions.percent.draw),
    probAway: pct(r.predictions.percent.away),
    advice: r.predictions.advice,
  };
}

// /fixtures?id=X embeds the entire match payload. The raw shape is deep;
// we only pluck the slices the UI renders.
type RawFixtureDetailRow = {
  fixture: { id: number; status: { short: string; elapsed: number | null } };
  teams: {
    home: { id: number; name: string };
    away: { id: number; name: string };
  };
  events?: Array<{
    time: { elapsed: number; extra: number | null };
    team: { id: number; name: string };
    player: { id: number | null; name: string };
    type: string;
    detail: string;
  }>;
  lineups?: Array<{
    team: { id: number; name: string; formation?: string };
    formation: string;
    startXI: Array<{ player: { id: number; name: string; number: number | null; pos: string; grid: string | null } }>;
    substitutes: Array<{ player: { id: number; name: string; number: number | null; pos: string; grid: string | null } }>;
  }>;
  players?: Array<{
    team: { id: number; name: string };
    players: Array<{
      player: { id: number; name: string };
      statistics: Array<{
        games: {
          minutes: number | null;
          rating: string | null;
          captain: boolean;
          substitute: boolean;
        };
        goals: { total: number | null; assists: number | null };
        cards: { yellow: number | null; red: number | null };
      }>;
    }>;
  }>;
};

function parseFixtureDetailRow(r: RawFixtureDetailRow): ApiMatchDetails {
  const events: ApiMatchEvent[] = (r.events ?? []).map((e) => ({
    minute: e.time.elapsed,
    extraMinute: e.time.extra,
    teamApiId: e.team.id,
    teamName: e.team.name,
    player: e.player.name,
    type: e.type,
    detail: e.detail,
  }));
  const lineups: ApiLineup[] = (r.lineups ?? []).map((l) => ({
    teamApiId: l.team.id,
    teamName: l.team.name,
    formation: l.formation,
    startXI: (l.startXI ?? []).map((row) => ({
      apiId: row.player.id,
      name: row.player.name,
      number: row.player.number,
      position: row.player.pos,
      grid: row.player.grid,
    })),
    substitutes: (l.substitutes ?? []).map((row) => ({
      apiId: row.player.id,
      name: row.player.name,
      number: row.player.number,
      position: row.player.pos,
      grid: row.player.grid,
    })),
  }));
  const playerRatings: ApiMatchDetails["playerRatings"] = [];
  for (const block of r.players ?? []) {
    for (const p of block.players) {
      const stat = p.statistics[0];
      if (!stat) continue;
      const rating = stat.games.rating ? Number(stat.games.rating) : null;
      playerRatings.push({
        teamApiId: block.team.id,
        teamName: block.team.name,
        apiId: p.player.id,
        name: p.player.name,
        rating: Number.isFinite(rating ?? NaN) ? rating : null,
        captain: stat.games.captain,
        substitute: stat.games.substitute,
        minutes: stat.games.minutes ?? null,
        goals: stat.goals.total ?? 0,
        assists: stat.goals.assists ?? 0,
        yellow: stat.cards.yellow ?? 0,
        red: stat.cards.red ?? 0,
      });
    }
  }
  return {
    fixtureId: r.fixture.id,
    status: r.fixture.status.short,
    elapsed: r.fixture.status.elapsed,
    events,
    lineups,
    playerRatings,
  };
}

// Coach row + parser. API-Football's /coachs?team=X returns a list with
// `career` history; we want the row whose career has the team as current.
type RawCoachRow = {
  id: number;
  name: string;
  age?: number | null;
  nationality?: string | null;
  photo?: string | null;
  career?: Array<{
    team: { id: number; name: string };
    start: string | null;
    end: string | null;
  }>;
};

function parseCoachRow(c: RawCoachRow): ApiCoach {
  const current = c.career?.find((row) => row.end == null);
  const startYear = current?.start ? Number(current.start.slice(0, 4)) : null;
  return {
    apiId: c.id,
    name: c.name,
    age: c.age ?? null,
    nationality: c.nationality ?? null,
    photoUrl: c.photo ?? null,
    startYear: Number.isFinite(startYear ?? NaN) ? startYear : null,
  };
}

function parseStandingRow(r: RawStandingRow): ApiStandingRow {
  return {
    rank: r.rank,
    teamApiId: r.team.id,
    teamName: r.team.name,
    teamCode: null,
    played: r.all.played,
    win: r.all.win,
    draw: r.all.draw,
    lose: r.all.lose,
    goalsFor: r.all.goals.for,
    goalsAgainst: r.all.goals.against,
    goalsDiff: r.goalsDiff,
    points: r.points,
    form: (r.form ?? "").slice(-5),
    group: r.group,
    description: r.description ?? null,
  };
}
