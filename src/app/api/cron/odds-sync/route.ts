import { NextResponse, type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { liveOddsSnapshot, outrightOddsSnapshot, teams } from "@/db/schema";
import {
  fetchWcChampionOutright,
  fetchWcMatchOdds,
} from "@/lib/the-odds-api";
import { isAuthorizedCron } from "@/lib/cron-auth";

// Cron-driven refresh of bookmaker odds for every scheduled WC match.
//
// Flow:
//   1. Authenticate the request (Vercel cron secret).
//   2. Load every scheduled match's home/away names + kickoff.
//   3. Hit fetchWcMatchOdds per match. The wrapper's module-level cache
//      means the whole loop pays for ~2 The Odds API credits total
//      (one h2h + one totals fetch of the full WC board, shared across
//      all per-match lookups inside the same request).
//   4. Upsert each non-null result into live_odds_snapshot.
//   5. Return a per-match report so cron logs stay greppable.
//
// Failure mode: any single match's fetch returning null doesn't poison
// the run — we just record it as a miss in the report and move on. The
// previous snapshot row stays in place (so admins keep seeing stale-
// but-not-empty data instead of a sudden blank).

type MatchRow = {
  id: string;
  homeNameEn: string;
  awayNameEn: string;
  kickoffAt: Date;
};

export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const startedAt = Date.now();
  try {
    const rows = (await db.execute(sql`
      select
        m.id::text                 as id,
        th.name_en                 as "homeNameEn",
        ta.name_en                 as "awayNameEn",
        m.kickoff_at               as "kickoffAt"
      from public.matches m
      join public.teams th on th.code = m.home_team
      join public.teams ta on ta.code = m.away_team
      where m.status = 'scheduled'
      order by m.kickoff_at asc
    `)) as unknown as MatchRow[];

    let updated = 0;
    let unmatched = 0;
    let errored = 0;

    for (const m of rows) {
      try {
        const markets = await fetchWcMatchOdds({
          homeTeamEn: m.homeNameEn,
          awayTeamEn: m.awayNameEn,
          kickoffAt: new Date(m.kickoffAt),
        });
        if (markets == null) {
          errored += 1;
          continue;
        }
        if (markets.length === 0) {
          unmatched += 1;
          continue;
        }
        await db
          .insert(liveOddsSnapshot)
          .values({
            matchId: m.id,
            markets,
            fetchedAt: new Date(),
            notes: null,
          })
          .onConflictDoUpdate({
            target: liveOddsSnapshot.matchId,
            set: {
              markets,
              fetchedAt: new Date(),
              notes: null,
            },
          });
        updated += 1;
      } catch (err) {
        console.error("[odds-sync per-match]", { matchId: m.id, err });
        errored += 1;
      }
    }

    // Champion outright — one extra credit. Resolves Bet365/Betfair
    // team labels to our api_football_team_id by name match (alias map
    // lives in the wrapper) and upserts each into outright_odds_snapshot
    // with surface='champion'. admin_override=true rows are preserved
    // — the admin's manual edits survive cron overwrites.
    let championUpdated = 0;
    let championUnmatched = 0;
    try {
      const champion = await fetchWcChampionOutright();
      if (champion && champion.length > 0) {
        const teamRows = await db
          .select({
            apiFootballTeamId: teams.apiFootballTeamId,
            nameEn: teams.nameEn,
          })
          .from(teams);
        const byName = new Map<string, { id: number; display: string }>();
        for (const t of teamRows) {
          if (t.apiFootballTeamId == null) continue;
          byName.set(normaliseForCron(t.nameEn), {
            id: t.apiFootballTeamId,
            display: t.nameEn,
          });
        }
        for (const row of champion) {
          const k = normaliseForCron(row.teamName);
          const team = byName.get(k);
          if (!team) {
            championUnmatched += 1;
            console.warn("[odds-sync champion unmatched]", {
              teamName: row.teamName,
            });
            continue;
          }
          // Only overwrite non-admin-override rows.
          const existing = await db
            .select({
              id: outrightOddsSnapshot.id,
              adminOverride: outrightOddsSnapshot.adminOverride,
            })
            .from(outrightOddsSnapshot)
            .where(
              sql`${outrightOddsSnapshot.surface} = 'champion'
                  and ${outrightOddsSnapshot.optionKind} = 'team'
                  and ${outrightOddsSnapshot.optionId} = ${team.id}`,
            )
            .limit(1);
          if (existing[0]?.adminOverride) {
            continue;
          }
          if (existing[0]) {
            await db
              .update(outrightOddsSnapshot)
              .set({
                decimalOdds: row.decimalOdds.toFixed(3),
                displayName: team.display,
                source: "the_odds_api",
                fetchedAt: new Date(),
              })
              .where(sql`${outrightOddsSnapshot.id} = ${existing[0].id}`);
          } else {
            await db.insert(outrightOddsSnapshot).values({
              surface: "champion",
              optionKind: "team",
              optionId: team.id,
              displayName: team.display,
              decimalOdds: row.decimalOdds.toFixed(3),
              source: "the_odds_api",
              fetchedAt: new Date(),
              adminOverride: false,
              notes: null,
            });
          }
          championUpdated += 1;
        }
      }
    } catch (err) {
      console.error("[odds-sync champion failed]", err);
    }

    const ms = Date.now() - startedAt;
    const report = {
      matchesScanned: rows.length,
      updated,
      unmatched,
      errored,
      championUpdated,
      championUnmatched,
      ms,
    };
    console.info("[odds-sync summary]", report);
    return NextResponse.json({ ok: true, report });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[odds-sync failed]", { err, ms: Date.now() - startedAt });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export const POST = GET;

// Local copy of the wrapper's name normaliser so this file doesn't
// import an internal. Mirrors src/lib/the-odds-api.ts — keep both in
// sync if the rule changes.
function normaliseForCron(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’'`´]/g, "")
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}
