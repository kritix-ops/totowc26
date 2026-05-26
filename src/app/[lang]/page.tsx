import Link from "next/link";
import Image from "next/image";
import {
  ArrowUpRight,
  CalendarClock,
  CircleDollarSign,
  Sparkles,
  Trophy,
  Users,
} from "lucide-react";
import { clsx } from "clsx";
import { notFound } from "next/navigation";
import { getDictionary, hasLocale, type Locale } from "./dictionaries";
import { localePath } from "@/lib/paths";
import { BrandLogo } from "@/components/BrandLogo";
import { InstallHint } from "@/components/InstallHint";
import { PrizeStrip } from "@/components/PrizeStrip";
import { getUser } from "@/lib/supabase/auth";
import {
  getLatestFinalForUser,
  getLeaderboard,
  getMyRankSummary,
  getPointsTrend,
  getPoolStats,
  getPrizeBreakdown,
  getTournamentStart,
  getUpcomingFixtures,
  type FixtureWithMyBet,
  type LeaderboardEntry,
  type PrizeBreakdown,
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
  searchParams,
}: PageProps<"/[lang]">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const dict = await getDictionary(locale);

  const sp = (await searchParams) ?? {};
  const previewPlayer =
    process.env.NODE_ENV !== "production" && sp["preview"] === "player";

  const user = await getUser();
  const signedIn = !!user || previewPlayer;

  const [pool, tournamentStart, prize] = await Promise.all([
    getPoolStats(),
    getTournamentStart(),
    getPrizeBreakdown(),
  ]);

  let dashboard: DashboardData | null = null;
  if (user) {
    dashboard = await loadDashboard(user.id);
  } else if (previewPlayer) {
    dashboard = mockDashboard();
  }

  console.info("[home render]", {
    signedIn,
    previewPlayer,
    potIls: pool.potIls,
    participants: pool.participants,
    tournamentStart,
    hasDashboard: !!dashboard,
    myRank: dashboard?.rankInfo.myRank ?? null,
    totalPlayers: dashboard?.rankInfo.total ?? null,
  });

  if (!signedIn) {
    return (
      <GuestLanding
        locale={locale}
        dict={dict}
        tournamentStart={tournamentStart}
        prize={prize}
      />
    );
  }

  return (
    <PlayerHome
      locale={locale}
      dict={dict}
      pool={pool}
      tournamentStart={tournamentStart}
      data={dashboard!}
      prize={prize}
    />
  );
}

