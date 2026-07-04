import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { sql } from "drizzle-orm";
import { Calendar, History, ListChecks } from "lucide-react";
import { getDictionary, hasLocale, type Locale } from "../dictionaries";
import { Card } from "@/components/ui";
import { PayGateBanner } from "@/components/PayGateBanner";
import { getRequestUser } from "@/lib/request-user";
import { getUserAccess } from "@/lib/access";
import { execRows } from "@/db/helpers";
import { db } from "@/db";
import { settings as settingsTable } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getBetLockMinutes, getPastMatchPicks } from "@/db/queries";
import { formatDateTime } from "@/lib/format";
import { localePath } from "@/lib/paths";
import { BetsTabs } from "@/components/BetsTabs";
import { BetsSubTabs, parseBetsView } from "@/components/BetsSubTabs";
import { SurpriseMeButton } from "@/components/SurpriseMeButton";
import { QuickPickRow, type QuickPickRowData } from "./QuickPickRow";
import { PastMatchPickRow } from "./PastMatchPickRow";

// /bets is the quick-fill picks page. One scrollable list of every
// scheduled match across the whole tournament so the user can fill
// scores end-to-end without drilling into /play/[date]/[matchId] for
// each fixture. As new stages unlock (R16, QF, etc.) those fixtures
// flow into the same list automatically because the underlying query
// just asks "every match with status='scheduled' and kickoff_at > now".
//
// /play stays the date-organised hub with live bets, tournament bets,
// and group rankings. /bets is the speed-run alternative.

type GroupedDay = {
  date: string;
  label: string;
  matches: QuickPickRowData[];
};

// Cap server-side execution well below Vercel's 300s default. A render — or a
// quick-pick Server Action on this page, maxDuration covers both — that stalls
// on a saturated DB pool fails fast into a retryable error at 25s instead of
// squatting five minutes (the recurring "loading forever" fall). 25s is far
// above any legitimate work here. See
// _plans/2026-06-23-prod-falls-reliability-fix.md.
export const maxDuration = 25;

