import Link from "next/link";
import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import { Calendar, Trophy, Ambulance, UserRound, Shirt } from "lucide-react";
import {
  getTeamByCode,
  getTeamMatches,
  getLiveStandings,
  type TeamMatchRow,
  type LiveStandingRow,
} from "@/db/queries";
import { getRequestUser } from "@/lib/request-user";
import {
  getTeamSquad,
  getTeamCoach,
  getTeamStats,
  getTeamInjuries,
} from "@/lib/stats";
import type { ApiPlayer } from "@/lib/api-football-data";
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

  const user = await getRequestUser();
  if (!user) redirect(localePath(locale, "login"));

  const team = await getTeamByCode(code);
  if (!team) notFound();

  const [matches, liveGroups, squad, coach, apiStats, teamInjuries] = await Promise.all([
    getTeamMatches(team.code),
    getLiveStandings(),
    getTeamSquad(team.code),
    getTeamCoach(team.code),
    getTeamStats(team.code),
    getTeamInjuries(team.code),
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
            <Stat label={isHebrew ? "ש' זכות" : "GF"} value={groupRow.goalsFor} />
            <Stat label={isHebrew ? "ש' חובה" : "GA"} value={groupRow.goalsAgainst} />
            <Stat
              label={isHebrew ? "נק'" : "Pts"}
              value={groupRow.points}
              big
            />
          </div>
        </Card>
      )}

      {coach && <CoachCard coach={coach} isHebrew={isHebrew} />}

      {apiStats && apiStats.played > 0 && (
        <Card className="p-5 flex flex-col gap-3">
          <SectionHeading as="h2" underline="thin">
            {isHebrew ? "סטטיסטיקת עונה" : "Season stats"}
          </SectionHeading>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            <Stat
              label={isHebrew ? "ללא ספיגה" : "Clean sheets"}
              value={apiStats.cleanSheets}
              tone="good"
            />
            <Stat
              label={isHebrew ? "לא הבקיעו" : "Failed to score"}
              value={apiStats.failedToScore}
              tone="bad"
            />
            <Stat
              label={isHebrew ? "ש' ממוצע" : "Goals avg"}
              value={apiStats.played > 0 ? Math.round((apiStats.goalsFor / apiStats.played) * 10) / 10 : 0}
            />
            <Stat
              label={isHebrew ? "צורה" : "Form"}
              valueText={apiStats.form || "—"}
            />
          </div>
        </Card>
      )}

      {squad && squad.length > 0 && (
        <SquadGrid squad={squad} isHebrew={isHebrew} />
      )}

      {teamInjuries && teamInjuries.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionHeading as="h2" underline="thin">
            <span className="inline-flex items-center gap-2">
              <Ambulance className="h-5 w-5 text-error" strokeWidth={1.75} />
              {isHebrew ? "פציעות והרחקות" : "Injuries & suspensions"}
            </span>
          </SectionHeading>
          <Card className="p-0 overflow-hidden">
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-outline-variant">
              {teamInjuries.map((inj, i) => (
                <li
                  key={`${inj.playerName}-${i}`}
                  className="bg-surface-container-lowest"
                >
                  <div className="flex items-center gap-3 px-4 py-3 min-h-[56px]">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-on-surface truncate">
                        {inj.playerName}
                      </div>
                      <div className="text-xs text-on-surface-variant truncate">
                        {inj.reason}
                      </div>
                    </div>
                    {inj.type && <LabelCaps>{inj.type}</LabelCaps>}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </section>
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
  valueText,
  tone,
  big,
}: {
  label: string;
  value?: number;
  valueText?: string;
  tone?: "good" | "bad";
  big?: boolean;
}) {
  const display = valueText ?? String(value ?? 0);
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
        {display}
      </span>
    </div>
  );
}

// Coach card - small avatar, name, nationality and start year (when known).
// Falls back to a plain user icon if API-Football didn't send a photo URL.
function CoachCard({
  coach,
  isHebrew,
}: {
  coach: { name: string; photoUrl: string | null; nationality: string | null; age: number | null; startYear: number | null };
  isHebrew: boolean;
}) {
  return (
    <section className="flex flex-col gap-3">
      <SectionHeading as="h2" underline="thin">
        {isHebrew ? "מאמן הנבחרת" : "Head coach"}
      </SectionHeading>
      <Card className="p-4 flex items-center gap-4 min-h-[80px]">
        {coach.photoUrl ? (
          <Image
            src={coach.photoUrl}
            alt={coach.name}
            width={56}
            height={56}
            className="rounded-full border border-outline-variant bg-surface-container"
            unoptimized
          />
        ) : (
          <div className="w-14 h-14 rounded-full bg-surface-container flex items-center justify-center">
            <UserRound className="h-7 w-7 text-on-surface-variant" strokeWidth={1.5} />
          </div>
        )}
        <div className="flex flex-col min-w-0">
          <span className="text-base font-bold text-on-surface truncate">
            {coach.name}
          </span>
          <span className="text-xs text-on-surface-variant truncate">
            {[
              coach.nationality,
              coach.age ? `${coach.age}${isHebrew ? " ש'" : "y"}` : null,
              coach.startYear ? `${isHebrew ? "מ-" : "since "}${coach.startYear}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
      </Card>
    </section>
  );
}

// Squad grid - groups players by position (GK / DEF / MID / ATT), renders
// each as a small avatar card with jersey number, name, age. Photos come
// from API-Football's media CDN - we set `unoptimized` so next/image
// doesn't try to proxy them. Falls back to a Shirt glyph when there's no
// photo URL.
function SquadGrid({
  squad,
  isHebrew,
}: {
  squad: ApiPlayer[];
  isHebrew: boolean;
}) {
  // Position buckets - API returns strings like "Goalkeeper" / "Defender" /
  // "Midfielder" / "Attacker"; we keep that order so the card reads from
  // back to front.
  const orderKey = (p: ApiPlayer): number => {
    switch (p.position) {
      case "Goalkeeper": return 0;
      case "Defender":   return 1;
      case "Midfielder": return 2;
      case "Attacker":   return 3;
      default:           return 4;
    }
  };
  const buckets: Array<{ key: string; label: string; players: ApiPlayer[] }> = [
    { key: "Goalkeeper", label: isHebrew ? "שוערים"  : "Goalkeepers", players: [] },
    { key: "Defender",   label: isHebrew ? "הגנה"   : "Defenders",   players: [] },
    { key: "Midfielder", label: isHebrew ? "קישור"  : "Midfielders", players: [] },
    { key: "Attacker",   label: isHebrew ? "התקפה"  : "Attackers",   players: [] },
    { key: "Other",      label: isHebrew ? "אחר"    : "Other",       players: [] },
  ];
  const sorted = [...squad].sort((a, b) => orderKey(a) - orderKey(b));
  for (const p of sorted) {
    const i = buckets.findIndex((b) => b.key === p.position);
    if (i >= 0) buckets[i].players.push(p);
    else buckets[4].players.push(p);
  }

  return (
    <section className="flex flex-col gap-3">
      <SectionHeading as="h2" underline="thin">
        <span className="inline-flex items-center gap-2">
          <Shirt className="h-5 w-5 text-tertiary-fixed-dim" strokeWidth={1.75} />
          {isHebrew ? "סגל הנבחרת" : "Squad"}
        </span>
      </SectionHeading>
      <div className="flex flex-col gap-4">
        {buckets
          .filter((b) => b.players.length > 0)
          .map((b) => (
            <div key={b.key} className="flex flex-col gap-2">
              <LabelCaps>{b.label}</LabelCaps>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {b.players.map((p) => (
                  <PlayerCard key={p.apiId} player={p} isHebrew={isHebrew} />
                ))}
              </div>
            </div>
          ))}
      </div>
    </section>
  );
}

function PlayerCard({
  player,
  isHebrew,
}: {
  player: ApiPlayer;
  isHebrew: boolean;
}) {
  return (
    <Card className="p-2 flex items-center gap-2 min-h-[64px]">
      {player.photoUrl ? (
        <Image
          src={player.photoUrl}
          alt={player.name}
          width={44}
          height={44}
          className="rounded-full border border-outline-variant bg-surface-container shrink-0"
          unoptimized
        />
      ) : (
        <div className="w-11 h-11 rounded-full bg-surface-container flex items-center justify-center shrink-0">
          <Shirt className="h-5 w-5 text-on-surface-variant" strokeWidth={1.5} />
        </div>
      )}
      <div className="flex flex-col min-w-0 flex-1">
        <span className="text-sm font-bold text-on-surface truncate">
          {player.name}
        </span>
        <span className="text-[11px] text-on-surface-variant truncate">
          {player.number != null && (
            <span className="font-bold me-1 bidi-ltr">#{player.number}</span>
          )}
          {player.age != null
            ? `${player.age}${isHebrew ? " ש'" : "y"}`
            : ""}
        </span>
      </div>
    </Card>
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
