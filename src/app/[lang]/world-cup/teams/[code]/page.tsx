import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { sql } from "drizzle-orm";
import { hasLocale, type Locale } from "../../../dictionaries";
import { Card, LabelCaps, SectionHeading } from "@/components/ui";
import { Flag } from "@/components/Flag";
import { getUser } from "@/lib/supabase/auth";
import { localePath } from "@/lib/paths";
import { formatDateTime } from "@/lib/format";
import { db } from "@/db";
import {
  fetchTeams,
  fetchSquad,
  fetchTeamStatistics,
  fetchTeamFixtures,
  type ApiTeam,
  type ApiPlayer,
  type ApiTeamStatistics,
  type ApiTeamFixture,
} from "@/lib/api-football-data";

// World-cup team drill-down. `[code]` is the 3-letter TLA we use across
// the app (e.g. BRA, GER, ARG). We look up the API-Football team id by
// matching the code against /teams?league=15&season=2026.
//
// Sections:
//   • Header: flag + name + group + tournament record (W/D/L)
//   • Squad: grouped by position
//   • Statistics: GF, GA, GD, clean sheets, last-5 form
//   • Fixtures: recent finals + scheduled upcoming
//
// All section components handle a `null` API response with an
// empty-state Card so this page stays useful for guests + pre-
// activation builds.

type LocalTeam = {
  code: string;
  nameHe: string;
  nameEn: string;
  flag: string;
  groupId: string | null;
};

async function getLocalTeam(code: string): Promise<LocalTeam | null> {
  const rows = await db.execute<LocalTeam>(sql`
    select code, name_he as "nameHe", name_en as "nameEn", flag, group_id as "groupId"
    from public.teams
    where code = ${code.toUpperCase()}
    limit 1
  `);
  const list = rows as unknown as LocalTeam[];
  return list[0] ?? null;
}

export default async function WorldCupTeamPage({
  params,
}: PageProps<"/[lang]/world-cup/teams/[code]">) {
  const { lang, code } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const isHebrew = locale === "he";
  const Chev = isHebrew ? ChevronLeft : ChevronRight;
  const upperCode = code.toUpperCase();

  const user = await getUser();
  if (!user) redirect(localePath(locale, "login"));

  const [local, apiTeams] = await Promise.all([
    getLocalTeam(upperCode),
    fetchTeams(),
  ]);

  // Resolve which API-Football team id matches this code. Fall back to
  // case-insensitive name match if the API's `code` field is null.
  const apiTeam = apiTeams ? findApiTeam(apiTeams, upperCode, local?.nameEn) : null;

  // Pull the per-team data in parallel (each is cached behind Next's
  // revalidate so repeat visits don't hit the API).
  const [squad, statistics, fixtures] = apiTeam
    ? await Promise.all([
        fetchSquad(apiTeam.apiId),
        fetchTeamStatistics(apiTeam.apiId),
        fetchTeamFixtures(apiTeam.apiId),
      ])
    : [null, null, null];

  const displayName = local
    ? isHebrew
      ? local.nameHe
      : local.nameEn
    : apiTeam?.name ?? upperCode;

  return (
    <section className="px-4 md:px-16 py-6 md:py-12 flex flex-col gap-6 md:gap-8 max-w-3xl mx-auto w-full pb-24">
      <header className="flex flex-col gap-3">
        <Link
          href={localePath(locale, "world-cup")}
          className="inline-flex items-center gap-1 text-sm text-on-surface-variant hover:text-on-surface w-fit"
        >
          <Chev className="h-4 w-4" strokeWidth={2} />
          {isHebrew ? "חזרה לאזור המונדיאל" : "Back to World Cup zone"}
        </Link>
        <div className="flex items-center gap-4">
          {local ? (
            <Flag code={local.code} size={56} />
          ) : apiTeam?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={apiTeam.logoUrl} alt="" width={56} height={56} className="rounded" />
          ) : (
            <div className="w-14 h-14 rounded bg-surface-container" aria-hidden />
          )}
          <div className="flex flex-col gap-1 min-w-0">
            <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-9 md:text-[40px] md:leading-[44px] font-bold text-primary truncate">
              {displayName}
            </h1>
            {local?.groupId && (
              <span className="text-sm text-on-surface-variant">
                {isHebrew ? "בית" : "Group"} {local.groupId}
              </span>
            )}
          </div>
        </div>
      </header>

      <StatisticsCard statistics={statistics} locale={locale} />

      <SquadSection squad={squad} locale={locale} />

      <FixturesSection
        fixtures={fixtures}
        locale={locale}
        thisTeamCode={local?.code ?? null}
      />
    </section>
  );
}

