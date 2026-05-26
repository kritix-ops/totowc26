import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, ChevronRight, Target, Trophy, Users } from "lucide-react";
import { sql } from "drizzle-orm";
import { hasLocale, type Locale } from "../dictionaries";
import { Card, LabelCaps, SectionHeading } from "@/components/ui";
import { Flag } from "@/components/Flag";
import { getUser } from "@/lib/supabase/auth";
import { localePath } from "@/lib/paths";
import { db } from "@/db";
import {
  fetchTeams,
  fetchTopScorers,
  fetchTopAssists,
  type ApiTeam,
  type ApiScorer,
} from "@/lib/api-football-data";

// "אזור המונדיאל" — a read-only, data-rich entry point. Every section
// pulls from API-Football and re-renders behind Next's revalidate cache
// (1h for tournament-wide endpoints, 24h for slowly-changing teams) so
// repeated visits never hit our 7,500/day quota.
//
// When API_FOOTBALL_KEY isn't set, fetchers return null and each section
// shows an empty-state card. The page still renders cleanly for guests
// and pre-activation states.

type LocalTeam = {
  code: string;
  nameHe: string;
  nameEn: string;
  flag: string;
  groupId: string | null;
};

async function getLocalTeams(): Promise<Map<string, LocalTeam>> {
  const rows = await db.execute<LocalTeam>(sql`
    select code, name_he as "nameHe", name_en as "nameEn", flag, group_id as "groupId"
    from public.teams
    order by code asc
  `);
  const list = rows as unknown as LocalTeam[];
  const map = new Map<string, LocalTeam>();
  for (const t of list) map.set(t.code, t);
  return map;
}

export default async function WorldCupPage({
  params,
}: PageProps<"/[lang]/world-cup">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const isHebrew = locale === "he";

  const user = await getUser();
  if (!user) redirect(localePath(locale, "login"));

  const [teamsApi, scorers, assists, localTeams] = await Promise.all([
    fetchTeams(),
    fetchTopScorers(),
    fetchTopAssists(),
    getLocalTeams(),
  ]);

  return (
    <section className="px-4 md:px-16 py-6 md:py-12 flex flex-col gap-8 md:gap-10 max-w-5xl mx-auto w-full pb-24">
      <header className="flex flex-col gap-2">
        <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-9 md:text-[48px] md:leading-[52px] font-bold text-primary inline-flex items-center gap-3">
          <Trophy className="h-7 w-7 md:h-9 md:w-9 text-tertiary-fixed-dim" strokeWidth={1.75} />
          {isHebrew ? "אזור המונדיאל" : "World Cup zone"}
        </h1>
        <p className="text-sm md:text-base text-on-surface-variant">
          {isHebrew
            ? "סגלים, מובילים, סטטיסטיקות וכל הנתונים על נבחרות הטורניר. הנתונים מתעדכנים מ-API-Football במהלך הטורניר."
            : "Squads, leaders, statistics, and every angle on the tournament's national teams. Live from API-Football."}
        </p>
      </header>

      {/* Teams grid */}
      <section className="flex flex-col gap-4">
        <SectionHeading as="h2" underline="thin">
          <span className="inline-flex items-center gap-2">
            <Users className="h-5 w-5 text-tertiary-fixed-dim" strokeWidth={1.75} />
            {isHebrew ? "נבחרות" : "Teams"}
          </span>
        </SectionHeading>
        {teamsApi === null ? (
          <StubBanner locale={locale} />
        ) : teamsApi.length === 0 ? (
          <Card className="p-6 text-center text-on-surface-variant">
            {isHebrew ? "אין נבחרות בטורניר עדיין." : "No teams in the tournament yet."}
          </Card>
        ) : (
          <TeamsGrid
            apiTeams={teamsApi}
            localTeams={localTeams}
            locale={locale}
          />
        )}
      </section>

      {/* Top scorers */}
      <section className="flex flex-col gap-4">
        <SectionHeading as="h2" underline="thin">
          <span className="inline-flex items-center gap-2">
            <Target className="h-5 w-5 text-tertiary-fixed-dim" strokeWidth={1.75} />
            {isHebrew ? "מלכי השערים" : "Top scorers"}
          </span>
        </SectionHeading>
        <ScorersList
          rows={scorers}
          locale={locale}
          localTeams={localTeams}
          metric="goals"
        />
      </section>

      {/* Top assists */}
      <section className="flex flex-col gap-4">
        <SectionHeading as="h2" underline="thin">
          <span className="inline-flex items-center gap-2">
            <Target className="h-5 w-5 text-tertiary-fixed-dim" strokeWidth={1.75} />
            {isHebrew ? "מלכי הבישולים" : "Top assists"}
          </span>
        </SectionHeading>
        <ScorersList
          rows={assists}
          locale={locale}
          localTeams={localTeams}
          metric="assists"
        />
      </section>
    </section>
  );
}

// ---------- subviews ----------

