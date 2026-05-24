import "server-only";

import { eq, isNull, and, sql as drizzleSql } from "drizzle-orm";
import { db } from "@/db";
import {
  matches,
  matchBets,
  settings,
  teams,
  specialBets,
  tournamentResults,
} from "@/db/schema";
import {
  fetchWorldCupMatches,
  mapStage,
  mapStatus,
  type FDMatch,
} from "./football-data";
import TEAM_NAMES from "../../data/team-names.json";

type LocalisedTeam = { he: string; en: string; flag: string };
const NAMES = TEAM_NAMES as Record<string, LocalisedTeam | undefined>;

async function ensureTeam(code: string, apiName: string) {
  const loc = NAMES[code];
  const nameHe = loc?.he ?? apiName;
  const nameEn = loc?.en ?? apiName;
  const flag = loc?.flag ?? "🏳️";
  await db
    .insert(teams)
    .values({ code, nameHe, nameEn, flag })
    .onConflictDoUpdate({
      target: teams.code,
      set: { nameHe, nameEn, flag },
    });
}

export type SyncReport = {
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
  scoredBets: number;
  scoredMatches: number;
  scoredSpecials: number;
  unknownTeams: string[];
};

// Aliases mapping football-data tla values to our 3-letter codes. The two
// match for the common World Cup nations, but football-data occasionally
// uses an alternative (e.g. KOR vs KSA can be confused; or ENG = England,
// GBR = Great Britain). Document overrides here.
const TLA_OVERRIDE: Record<string, string> = {
  // football-data uses "GER" for Germany already.
  // football-data uses "KSA" for Saudi Arabia already.
  // football-data uses "RSA" for South Africa.
  // Add overrides only if a mismatch surfaces in the logs.
};

function normalizeTla(tla: string | null): string | null {
  if (!tla) return null;
  const up = tla.toUpperCase();
  return TLA_OVERRIDE[up] ?? up;
}

export async function syncFixtures(season = 2026): Promise<SyncReport> {
  const fixtures = await fetchWorldCupMatches(season);
  const report: SyncReport = {
    fetched: fixtures.length,
    inserted: 0,
    updated: 0,
    skipped: 0,
    scoredBets: 0,
    scoredMatches: 0,
    scoredSpecials: 0,
    unknownTeams: [],
  };

  for (const f of fixtures) {
    const homeCode = normalizeTla(f.homeTeam.tla);
    const awayCode = normalizeTla(f.awayTeam.tla);
    if (!homeCode) {
      report.unknownTeams.push(f.homeTeam.name);
      report.skipped += 1;
      continue;
    }
    if (!awayCode) {
      report.unknownTeams.push(f.awayTeam.name);
      report.skipped += 1;
      continue;
    }

    await ensureTeam(homeCode, f.homeTeam.name);
    await ensureTeam(awayCode, f.awayTeam.name);

    const { stage, groupId } = mapStage(f.stage, f.group);
    const status = mapStatus(f.status);
    const home = f.score.fullTime.home;
    const away = f.score.fullTime.away;
    const htHome = f.score.halfTime?.home ?? null;
    const htAway = f.score.halfTime?.away ?? null;
    const wentToPen = f.status === "PEN";

    const result = await db.execute<{ inserted: boolean }>(drizzleSql`
      insert into public.matches
        (home_team, away_team, kickoff_at, stage, group_id, venue, status,
         home_score, away_score, ht_home_score, ht_away_score,
         went_to_penalties, finalized_at, api_fixture_id)
      values
        (${homeCode}, ${awayCode}, ${f.utcDate}, ${stage}, ${groupId},
         ${f.venue ?? null}, ${status}, ${home}, ${away}, ${htHome}, ${htAway},
         ${wentToPen}, ${status === "final" ? f.utcDate : null}, ${f.id})
      on conflict (api_fixture_id) do update set
        home_team = excluded.home_team,
        away_team = excluded.away_team,
        kickoff_at = excluded.kickoff_at,
        stage = excluded.stage,
        group_id = excluded.group_id,
        venue = excluded.venue,
        status = excluded.status,
        home_score = excluded.home_score,
        away_score = excluded.away_score,
        ht_home_score = excluded.ht_home_score,
        ht_away_score = excluded.ht_away_score,
        went_to_penalties = excluded.went_to_penalties,
        finalized_at = case when excluded.status = 'final' and matches.finalized_at is null then now() else matches.finalized_at end
      returning (xmax = 0) as inserted
    `);
    const rows = result as unknown as Array<{ inserted: boolean }>;
    if (rows[0]?.inserted) report.inserted += 1;
    else report.updated += 1;
  }

  // Sync team→group assignments from the actual group-stage matches.
  await syncTeamGroups();

  // Auto-score newly finalised matches.
  const scoring = await scoreFinalMatches();
  report.scoredBets = scoring.scoredBets;
  report.scoredMatches = scoring.scoredMatches;

  // Tournament-wide special bets (top scorer, final penalties). Idempotent —
  // re-running rescores everyone against the latest tournament_results row.
  report.scoredSpecials = await scoreSpecialBets();

  return report;
}