// ---------- sub-sections ----------

function StatisticsCard({
  statistics,
  locale,
}: {
  statistics: ApiTeamStatistics | null;
  locale: Locale;
}) {
  const isHebrew = locale === "he";
  if (!statistics) return null;
  const stats: Array<{ label: { he: string; en: string }; value: number | string }> = [
    { label: { he: "משחקים", en: "Played" }, value: statistics.played },
    { label: { he: "ניצחונות", en: "Wins" }, value: statistics.wins },
    { label: { he: "תיקו", en: "Draws" }, value: statistics.draws },
    { label: { he: "הפסדים", en: "Losses" }, value: statistics.losses },
    { label: { he: "שערים בעד", en: "Goals for" }, value: statistics.goalsFor },
    { label: { he: "שערים נגד", en: "Goals against" }, value: statistics.goalsAgainst },
    {
      label: { he: "הפרש שערים", en: "Goal diff" },
      value: (statistics.goalDifference > 0 ? "+" : "") + statistics.goalDifference,
    },
    { label: { he: "ללא ספיגה", en: "Clean sheets" }, value: statistics.cleanSheets },
  ];
  return (
    <Card className="p-5 md:p-6 flex flex-col gap-4">
      <SectionHeading as="h2" underline="thin">
        {isHebrew ? "סטטיסטיקות" : "Statistics"}
      </SectionHeading>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {stats.map((s) => (
          <div key={s.label.en} className="flex flex-col gap-1">
            <LabelCaps>{isHebrew ? s.label.he : s.label.en}</LabelCaps>
            <span className="font-[family-name:var(--font-score)] text-2xl font-bold tabular-nums">
              {s.value}
            </span>
          </div>
        ))}
      </div>
      {statistics.form && (
        <div className="flex flex-col gap-1.5 pt-3 border-t border-outline-variant">
          <LabelCaps>{isHebrew ? "5 משחקים אחרונים" : "Last 5 form"}</LabelCaps>
          <div className="flex items-center gap-1.5">
            {statistics.form.split("").map((r, i) => (
              <span
                key={i}
                className={`inline-flex items-center justify-center w-7 h-7 rounded text-xs font-bold ${
                  r === "W"
                    ? "bg-secondary-container text-on-secondary-container"
                    : r === "L"
                      ? "bg-error-container text-on-error-container"
                      : "bg-surface-container text-on-surface-variant"
                }`}
                aria-label={r === "W" ? "win" : r === "L" ? "loss" : "draw"}
              >
                {r}
              </span>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function SquadSection({
  squad,
  locale,
}: {
  squad: ApiPlayer[] | null;
  locale: Locale;
}) {
  const isHebrew = locale === "he";
  if (squad === null) {
    return (
      <section className="flex flex-col gap-3">
        <SectionHeading as="h2" underline="thin">
          {isHebrew ? "סגל הנבחרת" : "Squad"}
        </SectionHeading>
        <Card className="p-6 text-center text-on-surface-variant">
          {isHebrew
            ? "סגל הנבחרת עוד לא פורסם או ש-API-Football לא מופעל."
            : "Squad isn't out yet, or API-Football isn't live."}
        </Card>
      </section>
    );
  }
  if (squad.length === 0) return null;

  // Group by position so a tap-and-skim reader sees the structure.
  const positions: Array<{
    key: string;
    label: { he: string; en: string };
  }> = [
    { key: "Goalkeeper", label: { he: "שוערים", en: "Goalkeepers" } },
    { key: "Defender", label: { he: "הגנה", en: "Defenders" } },
    { key: "Midfielder", label: { he: "קישור", en: "Midfielders" } },
    { key: "Attacker", label: { he: "התקפה", en: "Attackers" } },
  ];
  const buckets = new Map<string, ApiPlayer[]>();
  for (const pos of positions) buckets.set(pos.key, []);
  const other: ApiPlayer[] = [];
  for (const p of squad) {
    const bucket = buckets.get(p.position ?? "");
    if (bucket) bucket.push(p);
    else other.push(p);
  }

  return (
    <section className="flex flex-col gap-4">
      <SectionHeading as="h2" underline="thin">
        {isHebrew ? `סגל הנבחרת (${squad.length})` : `Squad (${squad.length})`}
      </SectionHeading>
      {positions
        .filter((p) => (buckets.get(p.key)?.length ?? 0) > 0)
        .map((p) => (
          <PositionBucket
            key={p.key}
            title={isHebrew ? p.label.he : p.label.en}
            players={buckets.get(p.key) ?? []}
          />
        ))}
      {other.length > 0 && (
        <PositionBucket
          title={isHebrew ? "אחר" : "Other"}
          players={other}
        />
      )}
    </section>
  );
}

function PositionBucket({
  title,
  players,
}: {
  title: string;
  players: ApiPlayer[];
}) {
  return (
    <div className="flex flex-col gap-2">
      <LabelCaps>{title}</LabelCaps>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {players.map((p) => (
          <Card key={p.apiId} className="p-3 flex items-center gap-3">
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
              <span className="block text-xs text-on-surface-variant truncate">
                {[p.number ? `#${p.number}` : null, p.age ? `${p.age}` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function FixturesSection({
  fixtures,
  locale,
  thisTeamCode,
}: {
  fixtures: ApiTeamFixture[] | null;
  locale: Locale;
  thisTeamCode: string | null;
}) {
  const isHebrew = locale === "he";
  if (fixtures === null || fixtures.length === 0) return null;

  // Sort by kickoff. Show 5 most-recent finals first, then upcoming.
  const finals = fixtures
    .filter((f) => f.status === "FT" || f.status === "AET" || f.status === "PEN")
    .sort((a, b) => b.kickoffAt.localeCompare(a.kickoffAt))
    .slice(0, 5);
  const upcoming = fixtures
    .filter((f) => f.status === "NS" || f.status === "TBD")
    .sort((a, b) => a.kickoffAt.localeCompare(b.kickoffAt))
    .slice(0, 5);

  return (
    <section className="flex flex-col gap-4">
      <SectionHeading as="h2" underline="thin">
        {isHebrew ? "משחקים" : "Fixtures"}
      </SectionHeading>
      {finals.length > 0 && (
        <FixturesList
          title={isHebrew ? "אחרונים" : "Recent"}
          rows={finals}
          locale={locale}
          thisTeamCode={thisTeamCode}
        />
      )}
      {upcoming.length > 0 && (
        <FixturesList
          title={isHebrew ? "הבאים" : "Upcoming"}
          rows={upcoming}
          locale={locale}
          thisTeamCode={thisTeamCode}
        />
      )}
    </section>
  );
}

function FixturesList({
  title,
  rows,
  locale,
  thisTeamCode,
}: {
  title: string;
  rows: ApiTeamFixture[];
  locale: Locale;
  thisTeamCode: string | null;
}) {
  const isHebrew = locale === "he";
  return (
    <div className="flex flex-col gap-2">
      <LabelCaps>{title}</LabelCaps>
      <div className="flex flex-col gap-2">
        {rows.map((f) => {
          const isHome = thisTeamCode === f.homeCode;
          const opponent = isHome ? f.awayName : f.homeName;
          const opponentCode = isHome ? f.awayCode : f.homeCode;
          const isFinal = f.homeScore !== null && f.awayScore !== null;
          return (
            <Card
              key={f.fixtureId}
              className="p-3 flex items-center justify-between gap-3"
            >
              <div className="flex items-center gap-2 min-w-0">
                {opponentCode && <Flag code={opponentCode} size={24} />}
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-bold truncate">
                    {isHome ? (isHebrew ? "מארחת" : "vs") : (isHebrew ? "אצל" : "@")}{" "}
                    {opponent}
                  </span>
                  <span className="text-xs text-on-surface-variant tabular-nums">
                    {formatDateTime(f.kickoffAt, locale, {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              </div>
              {isFinal ? (
                <span className="font-[family-name:var(--font-score)] text-lg font-bold tabular-nums bidi-ltr">
                  {f.homeScore}-{f.awayScore}
                </span>
              ) : (
                <LabelCaps>{isHebrew ? "מתוכנן" : "Scheduled"}</LabelCaps>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ---------- helpers ----------

function findApiTeam(
  apiTeams: ApiTeam[],
  code: string,
  nameEn: string | undefined,
): ApiTeam | null {
  const byCode = apiTeams.find((t) => t.code === code);
  if (byCode) return byCode;
  if (nameEn) {
    const lower = nameEn.toLowerCase();
    return apiTeams.find((t) => t.name.toLowerCase() === lower) ?? null;
  }
  return null;
}