// Dev-only mock so the PlayerHome layout can be previewed without a
// Supabase session. Activated with `?preview=player` and ignored in
// production builds.
function mockDashboard(): DashboardData {
  return {
    upcoming: [],
    lastFinal: null,
    rankInfo: { myRank: 1, total: 1, gapToLeader: 0, myPoints: 0 },
    trend: [],
    board: [
      {
        rank: 1,
        userId: "preview-self",
        displayName: "אתה",
        points: 0,
        grossPoints: 0,
        betCount: 0,
        wastedStakes: 0,
        isYou: true,
      },
    ],
  };
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

// ─────────────────────────────────────────────────────────────────────────────
// Guest landing — the marketing-style entry. The hero is the centerpiece;
// everything important sits in a single centered card so a first-time visitor
// reads it in one pass and knows what to do (sign in) without scrolling.
// ─────────────────────────────────────────────────────────────────────────────

function GuestLanding({
  locale,
  dict,
  tournamentStart,
  prize,
}: {
  locale: Locale;
  dict: Awaited<ReturnType<typeof getDictionary>>;
  tournamentStart: string | null;
  prize: PrizeBreakdown;
}) {
  const isHebrew = locale === "he";
  const displayFont = isHebrew
    ? "font-[family-name:var(--font-display)]"
    : "font-[family-name:var(--font-display-en)]";
  const countdown = tournamentStart ? computeCountdown(tournamentStart) : null;

  return (
    <section className="relative flex flex-col items-stretch">
      <div className="relative w-full h-[220px] sm:h-[320px] md:h-[440px] lg:h-[520px] overflow-hidden">
        <Image
          src={isHebrew ? "/hero-he.png" : "/hero-en.png"}
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

      <div className="relative z-10 -mt-12 md:-mt-20 px-4 md:px-16 pb-10 md:pb-20 flex justify-center">
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

          <div>
            <Link
              href={localePath(locale, "login")}
              className="press-down inline-flex items-center justify-center bg-primary text-on-primary font-[family-name:var(--font-label)] text-[14px] font-bold tracking-[0.05em] px-10 py-4 min-h-[48px] rounded-full shadow-md hover:bg-surface-tint hover:-translate-y-0.5 transition-all duration-200"
            >
              {dict.landing.cta}
            </Link>
          </div>

          <InstallHint locale={locale as "he" | "en"} />

          {prize.potIls > 0 && (
            <div className="pt-2">
              <PrizeStrip prize={prize} locale={locale} dict={dict} />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Player home — the integrated dashboard. The hero is now a short, decorative
// band whose only job is to carry the tournament-context strip (logo,
// countdown, pot, participants) at its bottom edge. The rest of the screen is
// a single-container dashboard so widths align and nothing floats.
// ─────────────────────────────────────────────────────────────────────────────

function PlayerHome({
  locale,
  dict,
  pool,
  tournamentStart,
  data,
  prize,
}: {
  locale: Locale;
  dict: Awaited<ReturnType<typeof getDictionary>>;
  pool: { potIls: number; participants: number };
  tournamentStart: string | null;
  data: DashboardData;
  prize: PrizeBreakdown;
}) {
  const isHebrew = locale === "he";
  const countdown = tournamentStart ? computeCountdown(tournamentStart) : null;
  console.info("[home overview render]", {
    locale,
    started: countdown?.started ?? null,
    potIls: pool.potIls,
    participants: pool.participants,
  });

  return (
    <section className="flex flex-col">
      <HeroBand locale={locale} />

      <div className="relative z-10 -mt-10 sm:-mt-14 md:-mt-20 px-4 md:px-8 lg:px-16 flex justify-center">
        <div className="w-full max-w-6xl bg-surface-container-low border border-outline rounded-lg shadow-[0_8px_24px_rgba(28,20,15,0.12)] p-5 md:p-7 flex flex-col gap-5 md:gap-6">
          <div className="flex justify-center">
            <BrandLogo locale={locale} size="hero" />
          </div>
          <div aria-hidden className="h-px bg-outline/40" />
          <div className="grid grid-cols-3 gap-x-3 md:gap-x-6 items-center">
            <HeroStat
              icon={<CalendarClock className="h-4 w-4 text-surface-tint" strokeWidth={1.75} />}
              value={
                countdown
                  ? countdown.started
                    ? (isHebrew ? "מתחיל!" : "Live")
                    : formatCountdownShort(countdown, locale)
                  : "—"
              }
              label={
                countdown?.started
                  ? (isHebrew ? "המונדיאל" : "Tournament")
                  : dict.landing.countdownLabel
              }
            />
            <HeroStat
              icon={<CircleDollarSign className="h-4 w-4 text-surface-tint" strokeWidth={1.75} />}
              value={
                <>
                  {pool.potIls.toLocaleString(isHebrew ? "he-IL" : "en-US")}
                  <span className="text-on-surface-variant font-normal mr-0.5 ms-0.5">
                    {dict.common.currency}
                  </span>
                </>
              }
              label={dict.landing.potLabel}
            />
            <HeroStat
              icon={<Users className="h-4 w-4 text-surface-tint" strokeWidth={1.75} />}
              value={String(pool.participants)}
              label={dict.landing.participantsLabel}
            />
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-6xl px-4 md:px-8 lg:px-16 pt-8 md:pt-12 flex flex-col gap-8 md:gap-12">
        <PrizeStrip prize={prize} locale={locale} dict={dict} />
        <StatusRow locale={locale} dict={dict} rankInfo={data.rankInfo} />

        <UpcomingSection
          locale={locale}
          dict={dict}
          upcoming={data.upcoming}
        />

        <div className="flex flex-col gap-8 md:gap-12 lg:grid lg:grid-cols-12 lg:gap-x-12 lg:gap-y-12">
          <div className="lg:col-start-1 lg:col-end-6 lg:row-start-1">
            <LastBetSection
              locale={locale}
              dict={dict}
              lastFinal={data.lastFinal}
            />
          </div>
          <div className="lg:col-start-6 lg:col-end-13 lg:row-start-1">
            <TrendSection
              locale={locale}
              dict={dict}
              trend={data.trend}
            />
          </div>
          <div className="lg:col-start-6 lg:col-end-13 lg:row-start-2">
            <LeaderboardSection
              locale={locale}
              dict={dict}
              board={data.board}
            />
          </div>
          <div className="lg:col-start-1 lg:col-end-6 lg:row-start-2">
            <SpecialsCard locale={locale} isHebrew={isHebrew} />
          </div>
        </div>

        <InstallHint locale={locale as "he" | "en"} />
      </div>
    </section>
  );
}

function HeroBand({ locale }: { locale: Locale }) {
  const isHebrew = locale === "he";
  return (
    <div className="relative w-full h-[300px] sm:h-[400px] md:h-[520px] lg:h-[600px] overflow-hidden">
      <Image
        src={isHebrew ? "/hero-he.png" : "/hero-en.png"}
        alt={isHebrew ? "כוכבי המונדיאל" : "World Cup legends"}
        fill
        priority
        sizes="100vw"
        className="object-cover object-center"
      />
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-b from-transparent via-background/55 to-background pointer-events-none"
      />
    </div>
  );
}

function HeroStat({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: React.ReactNode;
  label: string;
}) {
  return (
    <div className="flex flex-col items-center md:items-start gap-1 md:flex-row md:gap-2 min-w-0 text-center md:text-start">
      <span aria-hidden className="shrink-0">
        {icon}
      </span>
      <div className="flex flex-col leading-tight min-w-0">
        <bdi className="font-[family-name:var(--font-display)] text-[13px] md:text-lg font-bold text-on-surface">
          {value}
        </bdi>
        <span className="font-[family-name:var(--font-label)] text-[9px] md:text-[11px] tracking-[0.04em] uppercase text-on-surface-variant leading-snug">
          {label}
        </span>
      </div>
    </div>
  );
}

function StatusRow({
  locale,
  dict,
  rankInfo,
}: {
  locale: Locale;
  dict: Awaited<ReturnType<typeof getDictionary>>;
  rankInfo: DashboardData["rankInfo"];
}) {
  const isHebrew = locale === "he";
  const hasRank = rankInfo.myRank > 0 && rankInfo.total > 0;
  const rankValue = hasRank ? (
    <>
      <span className="bidi-ltr">{rankInfo.myRank}</span>
      <span className="text-[18px] md:text-[20px] text-on-surface-variant font-medium">
        {" "}{dict.dashboard.ofTotal}{" "}
        <span className="bidi-ltr">{rankInfo.total}</span>
      </span>
    </>
  ) : (
    <span className="text-on-surface-variant">—</span>
  );

  return (
    <section
      aria-labelledby="status-heading"
      className="flex flex-col gap-4 md:gap-6"
    >
      <div className="flex items-end justify-between">
        <h2
          id="status-heading"
          className="font-[family-name:var(--font-display)] text-[24px] md:text-[32px] leading-tight font-bold text-on-surface"
        >
          {dict.dashboard.welcome}
        </h2>
      </div>
      <div className="grid grid-cols-3 gap-3 md:gap-4">
        <StatCard
          label={dict.dashboard.myRankLabel}
          value={rankValue}
        />
        <StatCard
          label={dict.dashboard.gapToLeader}
          value={
            hasRank ? (
              <>
                <span className="bidi-ltr">{rankInfo.gapToLeader}</span>
                <span className="text-[18px] md:text-[20px] text-on-surface-variant font-medium">
                  {" "}{dict.common.points}
                </span>
              </>
            ) : (
              <span className="text-on-surface-variant">—</span>
            )
          }
        />
        <StatCard
          label={isHebrew ? "סה\"כ נקודות" : "Total points"}
          value={
            <>
              <span className="bidi-ltr">{rankInfo.myPoints}</span>
              <span className="text-[18px] md:text-[20px] text-on-surface-variant font-medium">
                {" "}{dict.common.points}
              </span>
            </>
          }
        />
      </div>
    </section>
  );
}

function StatCard({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <Card className="px-3 md:px-5 py-3 md:py-4 text-center">
      <LabelCaps
        as="div"
        className="mb-1 text-[10px] md:text-[12px] leading-tight min-h-[1.5em]"
      >
        {label}
      </LabelCaps>
      <div className="font-[family-name:var(--font-display)] text-[24px] md:text-[36px] leading-none font-bold text-surface-tint">
        {value}
      </div>
    </Card>
  );
}

function UpcomingSection({
  locale,
  dict,
  upcoming,
}: {
  locale: Locale;
  dict: Awaited<ReturnType<typeof getDictionary>>;
  upcoming: FixtureWithMyBet[];
}) {
  const isHebrew = locale === "he";
  return (
    <section
      aria-labelledby="upcoming-heading"
      className="flex flex-col gap-4 md:gap-6"
    >
      <div className="flex justify-between items-end">
        <SectionHeading as="h3">
          <span id="upcoming-heading">{dict.dashboard.upcomingTitle}</span>
        </SectionHeading>
        <Link
          href={localePath(locale, "play")}
          className="font-[family-name:var(--font-label)] text-[12px] font-bold tracking-[0.05em] text-primary hover:underline inline-flex items-center gap-1 min-h-[40px]"
        >
          {dict.dashboard.viewAll}
          <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2} />
        </Link>
      </div>
      {upcoming.length === 0 ? (
        <Card className="p-6 text-center text-on-surface-variant">
          {isHebrew
            ? "כרגע אין משחקים מתוכננים. המנהל יעדכן בקרוב."
            : "No matches scheduled yet. The organizer will add them soon."}
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {upcoming.slice(0, 3).map((m) => (
            <UpcomingCard
              key={m.id}
              match={m}
              locale={locale}
              dict={dict}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function UpcomingCard({
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
  const countdown = formatRelative(match.kickoffAt, locale);
  const hasBet = match.myHome !== null && match.myAway !== null;

  return (
    <Card className="p-5 md:p-6 relative flex flex-col gap-5 min-h-[200px]">
      <div className="flex items-center justify-between gap-2">
        <Chip tone={hasBet ? "secondary" : "default"}>
          <CalendarClock className="h-3.5 w-3.5" strokeWidth={1.75} />
          <span className="text-xs font-bold">{countdown}</span>
        </Chip>
        {hasBet && (
          <LabelCaps className="text-secondary">
            {isHebrew ? "הימור נשמר" : "Bet saved"}
          </LabelCaps>
        )}
      </div>

      <div className="flex justify-between items-center">
        <TeamMini name={homeName} code={match.homeCode} />
        <span className="font-[family-name:var(--font-display)] text-xl text-on-surface-variant px-2">
          VS
        </span>
        <TeamMini name={awayName} code={match.awayCode} />
      </div>

      <div className="mt-auto border-t border-outline-variant pt-4 text-center">
        {hasBet ? (
          <>
            <LabelCaps as="div" className="mb-1">{dict.dashboard.yourBet}</LabelCaps>
            <span className="font-[family-name:var(--font-score)] text-[32px] md:text-[36px] leading-none tracking-[0.1em] font-bold text-primary">
              <span className="bidi-ltr">{match.myHome} - {match.myAway}</span>
            </span>
          </>
        ) : (
          <Link
            href={localePath(locale, `bets/${match.id}`)}
            className="press-down inline-flex items-center justify-center bg-primary text-on-primary font-[family-name:var(--font-label)] text-[12px] font-bold tracking-[0.05em] px-5 py-2.5 min-h-[40px] rounded-full hover:bg-surface-tint transition-colors"
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
    <div className="flex flex-col items-center gap-2 flex-1 min-w-0">
      <Flag code={code} size={44} />
      <span className="text-sm font-bold text-on-surface text-center truncate max-w-full">
        {name}
      </span>
    </div>
  );
}

function TrendSection({
  locale,
  dict,
  trend,
}: {
  locale: Locale;
  dict: Awaited<ReturnType<typeof getDictionary>>;
  trend: number[];
}) {
  const isHebrew = locale === "he";
  const hasData = trend.length > 0;

  return (
    <section
      aria-labelledby="trend-heading"
      className="flex flex-col gap-4 md:gap-6"
    >
      <SectionHeading as="h3">
        <span id="trend-heading">{dict.dashboard.pointsTrend}</span>
      </SectionHeading>
      <Card className="p-5 md:p-6">
        {hasData ? (
          <>
            <Sparkline trend={trend} />
            <div className="flex justify-between mt-3 gap-2">
              {trend.map((_, i) => (
                <LabelCaps
                  key={i}
                  className={clsx(
                    "truncate",
                    i === trend.length - 1 && "text-primary",
                  )}
                >
                  {dict.dashboard.matchday}{" "}
                  <span className="bidi-ltr">{i + 1}</span>
                </LabelCaps>
              ))}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
            <CalendarClock
              className="h-8 w-8 text-outline-variant"
              strokeWidth={1.5}
            />
            <p className="text-sm text-on-surface-variant max-w-xs">
              {isHebrew
                ? "הגרף יתחיל להתמלא כשהמשחקים יסתיימו ויחושבו נקודות."
                : "The chart fills in once matches finish and points are tallied."}
            </p>
          </div>
        )}
      </Card>
    </section>
  );
}

function LastBetSection({
  locale,
  dict,
  lastFinal,
}: {
  locale: Locale;
  dict: Awaited<ReturnType<typeof getDictionary>>;
  lastFinal: FixtureWithMyBet | null;
}) {
  const isHebrew = locale === "he";
  return (
    <section
      aria-labelledby="last-bet-heading"
      className="flex flex-col gap-4 md:gap-6"
    >
      <SectionHeading as="h3">
        <span id="last-bet-heading">{dict.dashboard.lastBetTitle}</span>
      </SectionHeading>
      {lastFinal ? (
        <LastBetCard match={lastFinal} locale={locale} dict={dict} />
      ) : (
        <Card className="p-6 text-center text-on-surface-variant">
          {isHebrew
            ? "אין עדיין משחקים שהסתיימו. נחזור לכאן אחרי שריקת הסיום הראשונה."
            : "No finished matches yet. We'll come back here after the first full-time whistle."}
        </Card>
      )}
    </section>
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
      <div className="p-5 md:p-6 bg-surface-container border-b-4 border-surface-tint text-center">
        <LabelCaps as="div" className="mb-4 tracking-[0.15em]">
          {dict.matchDetail.final}
        </LabelCaps>
        <div className="flex justify-center items-end gap-4 md:gap-6">
          <div className="flex flex-col items-center gap-2 min-w-0">
            <span className="text-base md:text-lg text-on-surface-variant truncate max-w-[120px]">
              {homeName}
            </span>
            <ScoreDigit value={match.homeScore ?? 0} dark />
          </div>
          <span className="text-2xl text-on-surface-variant mb-3">:</span>
          <div className="flex flex-col items-center gap-2 min-w-0">
            <span className="text-base md:text-lg text-on-surface-variant truncate max-w-[120px]">
              {awayName}
            </span>
            <ScoreDigit value={match.awayScore ?? 0} dark />
          </div>
        </div>
      </div>
      <div className="p-5 md:p-6 bg-[#FBF6EB] flex flex-col gap-4">
        <div className="flex justify-between items-center">
          <LabelCaps>{dict.dashboard.yourBet}</LabelCaps>
          <span className="font-[family-name:var(--font-score)] text-[24px] md:text-[28px] leading-none tracking-[0.1em] font-bold text-on-surface">
            <span className="bidi-ltr">
              {hasBet ? `${match.myHome} - ${match.myAway}` : "—"}
            </span>
          </span>
        </div>
        <div className="border-t border-outline-variant pt-4 flex justify-between items-end">
          <div className="flex flex-col gap-2">
            {hasBet ? (
              <>
                <LabelCaps
                  className={exact ? "text-secondary" : "text-on-surface-variant"}
                >
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
            <LabelCaps as="div" className="mb-1">
              {dict.dashboard.earned}
            </LabelCaps>
            <span
              className={clsx(
                "font-[family-name:var(--font-display)] text-[32px] md:text-[40px] leading-none font-bold",
                points > 0 ? "text-secondary" : "text-on-surface-variant",
              )}
            >
              <span className="bidi-ltr">+{points}</span>
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}

function SpecialsCard({
  locale,
  isHebrew,
}: {
  locale: Locale;
  isHebrew: boolean;
}) {
  return (
    <Link
      href={localePath(locale, "specials")}
      className="press-down group block"
    >
      <Card className="p-5 flex items-center gap-4 min-h-[72px] hover:bg-surface-container transition-colors">
        <div className="w-11 h-11 rounded-full bg-tertiary-container flex items-center justify-center shrink-0">
          <Sparkles
            className="h-5 w-5 text-on-tertiary-container"
            strokeWidth={1.75}
          />
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
        <ArrowUpRight
          className="h-5 w-5 text-primary shrink-0 group-hover:translate-x-0.5 transition-transform"
          strokeWidth={2}
        />
      </Card>
    </Link>
  );
}

function LeaderboardSection({
  locale,
  dict,
  board,
}: {
  locale: Locale;
  dict: Awaited<ReturnType<typeof getDictionary>>;
  board: LeaderboardEntry[];
}) {
  const isHebrew = locale === "he";
  const rows = buildLeaderboardPreview(board);
  // dict is intentionally unused for now (kept for future i18n labels).
  void dict;
  return (
    <section
      aria-labelledby="leaderboard-heading"
      className="flex flex-col gap-4 md:gap-6"
    >
      <div className="flex justify-between items-end">
        <SectionHeading as="h3">
          <span id="leaderboard-heading">
            {isHebrew ? "מובילים" : "Leaders"}
          </span>
        </SectionHeading>
        <Link
          href={localePath(locale, "leaderboard")}
          className="font-[family-name:var(--font-label)] text-[12px] font-bold tracking-[0.05em] text-primary hover:underline inline-flex items-center gap-1 min-h-[40px]"
        >
          {isHebrew ? "טבלה מלאה" : "Full table"}
          <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2} />
        </Link>
      </div>
      <LeaderboardPreview rows={rows} locale={locale} />
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
        {isHebrew
          ? "אין עדיין משתתפים מדורגים. תתעדכן ברגע שייסגרו הימורים."
          : "No ranked players yet. Updates as bets settle."}
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
                {top3 ? (
                  <Trophy
                    className="h-4 w-4 text-tertiary-fixed-dim"
                    strokeWidth={2}
                  />
                ) : (
                  row.displayName.charAt(0)
                )}
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
    timeZone: "Asia/Jerusalem",
  }).format(new Date(iso));
}

function formatCountdownShort(
  c: { days: number; hours: number },
  locale: Locale,
): string {
  const isHebrew = locale === "he";
  if (c.days >= 1) {
    return isHebrew
      ? `${c.days} ימים · ${c.hours} שעות`
      : `${c.days}d ${c.hours}h`;
  }
  return isHebrew ? `${c.hours} שעות` : `${c.hours}h`;
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
        role="img"
        aria-label="Points trend"
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
