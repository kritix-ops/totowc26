import "server-only";

import { sql } from "drizzle-orm";
import { execRows } from "@/db/helpers";
import {
  getApiTeamIdByCode,
  getMatchPrediction,
  getTeamStats,
  getTeamInjuries,
  getTeamRecentFixtures,
  getTeamCoach,
} from "@/lib/stats";
import {
  fetchTopScorers,
  fetchTopAssists,
  fetchTopYellowCards,
  fetchStandings,
  type ApiPrediction,
  type ApiTeamStatistics,
} from "@/lib/api-football-data";

// Match dossier: the per-fixture intelligence we feed the live-bet
// generator so it stops proposing the same generic markets for every game.
//
// Everything here is assembled from data we ALREADY pull elsewhere:
//   - src/lib/stats.ts (prediction, team stats+form, injuries, recent
//     results, coach) — code-keyed helpers, already cached + provider-aware.
//   - the raw api-football-data top-scorers/assists/cards wrappers — these
//     keep `apiId`, which is the join key the player-prop grader needs.
//   - our own `players` table — the canonical id↔Hebrew-name map.
//
// Degrades gracefully: any source that returns null/empty is simply omitted
// from the dossier (and recorded in `missing`) so a single API hiccup never
// blocks generation. The generator renders whatever sections populated.
//
// See _plans/2026-06-13-live-bet-suggestions-enrichment.md Phase 1.

// One in-form / notable player, keyed by the API-Football player id so a
// market the model writes about them ("X to score") can be auto-graded by
// id later. Tournament-to-date tallies are attached when known.
export type DossierPlayer = {
  apiId: number;
  he: string;
  en: string;
  position: string | null;
  goals: number;
  assists: number;
  yellow: number;
};

export type DossierRecentResult = {
  opponent: string;
  scored: number;
  conceded: number;
  result: "W" | "D" | "L";
};

export type DossierTeam = {
  code: string;
  nameHe: string;
  nameEn: string;
  stats: ApiTeamStatistics | null;
  standing: { rank: number; points: number; group: string } | null;
  injuries: Array<{ name: string; reason: string }>;
  recent: DossierRecentResult[];
  coach: string | null;
  keyPlayers: DossierPlayer[];
};

export type MatchDossier = {
  prediction: ApiPrediction | null;
  home: DossierTeam;
  away: DossierTeam;
};

export type DossierInput = {
  matchId: string;
  homeCode: string;
  homeNameHe: string;
  homeNameEn: string;
  awayCode: string;
  awayNameHe: string;
  awayNameEn: string;
};

export type DossierResult = {
  dossier: MatchDossier;
  // Every API-Football player id on either squad. The generate action
  // validates each player-prop the model emits against this set so a
  // hallucinated id can never reach the grader (it degrades to manual).
  validPlayerIds: Set<number>;
  // Section names that populated vs came back empty — logged for
  // observability so a thin prompt is diagnosable from the console.
  populated: string[];
  missing: string[];
};

// How many key players to surface per team. Enough to give the model real
// player-prop material without flooding the prompt with a 26-man roster.
const KEY_PLAYERS_PER_TEAM = 8;

export async function buildMatchDossier(input: DossierInput): Promise<DossierResult> {
  // Resolve the two API team ids up front; several sub-fetches need them.
  const [homeApiId, awayApiId] = await Promise.all([
    getApiTeamIdByCode(input.homeCode),
    getApiTeamIdByCode(input.awayCode),
  ]);

  // Fan out everything in parallel. Tournament-wide feeds (top lists,
  // standings) are shared across both teams and cached, so this is a
  // handful of cache-friendly calls, not a storm.
  const [
    prediction,
    homeStats,
    awayStats,
    homeInjuries,
    awayInjuries,
    homeRecent,
    awayRecent,
    homeCoach,
    awayCoach,
    standings,
    formMap,
    roster,
  ] = await Promise.all([
    getMatchPrediction(input.matchId),
    getTeamStats(input.homeCode),
    getTeamStats(input.awayCode),
    getTeamInjuries(input.homeCode),
    getTeamInjuries(input.awayCode),
    getTeamRecentFixtures(input.homeCode, 3),
    getTeamRecentFixtures(input.awayCode, 3),
    getTeamCoach(input.homeCode),
    getTeamCoach(input.awayCode),
    fetchStandings(),
    buildPlayerFormMap(),
    fetchRoster(input.homeCode, input.awayCode),
  ]);

  const home = assembleTeam({
    code: input.homeCode,
    nameHe: input.homeNameHe,
    nameEn: input.homeNameEn,
    apiId: homeApiId,
    stats: homeStats,
    injuries: homeInjuries,
    recent: homeRecent,
    coach: homeCoach?.name ?? null,
    standings,
    formMap,
    roster,
  });
  const away = assembleTeam({
    code: input.awayCode,
    nameHe: input.awayNameHe,
    nameEn: input.awayNameEn,
    apiId: awayApiId,
    stats: awayStats,
    injuries: awayInjuries,
    recent: awayRecent,
    coach: awayCoach?.name ?? null,
    standings,
    formMap,
    roster,
  });

  const dossier: MatchDossier = { prediction, home, away };
  const validPlayerIds = new Set(roster.map((r) => r.apiFootballId));
  const { populated, missing } = sectionCoverage(dossier);
  console.info("[live-gen dossier]", {
    fixture: `${input.homeNameEn} vs ${input.awayNameEn}`,
    populated,
    missing,
    rosterSize: validPlayerIds.size,
  });
  return { dossier, validPlayerIds, populated, missing };
}

