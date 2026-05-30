import Link from "next/link";
import {
  Goal,
  ShieldCheck,
  Trophy,
  ArrowUpRight,
  Square,
  Ambulance,
} from "lucide-react";
import { Card, LabelCaps, ScoreLine, SectionHeading } from "@/components/ui";
import { Flag } from "@/components/Flag";
import { localePath } from "@/lib/paths";
import { formatDateTime } from "@/lib/format";
import { getLiveStandings, type LiveGroup } from "@/db/queries";
import {
  getGoalsPerDay,
  getLiveTopScorers,
  getLiveTopAssists,
  getLiveTopYellowCards,
  getLiveInjuries,
  getRecentResults,
  getTournamentSummary,
  type GoalsPerDay,
  type LiveScorer,
  type LiveAssister,
  type LiveCardLeader,
  type LiveInjury,
  type RecentResult,
  type TournamentSummary,
} from "@/lib/stats";
import { getDictionary, type Locale, type Dictionary } from "../dictionaries";

// The default tab: the at-a-glance picture of the tournament right now.
// Aggregates summary stats, the most recent results, top scorers + assists +
// yellow cards, an injury banner, group leaders, and a goals-per-day mini
// chart. Heavier full-table and team browsing live in their own tabs.

export async function SummaryTab({ locale }: { locale: Locale }) {
  const [
    summary,
    scorers,
    assists,
    yellows,
    injuries,
    recent,
    perDay,
    standings,
    dict,
  ] = await Promise.all([
    getTournamentSummary(),
    getLiveTopScorers(10),
    getLiveTopAssists(10),
    getLiveTopYellowCards(10),
    getLiveInjuries(12),
    getRecentResults(8),
    getGoalsPerDay(),
    getLiveStandings(),
    getDictionary(locale),
  ]);
  const isHebrew = locale === "he";

  return (
    <div className="flex flex-col gap-6 md:gap-10">
      <SummaryStrip summary={summary} isHebrew={isHebrew} />

      {injuries.length > 0 && (
        <InjuriesBanner injuries={injuries} dict={dict} />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 md:gap-10">
        <div className="lg:col-span-7 flex flex-col gap-6 md:gap-10">
          <RecentResultsList
            results={recent}
            locale={locale}
            isHebrew={isHebrew}
          />
          <GoalsChart perDay={perDay} isHebrew={isHebrew} />
        </div>
        <div className="lg:col-span-5 flex flex-col gap-6 md:gap-10">
          <TopScorersCard scorers={scorers} locale={locale} isHebrew={isHebrew} />
          <TopAssistsCard assists={assists} locale={locale} dict={dict} />
          <TopYellowCardsCard yellows={yellows} locale={locale} dict={dict} />
          <StandingsPreview
            standings={standings}
            locale={locale}
            isHebrew={isHebrew}
          />
        </div>
      </div>
    </div>
  );
}

function InjuriesBanner({
  injuries,
  dict,
}: {
  injuries: LiveInjury[];
  dict: Dictionary;
}) {
  return (
    <section className="flex flex-col gap-3">
      <SectionHeading as="h2" underline="thin">
        <span className="inline-flex items-center gap-2">
          <Ambulance className="h-5 w-5 text-error" strokeWidth={1.75} />
          {dict.tournament.injuriesHeading}
        </span>
      </SectionHeading>
      <Card className="p-0 overflow-hidden">
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-outline-variant">
          {injuries.map((inj, i) => (
            <li key={`${inj.playerName}-${i}`} className="bg-surface-container-lowest">
              <div className="flex items-center gap-3 px-4 py-3 min-h-[56px]">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-on-surface truncate">
                    {inj.playerName}
                  </div>
                  <div className="text-xs text-on-surface-variant truncate">
                    {inj.teamName} {inj.reason ? `· ${inj.reason}` : ""}
                  </div>
                </div>
                {inj.type ? (
                  <LabelCaps>
                    {inj.type}
                  </LabelCaps>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </Card>
      <p className="text-[11px] text-on-surface-variant text-center">
        {dict.tournament.injuriesPoweredBy}
      </p>
    </section>
  );
}

function TopAssistsCard({
  assists,
  locale,
  dict,
}: {
  assists: LiveAssister[];
  locale: Locale;
  dict: Dictionary;
}) {
  return (
    <section className="flex flex-col gap-3">
      <SectionHeading as="h2" underline="thin">
        <span className="inline-flex items-center gap-2">
          <Goal className="h-5 w-5 text-tertiary-fixed-dim" strokeWidth={1.75} />
          {dict.tournament.topAssistsHeading}
        </span>
      </SectionHeading>
      <Card className="p-0 overflow-hidden">
        {assists.length === 0 ? (
          <p className="text-sm text-on-surface-variant text-center py-6 px-4">
            {dict.tournament.topAssistsEmpty}
          </p>
        ) : (
          <ol className="flex flex-col">
            {assists.map((s, i) => (
              <li
                key={`${s.name}-${i}`}
                className={`flex items-center gap-3 px-4 py-3 min-h-[52px] ${
                  i > 0 ? "border-t border-outline-variant" : ""
                }`}
              >
                <span className="font-[family-name:var(--font-display)] font-bold text-on-surface w-5 text-center bidi-ltr">
                  {s.rank}
                </span>
                {s.teamCode ? (
                  <Link
                    href={localePath(locale, `teams/${s.teamCode}`)}
                    aria-label={s.teamName}
                  >
                    <Flag code={s.teamCode} size={20} />
                  </Link>
                ) : (
                  <span className="w-5 h-5" aria-hidden />
                )}
                <span className="flex-1 min-w-0 text-sm font-bold text-on-surface truncate">
                  {s.name}
                </span>
                {s.goals > 0 && (
                  <span className="text-xs text-on-surface-variant whitespace-nowrap bidi-ltr">
                    {s.goals}
                    {dict.tournament.topAssistsGoalsHint}
                  </span>
                )}
                <span className="font-[family-name:var(--font-display)] text-lg leading-none font-bold text-surface-tint bidi-ltr">
                  {s.assists}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </section>
  );
}

function TopYellowCardsCard({
  yellows,
  locale,
  dict,
}: {
  yellows: LiveCardLeader[];
  locale: Locale;
  dict: Dictionary;
}) {
  return (
    <section className="flex flex-col gap-3">
      <SectionHeading as="h2" underline="thin">
        <span className="inline-flex items-center gap-2">
          <Square className="h-4 w-4 text-yellow-500 fill-yellow-400" strokeWidth={1.75} />
          {dict.tournament.topYellowsHeading}
        </span>
      </SectionHeading>
      <Card className="p-0 overflow-hidden">
        {yellows.length === 0 ? (
          <p className="text-sm text-on-surface-variant text-center py-6 px-4">
            {dict.tournament.topYellowsEmpty}
          </p>
        ) : (
          <ol className="flex flex-col">
            {yellows.map((s, i) => (
              <li
                key={`${s.name}-${i}`}
                className={`flex items-center gap-3 px-4 py-3 min-h-[52px] ${
                  i > 0 ? "border-t border-outline-variant" : ""
                }`}
              >
                <span className="font-[family-name:var(--font-display)] font-bold text-on-surface w-5 text-center bidi-ltr">
                  {s.rank}
                </span>
                {s.teamCode ? (
                  <Link
                    href={localePath(locale, `teams/${s.teamCode}`)}
                    aria-label={s.teamName}
                  >
                    <Flag code={s.teamCode} size={20} />
                  </Link>
                ) : (
                  <span className="w-5 h-5" aria-hidden />
                )}
                <span className="flex-1 min-w-0 text-sm font-bold text-on-surface truncate">
                  {s.name}
                </span>
                {s.red > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-xs text-error font-bold bidi-ltr">
                    <span className="inline-block w-2.5 h-3 bg-error rounded-[1px]" />
                    {s.red}
                  </span>
                )}
                <span className="inline-flex items-center gap-0.5 font-[family-name:var(--font-display)] text-lg leading-none font-bold text-on-surface bidi-ltr">
                  <span className="inline-block w-2.5 h-3 bg-yellow-400 rounded-[1px]" />
                  {s.yellow}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </section>
  );
}

function SummaryStrip({
  summary,
  isHebrew,
}: {
  summary: TournamentSummary;
  isHebrew: boolean;
}) {
  const items: Array<{ label: string; value: string; tone?: "primary" }> = [
    {
      label: isHebrew ? "משחקים שוחקו" : "Played",
      value: `${summary.playedMatches} / ${summary.totalMatches}`,
    },
    {
      label: isHebrew ? "סה\"כ שערים" : "Goals",
      value: String(summary.totalGoals),
      tone: "primary",
    },
    {
      label: isHebrew ? "ממוצע למשחק" : "Avg / match",
      value: summary.avgGoalsPerMatch.toFixed(2),
    },
    {
      label: isHebrew ? "תיקו" : "Draws",
      value: String(summary.drawCount),
    },
    {
      label: isHebrew ? "ללא ספיגה" : "Clean sheets",
      value: String(summary.cleanSheets),
    },
  ];
  return (
    <Card className="p-4 md:p-5">
      <ul className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        {items.map((i) => (
          <li
            key={i.label}
            className="flex flex-col items-center text-center gap-0.5"
          >
            <LabelCaps>{i.label}</LabelCaps>
            <span
              className={`font-[family-name:var(--font-display)] text-2xl md:text-3xl leading-none font-bold bidi-ltr ${
                i.tone === "primary" ? "text-surface-tint" : "text-on-surface"
              }`}
            >
              {i.value}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function RecentResultsList({
  results,
  locale,
  isHebrew,
}: {
  results: RecentResult[];
  locale: Locale;
  isHebrew: boolean;
}) {
  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-end justify-between gap-3">
        <SectionHeading as="h2" underline="thin">
          {isHebrew ? "תוצאות אחרונות" : "Recent results"}
        </SectionHeading>
        <Link
          href={localePath(locale, "bets/live")}
          className="inline-flex items-center gap-1 font-[family-name:var(--font-label)] text-[12px] font-bold tracking-[0.05em] text-primary hover:underline"
        >
          {isHebrew ? "כל המשחקים" : "All matches"}
          <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2} />
        </Link>
      </header>
      {results.length === 0 ? (
        <Card className="p-6 text-center text-on-surface-variant text-sm">
          {isHebrew
            ? "טרם הסתיים אף משחק. חוזרים אחרי שריקת הפתיחה."
            : "No matches finished yet. Come back after kickoff."}
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {results.map((r) => (
            <li key={r.matchId}>
              <Link
                href={localePath(locale, `match/${r.matchId}`)}
                className="flex items-center gap-3 p-3 rounded-lg border border-outline-variant bg-surface-container-lowest hover:bg-surface-container transition-colors min-h-[56px]"
              >
                <span className="text-xs text-on-surface-variant whitespace-nowrap">
                  {formatDateTime(r.finalizedAt ?? r.kickoffAt, locale, {
                    day: "numeric",
                    month: "short",
                  })}
                </span>
                <TeamLine
                  code={r.homeCode}
                  name={isHebrew ? r.homeNameHe : r.homeNameEn}
                  align="end"
                />
                <span className="font-[family-name:var(--font-score)] text-lg leading-none font-bold text-on-surface px-2 shrink-0 flex flex-col items-center">
                  <ScoreLine home={r.homeScore} away={r.awayScore} />
                  {r.wentToPenalties && (
                    <span className="block text-[10px] text-on-surface-variant font-bold tracking-wide">
                      {isHebrew ? "פנדלים" : "PEN"}
                    </span>
                  )}
                </span>
                <TeamLine
                  code={r.awayCode}
                  name={isHebrew ? r.awayNameHe : r.awayNameEn}
                  align="start"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TeamLine({
  code,
  name,
  align,
}: {
  code: string;
  name: string;
  align: "start" | "end";
}) {
  return (
    <span
      className={`flex items-center gap-2 flex-1 min-w-0 ${
        align === "end" ? "justify-end text-end" : "justify-start"
      }`}
    >
      {align === "end" && (
        <span className="font-bold text-sm text-on-surface truncate">{name}</span>
      )}
      <Flag code={code} size={20} />
      {align === "start" && (
        <span className="font-bold text-sm text-on-surface truncate">{name}</span>
      )}
    </span>
  );
}

function GoalsChart({
  perDay,
  isHebrew,
}: {
  perDay: GoalsPerDay[];
  isHebrew: boolean;
}) {
  return (
    <section className="flex flex-col gap-3">
      <SectionHeading as="h2" underline="thin">
        <span className="inline-flex items-center gap-2">
          <Goal className="h-5 w-5 text-tertiary-fixed-dim" strokeWidth={1.75} />
          {isHebrew ? "שערים פר יום" : "Goals per day"}
        </span>
      </SectionHeading>
      <Card className="p-5">
        {perDay.length === 0 ? (
          <p className="text-sm text-on-surface-variant text-center py-6">
            {isHebrew
              ? "אין עוד נתונים. הגרף יתחיל למלא מהמשחק הראשון שמסתיים."
              : "No data yet. The chart fills in from the first finished match."}
          </p>
        ) : (
          <GoalsBars perDay={perDay} isHebrew={isHebrew} />
        )}
      </Card>
    </section>
  );
}

function GoalsBars({
  perDay,
  isHebrew,
}: {
  perDay: GoalsPerDay[];
  isHebrew: boolean;
}) {
  const max = Math.max(...perDay.map((d) => d.goals), 1);
  const total = perDay.reduce((s, d) => s + d.goals, 0);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end gap-1.5 h-32 overflow-x-auto snap-x snap-mandatory pb-1">
        {perDay.map((d) => {
          const h = Math.round((d.goals / max) * 100);
          return (
            <div
              key={d.day}
              className="flex flex-col items-center justify-end snap-start shrink-0 min-w-[36px]"
              title={`${d.day}: ${d.goals} ${isHebrew ? "שערים ב" : "goals in"} ${d.matches} ${isHebrew ? "משחקים" : "matches"}`}
            >
              <span className="text-[10px] font-bold text-on-surface-variant mb-1 bidi-ltr">
                {d.goals}
              </span>
              <div
                className="w-7 bg-primary rounded-t"
                style={{ height: `${Math.max(h, 6)}%` }}
              />
              <span className="text-[10px] text-on-surface-variant mt-1 bidi-ltr whitespace-nowrap">
                {d.day.slice(5)}
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-on-surface-variant text-center">
        {isHebrew
          ? `סה"כ ${total} שערים על פני ${perDay.length} ימי משחק`
          : `${total} goals across ${perDay.length} match days`}
      </p>
    </div>
  );
}

function TopScorersCard({
  scorers,
  locale,
  isHebrew,
}: {
  scorers: LiveScorer[];
  locale: Locale;
  isHebrew: boolean;
}) {
  return (
    <section className="flex flex-col gap-3">
      <SectionHeading as="h2" underline="thin">
        <span className="inline-flex items-center gap-2">
          <Trophy className="h-5 w-5 text-tertiary-fixed-dim" strokeWidth={1.75} />
          {isHebrew ? "מלכי השערים" : "Top scorers"}
        </span>
      </SectionHeading>
      <Card className="p-0 overflow-hidden">
        {scorers.length === 0 ? (
          <p className="text-sm text-on-surface-variant text-center py-6 px-4">
            {isHebrew
              ? "טבלת המבקיעים תופיע כשיהיו שערים."
              : "Standings appear once goals are scored."}
          </p>
        ) : (
          <ol className="flex flex-col">
            {scorers.map((s, i) => (
              <li
                key={`${s.name}-${i}`}
                className={`flex items-center gap-3 px-4 py-3 min-h-[52px] ${
                  i > 0 ? "border-t border-outline-variant" : ""
                }`}
              >
                <span className="font-[family-name:var(--font-display)] font-bold text-on-surface w-5 text-center bidi-ltr">
                  {s.rank}
                </span>
                {s.teamCode ? (
                  <Link
                    href={localePath(locale, `teams/${s.teamCode}`)}
                    aria-label={s.teamName}
                  >
                    <Flag code={s.teamCode} size={20} />
                  </Link>
                ) : (
                  <span className="w-5 h-5" aria-hidden />
                )}
                <span className="flex-1 min-w-0 text-sm font-bold text-on-surface truncate">
                  {s.name}
                </span>
                {s.assists > 0 && (
                  <span className="text-xs text-on-surface-variant whitespace-nowrap bidi-ltr">
                    {s.assists} {isHebrew ? "בישולים" : "ast"}
                  </span>
                )}
                <span className="font-[family-name:var(--font-display)] text-lg leading-none font-bold text-surface-tint bidi-ltr">
                  {s.goals}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Card>
      <p className="text-[11px] text-on-surface-variant text-center">
        {isHebrew
          ? "מתעדכן כל שעה מ-football-data.org"
          : "Refreshed hourly via football-data.org"}
      </p>
    </section>
  );
}

function StandingsPreview({
  standings,
  locale,
  isHebrew,
}: {
  standings: LiveGroup[];
  locale: Locale;
  isHebrew: boolean;
}) {
  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-end justify-between gap-3">
        <SectionHeading as="h2" underline="thin">
          <span className="inline-flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" strokeWidth={1.75} />
            {isHebrew ? "ראש כל בית" : "Group leaders"}
          </span>
        </SectionHeading>
        <Link
          href={`${localePath(locale, "tournament")}?tab=tables`}
          className="inline-flex items-center gap-1 font-[family-name:var(--font-label)] text-[12px] font-bold tracking-[0.05em] text-primary hover:underline"
        >
          {isHebrew ? "כל הטבלאות" : "Full tables"}
          <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2} />
        </Link>
      </header>
      <Card className="p-0 overflow-hidden">
        <ul className="grid grid-cols-2 gap-px bg-outline-variant">
          {standings.map((g) => {
            const leader = g.rows[0];
            if (!leader) return null;
            return (
              <li key={g.id} className="bg-surface-container-lowest">
                <Link
                  href={localePath(locale, `teams/${leader.code}`)}
                  className="flex items-center gap-2 px-3 py-2 min-h-[52px] hover:bg-surface-container transition-colors"
                >
                  <span className="font-[family-name:var(--font-label)] text-[11px] font-bold tracking-[0.05em] text-on-surface-variant shrink-0">
                    <bdi>{g.id}</bdi>
                  </span>
                  <Flag code={leader.code} size={18} />
                  <span className="flex-1 min-w-0 text-sm font-bold text-on-surface truncate">
                    {isHebrew ? leader.nameHe : leader.nameEn}
                  </span>
                  <span className="font-[family-name:var(--font-display)] text-base leading-none font-bold text-surface-tint bidi-ltr shrink-0">
                    {leader.points}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </Card>
    </section>
  );
}
