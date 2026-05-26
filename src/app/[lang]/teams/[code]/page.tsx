import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Calendar, Users, Trophy } from "lucide-react";
import {
  getTeamByCode,
  getTeamMatches,
  getLiveStandings,
  type TeamMatchRow,
  type LiveStandingRow,
} from "@/db/queries";
import { getUser } from "@/lib/supabase/auth";
import { Card, LabelCaps, SectionHeading } from "@/components/ui";
import { Flag } from "@/components/Flag";
import { localePath } from "@/lib/paths";
import { formatDateTime } from "@/lib/format";
import { hasLocale, type Locale } from "../../dictionaries";

export default async function TeamPage({
  params,
}: PageProps<"/[lang]/teams/[code]">) {
  const { lang, code } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;

  const user = await getUser();
  if (!user) redirect(localePath(locale, "login"));

  const team = await getTeamByCode(code);
  if (!team) notFound();

  const [matches, liveGroups] = await Promise.all([
    getTeamMatches(team.code),
    getLiveStandings(),
  ]);
  const isHebrew = locale === "he";
  const displayName = isHebrew ? team.nameHe : team.nameEn;

  // Find this team's row in its group standings, if any.
  const groupRow: LiveStandingRow | null =
    team.groupId
      ? (liveGroups.find((g) => g.id === team.groupId)?.rows.find(
          (r) => r.code === team.code,
        ) ?? null)
      : null;

  const upcoming = matches.filter((m) => m.status !== "final");
  const past = matches.filter((m) => m.status === "final");

  return (
    <section className="px-4 md:px-16 py-6 md:py-12 flex flex-col gap-6 md:gap-8 max-w-3xl mx-auto w-full">
      <header className="flex items-center gap-4">
        <Flag code={team.code} size={64} />
        <div className="flex flex-col gap-1 min-w-0">
          <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-9 md:text-[44px] md:leading-[48px] font-bold text-on-surface truncate">
            {displayName}
          </h1>
          <div className="flex items-center gap-2 flex-wrap">
            {team.groupId && (
              <Link
                href={`${localePath(locale, "tournament")}?tab=tables`}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface-variant text-on-surface text-xs font-bold hover:bg-surface-container transition-colors"
              >
                <Trophy
                  className="h-3.5 w-3.5 text-tertiary-fixed-dim"
                  strokeWidth={2}
                />
                {isHebrew ? "בית" : "Group"} <bdi>{team.groupId}</bdi>
              </Link>
            )}
            <span className="text-sm text-on-surface-variant font-[family-name:var(--font-label)] tracking-[0.05em]">
              <bdi>{team.code}</bdi>
            </span>
          </div>
        </div>
      </header>

      {groupRow && groupRow.played > 0 && (
        <Card className="p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <SectionHeading as="h2" underline="thin">
              {isHebrew ? "מאזן" : "Record"}
            </SectionHeading>
            <LabelCaps>
              {isHebrew ? "מקום" : "Position"}{" "}
              <bdi className="text-base font-bold text-on-surface">
                {groupRow.position}
              </bdi>
            </LabelCaps>
          </div>
          <div className="grid grid-cols-4 sm:grid-cols-7 gap-2 text-center">
            <Stat label={isHebrew ? "משחקים" : "P"} value={groupRow.played} />
            <Stat label={isHebrew ? "ניצחונות" : "W"} value={groupRow.won} tone="good" />
            <Stat label={isHebrew ? "תיקו" : "D"} value={groupRow.drawn} />
            <Stat label={isHebrew ? "הפסדים" : "L"} value={groupRow.lost} tone="bad" />
            <Stat label={isHebrew ? "ש׳ זכות" : "GF"} value={groupRow.goalsFor} />
            <Stat label={isHebrew ? "ש׳ חובה" : "GA"} value={groupRow.goalsAgainst} />
            <Stat
              label={isHebrew ? "נק׳" : "Pts"}
              value={groupRow.points}
              big
            />
          </div>
        </Card>
      )}

      {upcoming.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionHeading as="h2" underline="thin">
            {isHebrew ? "משחקים קרובים" : "Upcoming"}
          </SectionHeading>
          <ul className="flex flex-col gap-2">
            {upcoming.map((m) => (
              <MatchRow
                key={m.matchId}
                m={m}
                locale={locale}
                isHebrew={isHebrew}
              />
            ))}
          </ul>
        </section>
      )}

      {past.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionHeading as="h2" underline="thin">
            {isHebrew ? "תוצאות" : "Results"}
          </SectionHeading>
          <ul className="flex flex-col gap-2">
            {past.map((m) => (
              <MatchRow
                key={m.matchId}
                m={m}
                locale={locale}
                isHebrew={isHebrew}
              />
            ))}
          </ul>
        </section>
      )}

      {matches.length === 0 && (
        <Card className="p-6 text-center text-on-surface-variant">
          {isHebrew
            ? "אין עדיין משחקים מתוזמנים לנבחרת זו."
            : "No matches scheduled for this team yet."}
        </Card>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  tone,
  big,
}: {
  label: string;
  value: number;
  tone?: "good" | "bad";
  big?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5 min-w-0">
      <LabelCaps>{label}</LabelCaps>
      <span
        className={`font-[family-name:var(--font-display)] ${big ? "text-2xl text-surface-tint" : "text-lg"} leading-none font-bold bidi-ltr ${
          tone === "good"
            ? "text-secondary"
            : tone === "bad"
              ? "text-error"
              : big
                ? "text-surface-tint"
                : "text-on-surface"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function MatchRow({
  m,
  locale,
  isHebrew,
}: {
  m: TeamMatchRow;
  locale: Locale;
  isHebrew: boolean;
}) {
  const opponentName = isHebrew ? m.opponentNameHe : m.opponentNameEn;
  const kickoff = formatDateTime(m.kickoffAt, locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const stageLabel = labelStage(m.stage, m.groupId, isHebrew);
  const isFinal = m.status === "final";
  const won =
    isFinal && m.goalsFor != null && m.goalsAgainst != null
      ? m.goalsFor > m.goalsAgainst
      : null;
  const drawn =
    isFinal && m.goalsFor != null && m.goalsAgainst != null
      ? m.goalsFor === m.goalsAgainst
      : null;

  return (
    <li>
      <Link
        href={localePath(locale, `bets/${m.matchId}`)}
        className="flex items-center gap-3 p-3 rounded-lg border border-outline-variant bg-surface-container-lowest hover:bg-surface-container transition-colors min-h-[56px]"
      >
        <Flag code={m.opponentCode} size={28} />
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-sm font-bold text-on-surface truncate">
            {isHebrew ? (m.isHome ? "נגד " : "אצל ") : m.isHome ? "vs " : "@ "}
            {opponentName}
          </span>
          <span className="text-xs text-on-surface-variant inline-flex items-center gap-1.5">
            <Calendar className="h-3 w-3" strokeWidth={2} />
            <span>{kickoff}</span>
            <span className="text-outline">·</span>
            {stageLabel}
          </span>
        </div>
        {isFinal && m.goalsFor != null && m.goalsAgainst != null ? (
          <span
            className={`font-[family-name:var(--font-score)] text-lg leading-none font-bold bidi-ltr shrink-0 ${
              won === true
                ? "text-secondary"
                : drawn === true
                  ? "text-on-surface-variant"
                  : "text-error"
            }`}
          >
            {m.goalsFor} - {m.goalsAgainst}
            {m.wentToPenalties && (
              <span className="text-xs ms-1 text-on-surface-variant">
                {isHebrew ? "(פנדלים)" : "(pen)"}
              </span>
            )}
          </span>
        ) : (
          <LabelCaps>{isHebrew ? "מתוזמן" : "Scheduled"}</LabelCaps>
        )}
      </Link>
    </li>
  );
}

function labelStage(
  stage: string,
  groupId: string | null,
  isHebrew: boolean,
): string {
  if (stage === "group" && groupId) {
    return `${isHebrew ? "בית" : "Group"} ${groupId}`;
  }
  const map: Record<string, [string, string]> = {
    r32: ["שלב 32", "Round of 32"],
    r16: ["שמינית", "Round of 16"],
    qf: ["רבע גמר", "Quarter-final"],
    sf: ["חצי גמר", "Semi-final"],
    third_place: ["משחק על המקום ה-3", "Third-place play-off"],
    final: ["גמר", "Final"],
  };
  const pair = map[stage];
  return pair ? pair[isHebrew ? 0 : 1] : stage;
}