// ---------- assembly ----------

type AssembleArgs = {
  code: string;
  nameHe: string;
  nameEn: string;
  apiId: number | null;
  stats: ApiTeamStatistics | null;
  injuries: Awaited<ReturnType<typeof getTeamInjuries>>;
  recent: Awaited<ReturnType<typeof getTeamRecentFixtures>>;
  coach: string | null;
  standings: Awaited<ReturnType<typeof fetchStandings>>;
  formMap: PlayerFormMap;
  roster: RosterRow[];
};

function assembleTeam(a: AssembleArgs): DossierTeam {
  return {
    code: a.code,
    nameHe: a.nameHe,
    nameEn: a.nameEn,
    stats: a.stats,
    standing: resolveStanding(a.apiId, a.standings),
    injuries: (a.injuries ?? []).map((i) => ({ name: i.playerName, reason: i.reason || i.type })),
    recent: resolveRecent(a.apiId, a.recent),
    coach: a.coach,
    keyPlayers: resolveKeyPlayers(a.code, a.roster, a.formMap),
  };
}

function resolveStanding(
  apiId: number | null,
  standings: Awaited<ReturnType<typeof fetchStandings>>,
): DossierTeam["standing"] {
  if (apiId === null || !standings) return null;
  const row = standings.find((s) => s.teamApiId === apiId);
  if (!row) return null;
  return { rank: row.rank, points: row.points, group: row.group };
}

// Turn the team's last few fixtures into result lines from this team's
// perspective (W/D/L + score), newest first. Needs the team's api id to
// know which side it played.
function resolveRecent(
  apiId: number | null,
  recent: Awaited<ReturnType<typeof getTeamRecentFixtures>>,
): DossierRecentResult[] {
  if (apiId === null || !recent) return [];
  const out: DossierRecentResult[] = [];
  for (const f of recent) {
    const isHome = f.homeTeamId === apiId;
    const scored = isHome ? f.homeScore : f.awayScore;
    const conceded = isHome ? f.awayScore : f.homeScore;
    const opponent = isHome ? f.awayName : f.homeName;
    if (scored === null || conceded === null) continue;
    const result = scored > conceded ? "W" : scored < conceded ? "L" : "D";
    out.push({ opponent, scored, conceded, result });
  }
  return out;
}

// Pick the team's most relevant players: the in-form ones (any tournament
// goals/assists/cards) first, then fill from the squad biasing to attackers
// and midfielders, capped at KEY_PLAYERS_PER_TEAM. Every entry is keyed by
// api_football_id so a player-prop market can be graded by id.
function resolveKeyPlayers(
  code: string,
  roster: RosterRow[],
  formMap: PlayerFormMap,
): DossierPlayer[] {
  const squad = roster.filter((r) => r.teamCode === code);
  const enriched = squad.map((r) => {
    const form = formMap.get(r.apiFootballId);
    return {
      apiId: r.apiFootballId,
      he: r.nameHe ?? r.nameEn,
      en: r.nameEn,
      position: r.position,
      goals: form?.goals ?? 0,
      assists: form?.assists ?? 0,
      yellow: form?.yellow ?? 0,
    };
  });
  enriched.sort((p, q) => {
    const byForm = formScore(q) - formScore(p);
    if (byForm !== 0) return byForm;
    return positionRank(p.position) - positionRank(q.position);
  });
  return enriched.slice(0, KEY_PLAYERS_PER_TEAM);
}

function formScore(p: DossierPlayer): number {
  return p.goals * 3 + p.assists * 2 + p.yellow;
}