async function syncTeamGroups() {
  // Ensure every group letter that appears in match data has a groups row.
  await db.execute(drizzleSql`
    insert into public.groups (id, display_order)
    select distinct m.group_id, ascii(m.group_id) - ascii('A') + 1
    from public.matches m
    where m.stage = 'group' and m.group_id is not null
    on conflict (id) do nothing
  `);
  // Assign group_id to teams based on their actual group-stage matches.
  await db.execute(drizzleSql`
    update public.teams t
    set group_id = sub.gid
    from (
      select distinct on (code) code, group_id as gid from (
        select m.home_team as code, m.group_id from public.matches m
        where m.stage = 'group' and m.group_id is not null
        union all
        select m.away_team as code, m.group_id from public.matches m
        where m.stage = 'group' and m.group_id is not null
      ) all_pairs
      order by code, gid
    ) sub
    where t.code = sub.code and (t.group_id is distinct from sub.gid)
  `);
  // Clear group_id for teams not in any current group-stage match.
  await db.execute(drizzleSql`
    update public.teams t
    set group_id = null
    where t.group_id is not null
      and not exists (
        select 1 from public.matches m
        where m.stage = 'group'
          and m.group_id = t.group_id
          and (m.home_team = t.code or m.away_team = t.code)
      )
  `);
}

function outcome(home: number, away: number): "1" | "X" | "2" {
  if (home > away) return "1";
  if (home < away) return "2";
  return "X";
}