function TeamsGrid({
  apiTeams,
  localTeams,
  locale,
}: {
  apiTeams: ApiTeam[];
  localTeams: Map<string, LocalTeam>;
  locale: Locale;
}) {
  const isHebrew = locale === "he";
  const Chev = isHebrew ? ChevronLeft : ChevronRight;

  // Sort: teams with a known local match first (so user sees flags / Hebrew
  // names up top), then by API name.
  const sorted = [...apiTeams].sort((a, b) => {
    const aLocal = a.code ? localTeams.has(a.code) : false;
    const bLocal = b.code ? localTeams.has(b.code) : false;
    if (aLocal && !bLocal) return -1;
    if (!aLocal && bLocal) return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
      {sorted.map((t) => {
        const local = t.code ? localTeams.get(t.code) : undefined;
        const displayName = local
          ? isHebrew
            ? local.nameHe
            : local.nameEn
          : t.name;
        return (
          <Link
            key={t.apiId}
            href={localePath(locale, `world-cup/teams/${t.code ?? t.apiId}`)}
            className="press-down block"
          >
            <Card className="p-4 flex items-center gap-3 hover:bg-surface-container transition-colors min-h-[72px]">
              {local ? (
                <Flag code={local.code} size={36} />
              ) : t.logoUrl ? (
                // Fallback to API's logo when we don't have a local flag.
                // Using <img> intentionally; these are small remote PNGs and
                // pre-configuring Next image domains for one external host
                // for v1 isn't worth the next.config.ts churn.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={t.logoUrl}
                  alt=""
                  width={36}
                  height={36}
                  className="rounded"
                />
              ) : (
                <div className="w-9 h-9 rounded bg-surface-container" aria-hidden />
              )}
              <div className="flex-1 min-w-0">
                <span className="block font-bold text-sm text-on-surface truncate">
                  {displayName}
                </span>
                {local?.groupId && (
                  <LabelCaps>
                    {isHebrew ? "בית" : "Group"} {local.groupId}
                  </LabelCaps>
                )}
              </div>
              <Chev className="h-4 w-4 text-outline shrink-0" strokeWidth={2} />
            </Card>
          </Link>
        );
      })}
    </div>
  );
}

function ScorersList({
  rows,
  locale,
  localTeams,
  metric,
}: {
  rows: ApiScorer[] | null;
  locale: Locale;
  localTeams: Map<string, LocalTeam>;
  metric: "goals" | "assists";
}) {
  const isHebrew = locale === "he";
  if (rows === null) return <StubBanner locale={locale} />;
  if (rows.length === 0) {
    return (
      <Card className="p-6 text-center text-on-surface-variant">
        {isHebrew
          ? "עוד אין נתונים. ימולא ברגע שייפתח הטורניר."
          : "No data yet. Fills in once the tournament starts."}
      </Card>
    );
  }
  const top = rows.slice(0, 10);
  return (
    <ol className="flex flex-col gap-2">
      {top.map((p, idx) => {
        const local = p.teamCode ? localTeams.get(p.teamCode) : undefined;
        const teamLabel = local
          ? isHebrew
            ? local.nameHe
            : local.nameEn
          : p.teamName;
        const value = metric === "goals" ? p.goals : p.assists;
        const valueLabel = isHebrew
          ? metric === "goals" ? "שערים" : "בישולים"
          : metric === "goals" ? "goals" : "assists";
        return (
          <li key={p.apiId}>
            <Card className="p-3 md:p-4 flex items-center gap-3">
              <span className="font-[family-name:var(--font-score)] text-lg font-bold tabular-nums w-7 text-center text-on-surface-variant">
                {idx + 1}
              </span>
              {p.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={p.photoUrl}
                  alt=""
                  width={40}
                  height={40}
                  className="rounded-full bg-surface-container"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-surface-container" aria-hidden />
              )}
              <div className="flex-1 min-w-0">
                <span className="block font-bold text-sm text-on-surface truncate">
                  {p.name}
                </span>
                <span className="inline-flex items-center gap-1.5 mt-0.5">
                  {local && <Flag code={local.code} size={16} />}
                  <span className="text-xs text-on-surface-variant truncate">
                    {teamLabel}
                  </span>
                </span>
              </div>
              <div className="text-end">
                <span className="block font-[family-name:var(--font-score)] text-xl font-bold tabular-nums">
                  {value}
                </span>
                <LabelCaps>{valueLabel}</LabelCaps>
              </div>
            </Card>
          </li>
        );
      })}
    </ol>
  );
}

function StubBanner({ locale }: { locale: Locale }) {
  const isHebrew = locale === "he";
  return (
    <Card className="p-5 border-2 border-tertiary-fixed-dim/30 bg-tertiary-fixed text-on-tertiary-fixed-variant">
      <p className="text-sm">
        {isHebrew
          ? "API-Football עוד לא מופעל. הוסף API_FOOTBALL_KEY ב-Vercel ובדף הזה יתחילו להופיע נתונים."
          : "API-Football isn't live yet. Add API_FOOTBALL_KEY in Vercel and data will start showing here."}
      </p>
    </Card>
  );
}