function positionRank(position: string | null): number {
  const p = (position ?? "").toLowerCase();
  if (p.startsWith("attack")) return 0;
  if (p.startsWith("mid")) return 1;
  if (p.startsWith("def")) return 2;
  if (p.startsWith("goal")) return 3;
  return 4;
}

// ---------- player form map (apiId → tournament tallies) ----------

type PlayerForm = { goals: number; assists: number; yellow: number };
type PlayerFormMap = Map<number, PlayerForm>;

// Merge the three tournament leaderboards into one id-keyed tally map. The
// raw wrappers keep `apiId`; stats.ts drops it, so we read the raw ones.
async function buildPlayerFormMap(): Promise<PlayerFormMap> {
  const [scorers, assists, cards] = await Promise.all([
    fetchTopScorers(),
    fetchTopAssists(),
    fetchTopYellowCards(),
  ]);
  const map: PlayerFormMap = new Map();
  const upsert = (id: number, patch: Partial<PlayerForm>) => {
    const cur = map.get(id) ?? { goals: 0, assists: 0, yellow: 0 };
    map.set(id, { ...cur, ...patch });
  };
  for (const s of scorers ?? []) upsert(s.apiId, { goals: s.goals, assists: s.assists });
  for (const a of assists ?? []) {
    const cur = map.get(a.apiId);
    upsert(a.apiId, { assists: a.assists, goals: cur?.goals ?? a.goals });
  }
  for (const c of cards ?? []) upsert(c.apiId, { yellow: c.yellow });
  return map;
}

// ---------- roster (our players table, both teams in one query) ----------

type RosterRow = {
  apiFootballId: number;
  teamCode: string;
  nameEn: string;
  nameHe: string | null;
  position: string | null;
};

async function fetchRoster(homeCode: string, awayCode: string): Promise<RosterRow[]> {
  return execRows<RosterRow>(sql`
    select
      p.api_football_id as "apiFootballId",
      p.team_code       as "teamCode",
      p.name_en         as "nameEn",
      p.name_he         as "nameHe",
      p.position        as "position"
    from public.players p
    where p.team_code in (${homeCode}, ${awayCode})
  `);
}

// ---------- rendering (dossier → compact prompt text) ----------
//
// Plain, dense lines the model can read fast. Key players carry their
// api_football_id inline because that id is what a player-prop grading spec
// must target — the model can only reference an id we hand it. Empty
// sections are skipped so the prompt never pads with "no data".

export function renderDossier(d: MatchDossier): string {
  const lines: string[] = [];

  if (d.prediction) {
    const p = d.prediction;
    const pct = (n: number) => `${Math.round(n * 100)}%`;
    const parts = [
      `win prob home/draw/away ${pct(p.probHome)}/${pct(p.probDraw)}/${pct(p.probAway)}`,
    ];
    if (p.winnerName) parts.push(`model leans ${p.winnerName}`);
    if (p.predictedScoreHome && p.predictedScoreAway) {
      parts.push(`projected goals ~${p.predictedScoreHome}-${p.predictedScoreAway}`);
    }
    if (p.advice) parts.push(`advice: ${p.advice}`);
    lines.push(`API-Football model: ${parts.join("; ")}.`);
  }

  lines.push(renderTeam(d.home, "HOME"));
  lines.push(renderTeam(d.away, "AWAY"));
  return lines.join("\n");
}

function renderTeam(t: DossierTeam, side: "HOME" | "AWAY"): string {
  const out: string[] = [`${side} ${t.nameEn} (${t.code}):`];

  if (t.stats) {
    const s = t.stats;
    const form = s.form ? ` form ${s.form}` : "";
    out.push(
      `  record ${s.wins}W-${s.draws}D-${s.losses}L, GF ${s.goalsFor} GA ${s.goalsAgainst}, ` +
        `clean sheets ${s.cleanSheets}, failed to score ${s.failedToScore}${form}.`,
    );
  }
  if (t.standing) {
    out.push(`  ${t.standing.group}: rank ${t.standing.rank}, ${t.standing.points} pts.`);
  }
  if (t.recent.length > 0) {
    const r = t.recent
      .map((x) => `${x.result} ${x.scored}-${x.conceded} vs ${x.opponent}`)
      .join("; ");
    out.push(`  recent: ${r}.`);
  }
  if (t.coach) out.push(`  coach: ${t.coach}.`);
  if (t.injuries.length > 0) {
    const inj = t.injuries.map((i) => `${i.name}${i.reason ? ` (${i.reason})` : ""}`).join("; ");
    out.push(`  out/doubtful: ${inj}.`);
  }
  if (t.keyPlayers.length > 0) {
    out.push("  key players (use the id verbatim for player markets):");
    for (const p of t.keyPlayers) {
      const tally: string[] = [];
      if (p.goals) tally.push(`${p.goals}G`);
      if (p.assists) tally.push(`${p.assists}A`);
      if (p.yellow) tally.push(`${p.yellow}Y`);
      const stat = tally.length ? ` [${tally.join(" ")}]` : "";
      const pos = p.position ? `, ${p.position}` : "";
      out.push(`    - ${p.en} (id ${p.apiId}${pos})${stat}`);
    }
  }
  return out.join("\n");
}