export async function scoreFinalMatches(): Promise<{
  scoredMatches: number;
  scoredBets: number;
}> {
  const [s] = await db
    .select({
      scoringExact: settings.scoringExact,
      scoringOutcome: settings.scoringOutcome,
      scoringBtts: settings.scoringBtts,
      scoringOver25: settings.scoringOver25,
      scoringHtExact: settings.scoringHtExact,
      scoringHtOutcome: settings.scoringHtOutcome,
    })
    .from(settings)
    .where(eq(settings.id, 1));
  if (!s) return { scoredMatches: 0, scoredBets: 0 };

  const matchRows = await db.execute<{
    id: string;
    home_score: number;
    away_score: number;
    ht_home_score: number | null;
    ht_away_score: number | null;
  }>(drizzleSql`
    select m.id::text as id, m.home_score, m.away_score, m.ht_home_score, m.ht_away_score
    from public.matches m
    where m.status = 'final'
      and m.home_score is not null
      and m.away_score is not null
      and exists (
        select 1 from public.match_bets mb
        where mb.match_id = m.id and mb.points_earned is null
      )
  `);
  const matchesList = matchRows as unknown as Array<{
    id: string;
    home_score: number;
    away_score: number;
    ht_home_score: number | null;
    ht_away_score: number | null;
  }>;

  let scoredBets = 0;
  for (const m of matchesList) {
    const actual = outcome(m.home_score, m.away_score);
    const actualBtts = m.home_score > 0 && m.away_score > 0;
    const actualOver25 = m.home_score + m.away_score > 2;
    const haveHt = m.ht_home_score !== null && m.ht_away_score !== null;
    const actualHtOutcome = haveHt ? outcome(m.ht_home_score!, m.ht_away_score!) : null;

    const bets = await db
      .select({
        id: matchBets.id,
        homeScore: matchBets.homeScore,
        awayScore: matchBets.awayScore,
        betBtts: matchBets.betBtts,
        betOver25: matchBets.betOver25,
        betHtHome: matchBets.betHtHome,
        betHtAway: matchBets.betHtAway,
      })
      .from(matchBets)
      .where(and(eq(matchBets.matchId, m.id), isNull(matchBets.pointsEarned)));

    for (const b of bets) {
      const exact = b.homeScore === m.home_score && b.awayScore === m.away_score;
      const correctOutcome = outcome(b.homeScore, b.awayScore) === actual;
      const points = exact ? s.scoringExact : correctOutcome ? s.scoringOutcome : 0;

      const pointsBtts = b.betBtts === null ? null : b.betBtts === actualBtts ? s.scoringBtts : 0;
      const pointsOver25 = b.betOver25 === null ? null : b.betOver25 === actualOver25 ? s.scoringOver25 : 0;

      let pointsHt: number | null = null;
      if (haveHt && b.betHtHome !== null && b.betHtAway !== null) {
        const htExact = b.betHtHome === m.ht_home_score && b.betHtAway === m.ht_away_score;
        const htOutcomeRight = outcome(b.betHtHome, b.betHtAway) === actualHtOutcome;
        pointsHt = htExact ? s.scoringHtExact : htOutcomeRight ? s.scoringHtOutcome : 0;
      }

      await db
        .update(matchBets)
        .set({
          pointsEarned: points,
          wasExact: exact,
          wasCorrectOutcome: correctOutcome,
          pointsBtts,
          pointsOver25,
          pointsHt,
          locked: true,
        })
        .where(eq(matchBets.id, b.id));
      scoredBets += 1;
    }
  }

  return { scoredMatches: matchesList.length, scoredBets };
}

function normalizeName(s: string): string {
  // Case-insensitive, whitespace-collapsed, diacritic-stripped comparison so
  // "Kylian Mbappé" vs "kylian mbappe " both match.
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export async function scoreSpecialBets(): Promise<number> {
  const [s] = await db
    .select({
      scoringTopScorer: settings.scoringTopScorer,
      scoringFinalPenalties: settings.scoringFinalPenalties,
    })
    .from(settings)
    .where(eq(settings.id, 1));
  if (!s) return 0;

  const [results] = await db
    .select({
      topScorer: tournamentResults.topScorer,
      finalWentToPenalties: tournamentResults.finalWentToPenalties,
    })
    .from(tournamentResults)
    .where(eq(tournamentResults.id, 1));
  if (!results) return 0;

  let scored = 0;
  const topScorerNorm = results.topScorer ? normalizeName(results.topScorer) : null;

  if (topScorerNorm !== null) {
    const picks = await db
      .select({ id: specialBets.id, value: specialBets.value })
      .from(specialBets)
      .where(eq(specialBets.betType, "top_scorer"));
    for (const p of picks) {
      const pts = normalizeName(p.value) === topScorerNorm ? s.scoringTopScorer : 0;
      await db
        .update(specialBets)
        .set({ pointsEarned: pts })
        .where(eq(specialBets.id, p.id));
      scored += 1;
    }
  }

  if (results.finalWentToPenalties !== null) {
    const want = results.finalWentToPenalties ? "yes" : "no";
    const picks = await db
      .select({ id: specialBets.id, value: specialBets.value })
      .from(specialBets)
      .where(eq(specialBets.betType, "final_penalties"));
    for (const p of picks) {
      const pts = p.value.toLowerCase() === want ? s.scoringFinalPenalties : 0;
      await db
        .update(specialBets)
        .set({ pointsEarned: pts })
        .where(eq(specialBets.id, p.id));
      scored += 1;
    }
  }

  return scored;
}

// Lightweight typing helper for the `FDMatch` consumer above. Keeps the
// public surface of this module small so callers don't need to know about
// football-data internals.
export type { FDMatch };
