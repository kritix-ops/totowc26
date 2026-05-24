import Link from "next/link";
import Image from "next/image";
import { ArrowUpRight, CircleDollarSign, Sparkles, Trophy, Users } from "lucide-react";
import { clsx } from "clsx";
import { notFound } from "next/navigation";
import { getDictionary, hasLocale, type Locale } from "./dictionaries";
import { localePath } from "@/lib/paths";
import { BrandLogo } from "@/components/BrandLogo";
import { InstallHint } from "@/components/InstallHint";
import { getUser } from "@/lib/supabase/auth";
import {
  getLatestFinalForUser,
  getLeaderboard,
  getMyRankSummary,
  getPointsTrend,
  getPoolStats,
  getTournamentStart,
  getUpcomingFixtures,
  type FixtureWithMyBet,
  type LeaderboardEntry,
} from "@/db/queries";
import {
  Card,
  Chip,
  LabelCaps,
  ScoreDigit,
  SectionHeading,
} from "@/components/ui";
import { Flag } from "@/components/Flag";

export default async function HomePage({
  params,
}: PageProps<"/[lang]">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const dict = await getDictionary(locale);
  const isHebrew = locale === "he";
  const displayFont = isHebrew
    ? "font-[family-name:var(--font-display)]"
    : "font-[family-name:var(--font-display-en)]";

  const user = await getUser();
  const signedIn = !!user;

  // Hero data is public — no user required.
  const [pool, tournamentStart] = await Promise.all([
    getPoolStats(),
    getTournamentStart(),
  ]);

  // Dashboard data is per-user; only fetch it when there's a signed-in user.
  const dashboard = signedIn
    ? await loadDashboard(user!.id)
    : null;

  console.info("[home render]", {
    signedIn,
    potIls: pool.potIls,
    participants: pool.participants,
    tournamentStart,
    hasDashboard: !!dashboard,
  });

  const countdown = tournamentStart ? computeCountdown(tournamentStart) : null;

  return (
    <section className="relative flex flex-col items-stretch">
      <div className="relative w-full h-[220px] sm:h-[320px] md:h-[440px] lg:h-[520px] overflow-hidden">
        <Image
          src="/hero.png"
          alt={isHebrew ? "כוכבי המונדיאל" : "World Cup legends"}
          fill
          priority
          sizes="100vw"
          className="object-cover object-center"
        />
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-b from-transparent via-background/40 to-background pointer-events-none"
        />
      </div>

      <div className="relative z-10 -mt-12 md:-mt-20 px-4 md:px-16 flex justify-center">
        <div className="w-full max-w-2xl bg-surface-container-low p-6 md:p-10 border border-outline rounded-lg shadow-[0_8px_32px_rgba(28,20,15,0.12)] flex flex-col gap-6 md:gap-8 text-start">
          <div className="flex justify-center -mt-2">
            <BrandLogo locale={locale} size="hero" />
          </div>

          {countdown && (
            <div className="flex flex-col gap-3 md:gap-5">
              <p className="font-[family-name:var(--font-label)] text-[12px] font-bold tracking-[0.1em] uppercase text-surface-tint">
                {countdown.started
                  ? isHebrew ? "המונדיאל בעיצומו" : "Tournament underway"
                  : dict.landing.countdownLabel}
              </p>
              {!countdown.started && (
                <div className="flex items-baseline gap-4 md:gap-6 flex-wrap">
                  <CountdownUnit
                    n={String(countdown.days).padStart(2, "0")}
                    label={dict.landing.days}
                    displayFont={displayFont}
                  />
                  <span
                    aria-hidden
                    className={`${displayFont} text-[28px] md:text-[48px] leading-none text-outline-variant`}
                  >
                    ·
                  </span>
                  <CountdownUnit
                    n={String(countdown.hours).padStart(2, "0")}
                    label={dict.landing.hours}
                    displayFont={displayFont}
                  />
                </div>
              )}
            </div>
          )}

          {!signedIn && (
            <p
              className={`${displayFont} text-xl md:text-[26px] leading-8 md:leading-9 text-on-surface max-w-md`}
            >
              {dict.landing.tagline}
            </p>
          )}

          {!signedIn && (
            <div>
              <Link
                href={localePath(locale, "login")}
                className="press-down inline-flex items-center justify-center bg-primary text-on-primary font-[family-name:var(--font-label)] text-[14px] font-bold tracking-[0.05em] px-10 py-4 min-h-[48px] rounded-full shadow-md hover:bg-surface-tint hover:-translate-y-0.5 transition-all duration-200"
              >
                {dict.landing.cta}
              </Link>
            </div>
          )}

          <InstallHint locale={locale as "he" | "en"} />

          <div className="pt-5 md:pt-6 border-t border-outline-variant flex flex-col gap-3">
            <p className="font-[family-name:var(--font-label)] text-[12px] font-bold tracking-[0.05em] text-on-surface-variant">
              {dict.landing.friendsPoolLabel}
            </p>
            <div className="flex flex-wrap gap-2 md:gap-3">
              <span className="text-sm md:text-base text-on-surface bg-surface-variant px-3 py-1.5 rounded-full border border-outline-variant inline-flex items-center gap-2">
                <CircleDollarSign className="h-4 w-4 text-surface-tint shrink-0" strokeWidth={1.75} />
                <span>{dict.landing.potLabel}:</span>
                <bdi className="font-bold">
                  {pool.potIls.toLocaleString(isHebrew ? "he-IL" : "en-US")}{" "}
                  {dict.common.currency}
                </bdi>
              </span>
              <span className="text-sm md:text-base text-on-surface bg-surface-variant px-3 py-1.5 rounded-full border border-outline-variant inline-flex items-center gap-2">
                <Users className="h-4 w-4 text-surface-tint shrink-0" strokeWidth={1.75} />
                <bdi className="font-bold">{pool.participants}</bdi>
                <span>{dict.landing.participantsLabel}</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {dashboard && (
        <DashboardBlock
          locale={locale}
          dict={dict}
          data={dashboard}
        />
      )}

      {!signedIn && <div className="pb-10 md:pb-20" />}
    </section>
  );
}