// ---------- coverage (for observability) ----------

function sectionCoverage(d: MatchDossier): { populated: string[]; missing: string[] } {
  const checks: Array<[string, boolean]> = [
    ["prediction", d.prediction !== null],
    ["home.stats", d.home.stats !== null],
    ["away.stats", d.away.stats !== null],
    ["home.standing", d.home.standing !== null],
    ["away.standing", d.away.standing !== null],
    ["home.injuries", d.home.injuries.length > 0],
    ["away.injuries", d.away.injuries.length > 0],
    ["home.recent", d.home.recent.length > 0],
    ["away.recent", d.away.recent.length > 0],
    ["home.keyPlayers", d.home.keyPlayers.length > 0],
    ["away.keyPlayers", d.away.keyPlayers.length > 0],
  ];
  const populated: string[] = [];
  const missing: string[] = [];
  for (const [name, ok] of checks) (ok ? populated : missing).push(name);
  return { populated, missing };
}

// ---------- day scope (a whole matchday) ----------
//
// The same intelligence, fanned out across every fixture on a matchday, so
// the generator can write day-level markets (most goals in any game, a red
// card anywhere today) and per-fixture markets in one batch. We reuse the
// per-match builder verbatim — the tournament-wide feeds it touches
// (standings, top-scorer lists, roster) are cached, so N fixtures share those
// round-trips rather than refetching them N times. Capped so a heavy group-
// stage day can't balloon the prompt or the API fan-out.

const MAX_DAY_FIXTURES = 8;

export type DayFixtureDossier = {
  homeNameEn: string;
  awayNameEn: string;
  dossier: MatchDossier;
};

export type DayDossierResult = {
  fixtures: DayFixtureDossier[];
  // Union of every fixture's valid player ids — the generator validates an
  // emitted player-prop against this so a day-scope "X to score" still fails
  // closed to manual on a hallucinated id.
  validPlayerIds: Set<number>;
  // How many of the requested fixtures actually assembled (the rest errored
  // and were dropped). Logged for observability.
  built: number;
  requested: number;
};

export async function buildDayDossier(inputs: DossierInput[]): Promise<DayDossierResult> {
  const capped = inputs.slice(0, MAX_DAY_FIXTURES);
  const settled = await Promise.all(
    capped.map((i) =>
      buildMatchDossier(i)
        .then((r) => ({ input: i, result: r }))
        .catch((err) => {
          console.error("[live-gen day-dossier fixture failed]", {
            fixture: `${i.homeNameEn} vs ${i.awayNameEn}`,
            err,
          });
          return { input: i, result: null };
        }),
    ),
  );

  const fixtures: DayFixtureDossier[] = [];
  const validPlayerIds = new Set<number>();
  for (const s of settled) {
    if (!s.result) continue;
    fixtures.push({
      homeNameEn: s.input.homeNameEn,
      awayNameEn: s.input.awayNameEn,
      dossier: s.result.dossier,
    });
    for (const id of s.result.validPlayerIds) validPlayerIds.add(id);
  }

  console.info("[live-gen day-dossier]", {
    requested: inputs.length,
    capped: capped.length,
    built: fixtures.length,
    rosterSize: validPlayerIds.size,
  });
  return { fixtures, validPlayerIds, built: fixtures.length, requested: inputs.length };
}

// Render the day dossier as one block per fixture. Each fixture reuses the
// per-match renderer so the model sees the same depth it would for a single
// game, just stacked and numbered.
export function renderDayDossier(fixtures: DayFixtureDossier[]): string {
  if (fixtures.length === 0) return "";
  return fixtures
    .map((f, i) => {
      const header = `--- Fixture ${i + 1}: ${f.homeNameEn} vs ${f.awayNameEn} ---`;
      return `${header}\n${renderDossier(f.dossier)}`;
    })
    .join("\n\n");
}