export default async function QuickBetsPage({
  params,
  searchParams,
}: PageProps<"/[lang]/bets">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const dict = await getDictionary(locale);
  const isHebrew = locale === "he";

  const sp = await searchParams;
  const view = parseBetsView(sp.view);

  const user = await getRequestUser();
  if (!user) redirect(localePath(locale, "login"));
  const access = await getUserAccess(user.id);

  if (view === "past") {
    return (
      <PastView
        locale={locale}
        dict={dict}
        userId={user.id}
        isHebrew={isHebrew}
      />
    );
  }

  const [matches, lockMinutes, scoringRow] = await Promise.all([
    loadEditableMatches(user.id),
    getBetLockMinutes(),
    db
      .select({
        scoringExact: settingsTable.scoringExact,
        scoringOutcome: settingsTable.scoringOutcome,
        scoringAdvance: settingsTable.scoringAdvance,
        matchRiskEnabled: settingsTable.matchRiskEnabled,
        matchRiskPenalty: settingsTable.matchRiskPenalty,
      })
      .from(settingsTable)
      .where(eq(settingsTable.id, 1))
      .then((rows) => rows[0]),
  ]);
  const scoring = {
    exact: scoringRow?.scoringExact ?? 15,
    outcome: scoringRow?.scoringOutcome ?? 5,
    advance: scoringRow?.scoringAdvance ?? 10,
    riskEnabled: scoringRow?.matchRiskEnabled ?? false,
    penalty: scoringRow?.matchRiskPenalty ?? 5,
  };

  // Group by Asia/Jerusalem matchday. Days are already in order from
  // the query.
  const grouped = new Map<string, GroupedDay>();
  for (const m of matches) {
    const key = m.matchDate;
    if (!grouped.has(key)) {
      grouped.set(key, {
        date: key,
        label: formatDateTime(`${key}T12:00:00Z`, locale, {
          weekday: "long",
          day: "numeric",
          month: "long",
        }),
        matches: [],
      });
    }
    grouped.get(key)!.matches.push(m);
  }
  const days = [...grouped.values()];

  return (
    <section className="px-4 md:px-16 py-6 md:py-12 flex flex-col gap-6 md:gap-8 max-w-3xl mx-auto w-full pb-24">
      <header className="flex flex-col gap-3">
        <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-9 md:text-[40px] md:leading-[44px] font-bold text-primary">
          {isHebrew ? "הימורים" : "Bets"}
        </h1>
        <BetsTabs locale={locale} active="match-picks" />
        <BetsSubTabs locale={locale} path="bets" view="upcoming" />
        <h2 className="font-[family-name:var(--font-display)] text-lg md:text-xl font-bold text-on-surface inline-flex items-center gap-2 mt-2">
          <ListChecks className="h-5 w-5" strokeWidth={1.75} />
          {dict.quickBets.title}
        </h2>
        <p className="text-sm text-on-surface-variant">
          {dict.quickBets.subtitle}
        </p>
        {/* Compact scoring-rules hint. Lives once at the top of the
            page so the per-row Quick-pick cards stay tight. Each
            scoring delta is rendered as a small chip with its sign
            colour-coded the same way PickScenarios does it. */}
        <div className="flex flex-wrap items-center gap-2 text-xs text-on-surface-variant pt-1">
          <span className="font-bold">
            {isHebrew ? "ניקוד:" : "Scoring:"}
          </span>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-success-container text-on-success-container tabular-nums">
            <span>
              {isHebrew ? "פגיעה" : "Exact"}
            </span>
            <bdi className="font-bold">+{scoring.exact}</bdi>
          </span>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-success-container text-on-success-container tabular-nums">
            <span>
              {isHebrew ? "כיוון" : "Direction"}
            </span>
            <bdi className="font-bold">+{scoring.outcome}</bdi>
          </span>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-success-container text-on-success-container tabular-nums">
            <span>
              {isHebrew ? "מי עולה" : "Who advances"}
            </span>
            <bdi className="font-bold">+{scoring.advance}</bdi>
          </span>
          {scoring.riskEnabled ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-error-container text-on-error-container tabular-nums">
              <span>
                {isHebrew ? "טעות" : "Wrong"}
              </span>
              <bdi className="font-bold">-{scoring.penalty}</bdi>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-container-high text-on-surface-variant tabular-nums">
              <span>
                {isHebrew ? "טעות" : "Wrong"}
              </span>
              <bdi className="font-bold">0</bdi>
            </span>
          )}
        </div>
      </header>

      {!access.canEdit && <PayGateBanner locale={locale} dict={dict} />}

      {access.canEdit &&
        matches.some((m) => m.myHomeScore === null || m.myAwayScore === null) && (
          <SurpriseMeButton locale={locale} target={{ surface: "matches" }} />
        )}

      {matches.length === 0 ? (
        <Card className="p-6 text-center text-on-surface-variant">
          {dict.quickBets.empty}
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          {days.map((day) => (
            <section key={day.date} className="flex flex-col gap-3">
              <h2 className="font-[family-name:var(--font-display)] text-lg md:text-xl font-bold text-on-surface inline-flex items-center gap-2">
                <Calendar className="h-4 w-4 text-tertiary-fixed-dim" strokeWidth={1.75} />
                {day.label}
              </h2>
              <ul className="flex flex-col gap-3">
                {day.matches.map((m) => (
                  <li key={m.id}>
                    <QuickPickRow
                      locale={locale}
                      dict={dict}
                      match={m}
                      lockMinutes={lockMinutes}
                      canEdit={access.canEdit}
                      advancePoints={scoring.advance}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <Card className="p-4 md:p-5 text-sm text-on-surface-variant bg-tertiary-fixed text-on-tertiary-fixed-variant border border-tertiary-fixed-dim">
        <p>
          {dict.quickBets.hint}{" "}
          <Link
            href={localePath(locale, "bets/live")}
            className="underline font-bold"
          >
            {isHebrew ? "להימורי לייב" : "to the live-bets hub"}
          </Link>
          .
        </p>
      </Card>
    </section>
  );
}

async function loadEditableMatches(userId: string): Promise<QuickPickRowData[]> {
  return execRows<QuickPickRowData>(sql`
    -- A single real fixture can exist as two public.matches rows: a duplicate
    -- created when a knockout fixture was ingested via both the legacy
    -- football-data path (api_fixture_id) and the API-Football path
    -- (api_football_fixture_id). Left unguarded, the same match renders as two
    -- identical cards. Collapse to one row per fixture, preferring the row
    -- where THIS user already has a pick (never hide someone's bet) and then
    -- the canonical API-Football row (where results and grading land).
    -- Root cause + data cleanup: _plans/2026-07-04-duplicate-knockout-fixtures.md
    with deduped as (
      select distinct on (m.home_team, m.away_team, m.kickoff_at)
        m.id, m.home_team, m.away_team, m.kickoff_at, m.stage, m.group_id,
        mb.home_score as my_home_score,
        mb.away_score as my_away_score,
        ab.team       as my_advance_team
      from public.matches m
      left join public.match_bets mb on mb.match_id = m.id and mb.user_id = ${userId}
      left join public.match_advance_bets ab on ab.match_id = m.id and ab.user_id = ${userId}
      where m.status = 'scheduled'
        and m.kickoff_at > now() + interval '5 minutes'
      order by m.home_team, m.away_team, m.kickoff_at,
        (mb.match_id is null and ab.match_id is null),
        (m.api_football_fixture_id is null),
        m.id
    )
    select
      m.id::text                                                        as "id",
      m.home_team                                                       as "homeCode",
      ht.name_he                                                        as "homeNameHe",
      ht.name_en                                                        as "homeNameEn",
      m.away_team                                                       as "awayCode",
      at.name_he                                                        as "awayNameHe",
      at.name_en                                                        as "awayNameEn",
      m.kickoff_at::text                                                as "kickoffAt",
      m.stage::text                                                     as "stage",
      m.group_id                                                        as "groupId",
      to_char((m.kickoff_at at time zone 'Asia/Jerusalem')::date,
              'YYYY-MM-DD')                                             as "matchDate",
      m.my_home_score                                                   as "myHomeScore",
      m.my_away_score                                                   as "myAwayScore",
      m.my_advance_team                                                 as "myAdvanceTeam"
    from deduped m
    join public.teams ht on ht.code = m.home_team
    join public.teams at on at.code = m.away_team
    order by m.kickoff_at asc
    limit 200
  `);
}

// /bets?view=past — read-only history of every match that has kicked
// off (live or final), including ones the caller didn't pick. Grouped
// by Asia/Jerusalem matchday like the upcoming view, but ordered
// newest-first so the most recent matches sit at the top of the page.
async function PastView({
  locale,
  dict,
  userId,
  isHebrew,
}: {
  locale: Locale;
  dict: Awaited<ReturnType<typeof getDictionary>>;
  userId: string;
  isHebrew: boolean;
}) {
  let matches: Awaited<ReturnType<typeof getPastMatchPicks>> = [];
  try {
    matches = await getPastMatchPicks(userId);
  } catch (err) {
    console.error("[bets past] match-picks load threw", { userId, err });
  }
  console.info("[bets past] match-picks loaded", {
    userId,
    rowCount: matches.length,
    view: "past",
  });

  // Group newest-day-first so the latest matchday's results appear at
  // the top. Within a day, order DESC by kickoff so the last match of
  // the night sits above the first.
  type Day = {
    date: string;
    label: string;
    matches: typeof matches;
  };
  const grouped = new Map<string, Day>();
  for (const m of matches) {
    const key = m.matchDate;
    if (!grouped.has(key)) {
      grouped.set(key, {
        date: key,
        label: formatDateTime(m.kickoffAt, locale, {
          weekday: "long",
          day: "numeric",
          month: "long",
        }),
        matches: [],
      });
    }
    grouped.get(key)!.matches.push(m);
  }
  const days = [...grouped.values()];

  return (
    <section className="px-4 md:px-16 py-6 md:py-12 flex flex-col gap-6 md:gap-8 max-w-3xl mx-auto w-full pb-24">
      <header className="flex flex-col gap-3">
        <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-9 md:text-[40px] md:leading-[44px] font-bold text-primary">
          {isHebrew ? "הימורים" : "Bets"}
        </h1>
        <BetsTabs locale={locale} active="match-picks" />
        <BetsSubTabs locale={locale} path="bets" view="past" />
        <h2 className="font-[family-name:var(--font-display)] text-lg md:text-xl font-bold text-on-surface inline-flex items-center gap-2 mt-2">
          <History className="h-5 w-5" strokeWidth={1.75} />
          {dict.pastBets.matchPicksTitle}
        </h2>
        <p className="text-sm text-on-surface-variant">
          {dict.pastBets.matchPicksSubtitle}
        </p>
      </header>

      {matches.length === 0 ? (
        <Card className="p-6 text-center text-on-surface-variant">
          {dict.pastBets.matchPicksEmpty}
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          {days.map((day) => (
            <section key={day.date} className="flex flex-col gap-3">
              <h2 className="font-[family-name:var(--font-display)] text-lg md:text-xl font-bold text-on-surface inline-flex items-center gap-2">
                <Calendar
                  className="h-4 w-4 text-tertiary-fixed-dim"
                  strokeWidth={1.75}
                />
                {day.label}
              </h2>
              <ul className="flex flex-col gap-3">
                {day.matches.map((m) => (
                  <li key={m.id}>
                    <PastMatchPickRow locale={locale} dict={dict} match={m} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