type DashboardData = Awaited<ReturnType<typeof loadDashboard>>;

async function loadDashboard(userId: string) {
  const [upcoming, lastFinal, rankInfo, trend, board] = await Promise.all([
    getUpcomingFixtures(userId, 6),
    getLatestFinalForUser(userId),
    getMyRankSummary(userId),
    getPointsTrend(userId),
    getLeaderboard(userId),
  ]);
  return { upcoming, lastFinal, rankInfo, trend, board };
}

function DashboardBlock({
  locale,
  dict,
  data,
}: {
  locale: Locale;
  dict: Awaited<ReturnType<typeof getDictionary>>;
  data: DashboardData;
}) {
  const { upcoming, lastFinal, rankInfo, trend, board } = data;
  const isHebrew = locale === "he";
  const trendForChart = trend.length > 0 ? trend : [0, 0];
  const leaderboardPreview = buildLeaderboardPreview(board);

  return (
    <section className="px-4 md:px-16 pt-10 md:pt-16 pb-10 md:pb-20 flex flex-col gap-8 md:gap-12">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-6">
        <h2 className="font-[family-name:var(--font-display)] text-[28px] leading-9 md:text-[40px] md:leading-[44px] font-bold text-primary">
          {dict.dashboard.welcome}
        </h2>
        <div className="flex gap-4">
          <Card className="px-6 py-4 text-center">
            <LabelCaps as="div" className="mb-1">{dict.dashboard.myRankLabel}</LabelCaps>
            <div className="font-[family-name:var(--font-display)] text-[28px] md:text-[32px] leading-none font-bold text-surface-tint">
              <span className="bidi-ltr">{rankInfo.myRank || "—"}</span>{" "}
              <span className="text-[18px] text-on-surface-variant">
                {dict.dashboard.ofTotal} <span className="bidi-ltr">{rankInfo.total}</span>
              </span>
            </div>
          </Card>
          <Card className="px-6 py-4 text-center">
            <LabelCaps as="div" className="mb-1">{dict.dashboard.gapToLeader}</LabelCaps>
            <div className="font-[family-name:var(--font-display)] text-[28px] md:text-[32px] leading-none font-bold text-surface-tint">
              <span className="bidi-ltr">{rankInfo.gapToLeader}</span>{" "}
              <span className="text-[18px] text-on-surface-variant">{dict.common.points}</span>
            </div>
          </Card>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
        <div className="lg:col-span-7 flex flex-col gap-12">
          <section className="flex flex-col gap-6">
            <div className="flex justify-between items-end">
              <SectionHeading>{dict.dashboard.upcomingTitle}</SectionHeading>
              <Link
                href={localePath(locale, "bets")}
                className="font-[family-name:var(--font-label)] text-[12px] font-bold tracking-[0.05em] text-primary hover:underline inline-flex items-center gap-1"
              >
                {dict.dashboard.viewAll}
                <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2} />
              </Link>
            </div>
            {upcoming.length === 0 ? (
              <EmptyMatches isHebrew={isHebrew} />
            ) : (
              <div className="flex overflow-x-auto gap-4 pb-2 snap-x snap-mandatory -mx-4 px-4 md:mx-0 md:px-0">
                {upcoming.slice(0, 3).map((m, idx) => (
                  <UpcomingCard
                    key={m.id}
                    match={m}
                    idx={idx}
                    locale={locale}
                    dict={dict}
                  />
                ))}
              </div>
            )}
          </section>

          <Card className="p-6">
            <SectionHeading underline="thin" as="h3" className="mb-4">
              {dict.dashboard.pointsTrend}
            </SectionHeading>
            <Sparkline trend={trendForChart} />
            <div className="flex justify-between mt-3">
              {trendForChart.map((_, i) => (
                <LabelCaps key={i} className={i === trendForChart.length - 1 ? "text-primary" : ""}>
                  {dict.dashboard.matchday} <span className="bidi-ltr">{i + 1}</span>
                </LabelCaps>
              ))}
            </div>
          </Card>
        </div>

        <div className="lg:col-span-5 flex flex-col gap-12">
          <section className="flex flex-col gap-6">
            <SectionHeading>{dict.dashboard.lastBetTitle}</SectionHeading>
            {lastFinal ? (
              <LastBetCard match={lastFinal} locale={locale} dict={dict} />
            ) : (
              <Card className="p-6 text-center text-on-surface-variant">
                {isHebrew
                  ? "אין עדיין משחקים שהסתיימו"
                  : "No finished matches yet"}
              </Card>
            )}
          </section>

          <Link
            href={localePath(locale, "specials")}
            className="press-down group block"
          >
            <Card className="p-5 flex items-center gap-4 min-h-[64px] hover:bg-surface-container transition-colors">
              <div className="w-11 h-11 rounded-full bg-tertiary-container flex items-center justify-center shrink-0">
                <Sparkles className="h-5 w-5 text-on-tertiary-container" strokeWidth={1.75} />
              </div>
              <div className="flex flex-col min-w-0 flex-1">
                <span className="font-bold text-base text-on-surface">
                  {isHebrew ? "הימורי על הטורניר" : "Tournament specials"}
                </span>
                <span className="text-sm text-on-surface-variant truncate">
                  {isHebrew
                    ? "מלך השערים · פנדלים בגמר"
                    : "Top scorer · Final on penalties"}
                </span>
              </div>
              <ArrowUpRight className="h-5 w-5 text-primary shrink-0 group-hover:translate-x-0.5 transition-transform" strokeWidth={2} />
            </Card>
          </Link>

          <section className="flex flex-col gap-6">
            <div className="flex justify-between items-end">
              <SectionHeading>{isHebrew ? "טבלת המובילים" : "Standings"}</SectionHeading>
              <Link
                href={localePath(locale, "leaderboard")}
                className="font-[family-name:var(--font-label)] text-[12px] font-bold tracking-[0.05em] text-primary hover:underline inline-flex items-center gap-1"
              >
                {isHebrew ? "טבלה מלאה" : "Full table"}
                <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2} />
              </Link>
            </div>
            <LeaderboardPreview rows={leaderboardPreview} locale={locale} />
          </section>
        </div>
      </div>
    </section>
  );
}

function buildLeaderboardPreview(board: LeaderboardEntry[]): Array<
  LeaderboardEntry | { separator: true; key: string }
> {
  if (board.length === 0) return [];
  const top3 = board.slice(0, 3);
  const meIdx = board.findIndex((r) => r.isYou);
  if (meIdx === -1 || meIdx < 3) return top3;

  const result: Array<LeaderboardEntry | { separator: true; key: string }> = [...top3];
  const context = board.slice(Math.max(3, meIdx - 1), meIdx + 2);
  if (context[0].rank > 4) {
    result.push({ separator: true, key: `gap-${context[0].rank}` });
  }
  result.push(...context);
  return result;
}

function LeaderboardPreview({
  rows,
  locale,
}: {
  rows: ReturnType<typeof buildLeaderboardPreview>;
  locale: Locale;
}) {
  const isHebrew = locale === "he";
  if (rows.length === 0) {
    return (
      <Card className="p-6 text-center text-on-surface-variant">
        {isHebrew ? "אין עדיין משתתפים" : "No players yet"}
      </Card>
    );
  }
  return (
    <Card className="p-0 overflow-hidden">
      <ul className="flex flex-col">
        {rows.map((row, i) => {
          if ("separator" in row) {
            return (
              <li
                key={row.key}
                className="px-4 py-2 text-center text-on-surface-variant text-xs border-t border-outline-variant bg-surface-container-low"
              >
                · · ·
              </li>
            );
          }
          const top3 = row.rank <= 3;
          return (
            <li
              key={row.userId}
              className={clsx(
                "flex items-center gap-3 px-4 py-3 transition-colors min-h-[56px]",
                i > 0 && "border-t border-outline-variant",
                row.isYou && "bg-primary-fixed",
              )}
            >
              <span className="font-[family-name:var(--font-display)] text-lg leading-none font-bold text-on-surface w-6 text-center bidi-ltr">
                {row.rank}
              </span>
              <div
                className={clsx(
                  "w-9 h-9 rounded-full bg-surface-variant flex items-center justify-center text-sm font-bold text-on-surface shrink-0",
                  top3 && "ring-2 ring-tertiary-fixed-dim",
                )}
                aria-hidden
              >
                {top3 ? <Trophy className="h-4 w-4 text-tertiary-fixed-dim" strokeWidth={2} /> : row.displayName.charAt(0)}
              </div>
              <span className="flex-1 min-w-0 text-sm font-bold truncate">
                {row.isYou ? (isHebrew ? "אתה" : "You") : row.displayName}
              </span>
              <span className="font-[family-name:var(--font-display)] text-lg leading-none font-bold text-surface-tint bidi-ltr">
                {row.points}
              </span>
              <span className="text-xs text-on-surface-variant whitespace-nowrap">
                {isHebrew ? "נק'" : "pts"}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function UpcomingCard({
  match,
  idx,
  locale,
  dict,
}: {
  match: FixtureWithMyBet;
  idx: number;
  locale: Locale;
  dict: Awaited<ReturnType<typeof getDictionary>>;
}) {
  const isHebrew = locale === "he";
  const homeName = isHebrew ? match.homeNameHe : match.homeNameEn;
  const awayName = isHebrew ? match.awayNameHe : match.awayNameEn;
  const dim = idx === 1 ? "opacity-90" : idx === 2 ? "opacity-70" : "";
  const countdown = formatRelative(match.kickoffAt, locale);
  const hasBet = match.myHome !== null && match.myAway !== null;
  return (
    <Card className={`min-w-[280px] snap-start p-6 relative flex flex-col ${dim}`}>
      <div
        className={`absolute top-0 ${
          isHebrew ? "right-0 rounded-bl-lg rounded-tr-lg" : "left-0 rounded-br-lg rounded-tl-lg"
        } px-3 py-1 text-[12px] font-[family-name:var(--font-label)] font-bold tracking-[0.05em] ${
          idx === 0
            ? "bg-secondary text-on-secondary"
            : "bg-surface-variant text-on-surface-variant border-b border-outline-variant"
        }`}
      >
        {countdown}
      </div>
      <div className="flex justify-between items-center mt-4 mb-6">
        <TeamMini name={homeName} code={match.homeCode} />
        <span className="font-[family-name:var(--font-display)] text-2xl text-on-surface-variant px-4">
          VS
        </span>
        <TeamMini name={awayName} code={match.awayCode} />
      </div>
      <div className="mt-auto border-t border-outline-variant pt-4 text-center">
        {hasBet ? (
          <>
            <LabelCaps as="div" className="mb-1">{dict.dashboard.yourBet}</LabelCaps>
            <span className="font-[family-name:var(--font-score)] text-[40px] leading-none tracking-[0.1em] font-bold text-primary">
              <span className="bidi-ltr">{match.myHome} - {match.myAway}</span>
            </span>
          </>
        ) : (
          <Link
            href={localePath(locale, `bets/${match.id}`)}
            className="press-down inline-flex items-center text-primary border-b border-primary font-[family-name:var(--font-label)] text-[12px] font-bold tracking-[0.05em] pb-1 hover:bg-surface-container-low transition-colors"
          >
            {dict.matchBet.saveBet}
          </Link>
        )}
      </div>
    </Card>
  );
}

function TeamMini({ name, code }: { name: string; code: string }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <Flag code={code} size={48} />
      <span className="text-sm font-bold text-on-surface text-center">{name}</span>
    </div>
  );
}

function LastBetCard({
  match,
  locale,
  dict,
}: {
  match: FixtureWithMyBet;
  locale: Locale;
  dict: Awaited<ReturnType<typeof getDictionary>>;
}) {
  const isHebrew = locale === "he";
  const homeName = isHebrew ? match.homeNameHe : match.homeNameEn;
  const awayName = isHebrew ? match.awayNameHe : match.awayNameEn;
  const hasBet = match.myHome !== null && match.myAway !== null;
  const points = match.myPoints ?? 0;
  const exact = match.myExact === true;

  return (
    <Card className="overflow-hidden p-0">
      <div className="p-6 bg-surface-container border-b-4 border-surface-tint text-center">
        <LabelCaps as="div" className="mb-4 tracking-[0.15em]">{dict.matchDetail.final}</LabelCaps>
        <div className="flex justify-center items-end gap-6">
          <div className="flex flex-col items-center gap-2">
            <span className="text-lg text-on-surface-variant">{homeName}</span>
            <ScoreDigit value={match.homeScore ?? 0} dark />
          </div>
          <span className="text-2xl text-on-surface-variant mb-3">:</span>
          <div className="flex flex-col items-center gap-2">
            <span className="text-lg text-on-surface-variant">{awayName}</span>
            <ScoreDigit value={match.awayScore ?? 0} dark />
          </div>
        </div>
      </div>
      <div className="p-6 bg-[#FBF6EB] flex flex-col gap-4">
        <div className="flex justify-between items-center">
          <LabelCaps>{dict.dashboard.yourBet}</LabelCaps>
          <span className="font-[family-name:var(--font-score)] text-[28px] leading-none tracking-[0.1em] font-bold text-on-surface">
            <span className="bidi-ltr">
              {hasBet ? `${match.myHome} - ${match.myAway}` : "—"}
            </span>
          </span>
        </div>
        <div className="border-t border-outline-variant pt-4 flex justify-between items-end">
          <div className="flex flex-col gap-2">
            {hasBet ? (
              <>
                <LabelCaps className={exact ? "text-secondary" : "text-on-surface-variant"}>
                  {exact
                    ? isHebrew ? "תוצאה מדויקת" : "Exact score"
                    : isHebrew ? "ניחוש" : "Bet"}
                </LabelCaps>
                <Chip tone={exact ? "secondary" : "default"}>
                  <span>+{points} {dict.common.points}</span>
                </Chip>
              </>
            ) : (
              <LabelCaps>{isHebrew ? "לא הזנת הימור" : "No bet placed"}</LabelCaps>
            )}
          </div>
          <div className="text-end">
            <LabelCaps as="div" className="mb-1">{dict.dashboard.earned}</LabelCaps>
            <span
              className={`font-[family-name:var(--font-display)] text-[40px] leading-none font-bold ${
                points > 0 ? "text-secondary" : "text-on-surface-variant"
              }`}
            >
              <span className="bidi-ltr">+{points}</span>
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}

function EmptyMatches({ isHebrew }: { isHebrew: boolean }) {
  return (
    <Card className="p-6 text-center text-on-surface-variant">
      {isHebrew
        ? "כרגע אין משחקים מתוכננים. המנהל יעדכן בקרוב."
        : "No matches scheduled yet. The organizer will add them soon."}
    </Card>
  );
}

function formatRelative(iso: string, locale: Locale): string {
  const now = Date.now();
  const t = new Date(iso).getTime();
  const diff = t - now;
  const isHebrew = locale === "he";
  if (diff <= 0) return isHebrew ? "התחיל" : "Started";
  const hours = Math.round(diff / (1000 * 60 * 60));
  if (hours < 24) {
    return isHebrew ? `בעוד ${hours} שעות` : `in ${hours}h`;
  }
  const days = Math.round(hours / 24);
  if (days < 7) {
    return isHebrew ? `בעוד ${days} ימים` : `in ${days}d`;
  }
  return new Intl.DateTimeFormat(isHebrew ? "he-IL" : "en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function Sparkline({ trend }: { trend: number[] }) {
  const w = 400;
  const h = 100;
  const max = Math.max(...trend, 1);
  const min = Math.min(...trend, 0);
  const range = max - min || 1;
  const step = trend.length > 1 ? w / (trend.length - 1) : w;
  const points = trend.map((v, i) => {
    const x = i * step;
    const y = h - ((v - min) / range) * (h - 10) - 5;
    return [x, y] as const;
  });
  const d = points
    .map(([x, y], i) =>
      i === 0
        ? `M ${x},${y}`
        : `Q ${(x - step / 2).toFixed(1)},${(points[i - 1][1] + y) / 2} ${x},${y}`,
    )
    .join(" ");

  return (
    <div className="relative h-32 w-full">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="w-full h-full overflow-visible"
      >
        <line stroke="#dfc0b8" strokeDasharray="4 4" strokeWidth="1" x1="0" x2={w} y1="0" y2="0" />
        <line stroke="#dfc0b8" strokeDasharray="4 4" strokeWidth="1" x1="0" x2={w} y1={h / 2} y2={h / 2} />
        <line stroke="#dfc0b8" strokeWidth="1" x1="0" x2={w} y1={h} y2={h} />
        <path d={d} stroke="#a13217" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        {points.map(([x, y], i) => (
          <circle
            key={i}
            cx={x}
            cy={y}
            r={i === points.length - 1 ? 6 : 4}
            fill={i === points.length - 1 ? "#FBF6EB" : "#a13217"}
            stroke={i === points.length - 1 ? "#a13217" : undefined}
            strokeWidth={i === points.length - 1 ? 3 : undefined}
          />
        ))}
      </svg>
    </div>
  );
}

function CountdownUnit({
  n,
  label,
  displayFont,
}: {
  n: string;
  label: string;
  displayFont: string;
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <bdi
        className={`${displayFont} text-[40px] md:text-[64px] leading-none font-bold text-primary tracking-tight`}
      >
        {n}
      </bdi>
      <span
        className={`${displayFont} text-base md:text-2xl font-bold text-on-surface-variant`}
      >
        {label}
      </span>
    </span>
  );
}

function computeCountdown(iso: string): {
  days: number;
  hours: number;
  started: boolean;
} {
  const target = new Date(iso).getTime();
  const diff = target - Date.now();
  if (diff <= 0) return { days: 0, hours: 0, started: true };
  const totalHours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return { days, hours, started: false };
}
