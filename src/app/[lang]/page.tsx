import Link from "next/link";
import Image from "next/image";
import { Suspense } from "react";
import {
  ArrowUpRight,
  CalendarClock,
  CircleDollarSign,
  ExternalLink,
  Newspaper,
  Sparkles,
  Trophy,
  Users,
} from "lucide-react";
import { clsx } from "clsx";
import { notFound } from "next/navigation";
import { getDictionary, hasLocale, type Locale } from "./dictionaries";
import { formatDateTime } from "@/lib/format";
import { MS_PER_HOUR } from "@/lib/time";
import { localePath } from "@/lib/paths";
import { BrandLogo } from "@/components/BrandLogo";
import { InstallHint } from "@/components/InstallHint";
import { CategoryPrizeStrip } from "@/components/CategoryPrizeStrip";
import { getRequestUser } from "@/lib/request-user";
import { getUserAccess } from "@/lib/access";
import { getBankBalance } from "@/lib/bank";
import { DashboardPickCard } from "@/components/DashboardPickCard";
import { SmartHubAsync, SmartHubSkeleton } from "@/components/SmartHub";
import {
  TodaysBetsSectionAsync,
  TodaysBetsSectionSkeleton,
} from "@/components/TodayBetsSection";
import { WhatsAppInviteCard } from "@/components/WhatsAppInviteCard";
import { PoolDigestSection } from "@/components/PoolDigestSection";
import { isWhatsAppCardDismissed } from "@/lib/whatsapp-dismiss";
import {
  HeroStatsCardSkeleton,
  LastBetSectionSkeleton,
  LatestNewsSectionSkeleton,
  LeaderboardSectionSkeleton,
  PoolDigestSectionSkeleton,
  PrizeStripSkeleton,
  StatusRowSkeleton,
  TrendSectionSkeleton,
  UpcomingSectionSkeleton,
} from "@/components/PageSkeleton";
import {
  getBetLockMinutes,
  getCategoryPrizeBreakdown,
  getCurrentStage,
  getLatestFinalForUser,
  getLeaderboard,
  getMyRankSummary,
  getPointsTrend,
  getPoolStats,
  getSettingsRow,
  getTournamentStart,
  getTransparencyDigest,
  getUpcomingFixtures,
  type CategoryPrizeBreakdown,
  type FixtureWithMyBet,
  type LeaderboardEntry,
} from "@/db/queries";
import {
  currentStageLabel,
  type CurrentStage,
} from "@/lib/tournament/current-stage";
import { loadNewsArchivePage, type NewsArchiveItem } from "@/lib/news-read";
import type { NewsSource } from "@/lib/news";
import {
  Card,
  Chip,
  LabelCaps,
  ScoreDigit,
  ScoreLine,
  SectionHeading,
} from "@/components/ui";

// Cap server-side execution well below Vercel's 300s default. Without this
// a render — or a Server Action on this page, maxDuration covers both — that
// stalls waiting on a saturated DB pool squats the full 300s behind a spinner
// (the recurring "loading forever" fall). 25s fails fast into a retryable
// error and frees the function slot + connections instead of leaking them.
// This is the heaviest read fan-out; no legitimate render approaches 25s. See
// _plans/2026-06-23-prod-falls-reliability-fix.md.
export const maxDuration = 25;

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

  // Read the verified user from the proxy-set request header instead
  // of round-tripping to Supabase again. The proxy already authenticated
  // the session on this request; trusting its result keeps the home
  // page's TTFB low.
  const reqUser = await getRequestUser();
  const userId = reqUser?.id ?? null;
  const signedIn = !!userId || previewPlayer;

  if (!signedIn) {
    // Guest landing only needs the tournament start for the countdown.
    // Prize-pool details deliberately do not appear here — they are a
    // signed-in surface only.
    const tournamentStart = await getTournamentStart();
    return (
      <GuestLanding
        locale={locale}
        dict={dict}
        tournamentStart={tournamentStart}
      />
    );
  }

  // Preview mode is a dev-only escape hatch to look at the signed-in
  // dashboard layout without a real Supabase session. It keeps the old
  // pre-loaded code path (no streaming) so the mock data lights up
  // immediately — there is no benefit to streaming mocked data.
  if (previewPlayer && !userId) {
    const [pool, tournamentStart, currentStage, prize, lockMinutes] = await Promise.all([
      getPoolStats(),
      getTournamentStart(),
      getCurrentStage(),
      getCategoryPrizeBreakdown(),
      getBetLockMinutes(),
    ]);
    return (
      <PlayerHomePreview
        locale={locale}
        dict={dict}
        pool={pool}
        tournamentStart={tournamentStart}
        currentStage={currentStage}
        prize={prize}
        canEdit={true}
        lockMinutes={lockMinutes}
        data={mockDashboard()}
      />
    );
  }

  // The real signed-in path. Every per-user query is streamed in its
  // own Suspense boundary so the shell + hero band paint immediately
  // and each card lights up as soon as its data lands. No section
  // blocks any other section.
  return <PlayerHome locale={locale} dict={dict} userId={userId!} />;
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

// Defines the shape DashboardData reads via Awaited<ReturnType<...>>; the
// real signed-in path streams each section independently (see PlayerHome
// + the per-Suspense fetchers below) so this aggregate function is never
// actually called at runtime. Kept as the single source of truth for the
// dashboard payload shape.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
// Guest landing - the marketing-style entry. The hero is the centerpiece;
// everything important sits in a single centered card so a first-time visitor
// reads it in one pass and knows what to do (sign in) without scrolling.
// ─────────────────────────────────────────────────────────────────────────────

function GuestLanding({
  locale,
  dict,
  tournamentStart,
}: {
  locale: Locale;
  dict: Awaited<ReturnType<typeof getDictionary>>;
  tournamentStart: string | null;
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

          <div className="grid grid-cols-2 gap-3 md:gap-4">
            <Link
              href={localePath(locale, "login")}
              className="press-down inline-flex items-center justify-center bg-primary text-on-primary font-[family-name:var(--font-label)] text-[14px] font-bold tracking-[0.05em] px-6 py-4 min-h-[48px] rounded-full shadow-md hover:bg-surface-tint hover:-translate-y-0.5 transition-all duration-200"
            >
              {dict.nav.signin}
            </Link>
            <Link
              href={localePath(locale, "signup")}
              className="press-down inline-flex items-center justify-center bg-surface-container-lowest border border-primary text-primary font-[family-name:var(--font-label)] text-[14px] font-bold tracking-[0.05em] px-6 py-4 min-h-[48px] rounded-full shadow-sm hover:bg-primary-container hover:-translate-y-0.5 transition-all duration-200"
            >
              {dict.nav.signup}
            </Link>
          </div>

          <InstallHint locale={locale as "he" | "en"} />
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Player home - the integrated dashboard. The hero is now a short, decorative
// band whose only job is to carry the tournament-context strip (logo,
// countdown, pot, participants) at its bottom edge. The rest of the screen is
// a single-container dashboard so widths align and nothing floats.
// ─────────────────────────────────────────────────────────────────────────────

// PlayerHome — the streaming version used for real signed-in users.
// Each card sits behind its own <Suspense> so the dashboard "fills in"
// progressively instead of blocking on the slowest query.
function PlayerHome({
  locale,
  dict,
  userId,
}: {
  locale: Locale;
  dict: Awaited<ReturnType<typeof getDictionary>>;
  userId: string;
}) {
  const isHebrew = locale === "he";
  return (
    <section className="flex flex-col">
      <HeroBand locale={locale} />

      <Suspense fallback={<HeroStatsCardSkeleton />}>
        <HeroStatsCardAsync locale={locale} dict={dict} />
      </Suspense>

      <div className="mx-auto w-full max-w-6xl px-4 md:px-8 lg:px-16 pt-8 md:pt-12 flex flex-col gap-8 md:gap-12">
        <Suspense fallback={<StatusRowSkeleton />}>
          <StatusRowAsync locale={locale} dict={dict} userId={userId} />
        </Suspense>

        {/* Smart Hub — personal "up next" card. See
            _plans/2026-05-30-smart-reminders.md. Streamed independently
            so the rest of the dashboard never waits on the moment
            engine fan-out. */}
        <Suspense fallback={<SmartHubSkeleton />}>
          <SmartHubAsync locale={locale} userId={userId} />
        </Suspense>

        {/* Today's bets — read-only snapshot of every bet the user has
            touching today's matches (score picks + match-scope and
            day-scope live custom bets) plus a points-from-today badge.
            Rolls forward to the next match day on dark days; returns null
            once the tournament is over. See
            _plans/2026-06-11-home-todays-bets-section.md. */}
        <Suspense fallback={<TodaysBetsSectionSkeleton />}>
          <TodaysBetsSectionAsync locale={locale} dict={dict} userId={userId} />
        </Suspense>

        <Suspense fallback={<UpcomingSectionSkeleton />}>
          <UpcomingSectionAsync locale={locale} dict={dict} userId={userId} />
        </Suspense>

        {/* Pool digest — social-proof card showing today's locked picks
            across every bet surface. Sits between the upcoming-matches
            strip and the bottom grid so the page reads as:
            you → pool → archive. See
            _plans/2026-06-09-transparency-coverage-and-dashboard-digest.md */}
        <Suspense fallback={<PoolDigestSectionSkeleton />}>
          <PoolDigestSectionAsync locale={locale} dict={dict} />
        </Suspense>

        <div className="flex flex-col gap-8 md:gap-12 lg:grid lg:grid-cols-12 lg:gap-x-12 lg:gap-y-12">
          <div className="lg:col-start-1 lg:col-end-6 lg:row-start-1">
            <Suspense fallback={<LastBetSectionSkeleton />}>
              <LastBetSectionAsync locale={locale} dict={dict} userId={userId} />
            </Suspense>
          </div>
          <div className="lg:col-start-6 lg:col-end-13 lg:row-start-1">
            <Suspense fallback={<TrendSectionSkeleton />}>
              <TrendSectionAsync locale={locale} dict={dict} userId={userId} />
            </Suspense>
          </div>
          <div className="lg:col-start-6 lg:col-end-13 lg:row-start-2">
            <Suspense fallback={<LeaderboardSectionSkeleton />}>
              <LeaderboardSectionAsync locale={locale} dict={dict} userId={userId} />
            </Suspense>
          </div>
          <div className="lg:col-start-1 lg:col-end-6 lg:row-start-2 flex flex-col gap-4">
            <SpecialsCard locale={locale} isHebrew={isHebrew} />
            <Suspense fallback={null}>
              <CommunityCardAsync locale={locale} dict={dict} />
            </Suspense>
          </div>
        </div>

        {/* Latest news preview — 3 most recent headlines from the
            tournament archive with a link into the full News tab. Sits
            above the prize strip so the bottom of the dashboard fades
            into reference material (prize breakdown, install hint)
            rather than ending on a hard CTA. */}
        <Suspense fallback={<LatestNewsSectionSkeleton />}>
          <LatestNewsSectionAsync locale={locale} dict={dict} />
        </Suspense>

        {/* Prize breakdown lives at the bottom of the dashboard now —
            the pot/participants summary in the hero already tells users
            the headline numbers, so the detailed per-category split is
            reference material, not the centerpiece. */}
        <Suspense fallback={<PrizeStripSkeleton />}>
          <PrizeStripAsync locale={locale} />
        </Suspense>

        <InstallHint locale={locale as "he" | "en"} />
      </div>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────
// Streamed section wrappers. Each one is a server component that
// owns a single (or small group of) DB queries and renders the
// existing presentation component. React server components fan their
// data fetches out in parallel automatically, so the practical
// behavior is that all sections race to finish; the fastest paints
// first, the slowest paints last, and the shell is interactive the
// whole time.
// ────────────────────────────────────────────────────────────────────

async function HeroStatsCardAsync({
  locale,
  dict,
}: {
  locale: Locale;
  dict: Awaited<ReturnType<typeof getDictionary>>;
}) {
  // getCurrentStage joins the fan-out so the stage label paints in the
  // same Suspense tick as the pot/participants; it is cheap and reuses
  // CACHE_TAG_FIXTURES so admin sync keeps it honest.
  const [pool, tournamentStart, currentStage] = await Promise.all([
    getPoolStats(),
    getTournamentStart(),
    getCurrentStage(),
  ]);
  const isHebrew = locale === "he";
  const countdown = tournamentStart ? computeCountdown(tournamentStart) : null;
  return (
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
                  ? currentStageLabel(currentStage, locale)
                  : formatCountdownShort(countdown, locale)
                : "-"
            }
            label={
              countdown?.started
                ? (isHebrew ? "השלב הנוכחי" : "Current stage")
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
  );
}

async function PrizeStripAsync({ locale }: { locale: Locale }) {
  const prize = await getCategoryPrizeBreakdown();
  return <CategoryPrizeStrip prize={prize} locale={locale} />;
}

async function StatusRowAsync({
  locale,
  dict,
  userId,
}: {
  locale: Locale;
  dict: Awaited<ReturnType<typeof getDictionary>>;
  userId: string;
}) {
  const rankInfo = await getMyRankSummary(userId);
  return <StatusRow locale={locale} dict={dict} rankInfo={rankInfo} />;
}

async function UpcomingSectionAsync({
  locale,
  dict,
  userId,
}: {
  locale: Locale;
  dict: Awaited<ReturnType<typeof getDictionary>>;
  userId: string;
}) {
  // These five fan out in parallel; the section paints when all
  // resolve. `lockMinutes`, `scoring` and `bankBalance` are all cheap
  // single-row lookups; the heavy one is the fixtures query. The two
  // new lookups feed the per-card scenarios panel.
  const [upcoming, access, lockMinutes, scoringRow, bankBalance] = await Promise.all([
    getUpcomingFixtures(userId, 6),
    getUserAccess(userId),
    getBetLockMinutes(),
    getSettingsRow(),
    getBankBalance(userId),
  ]);
  const scoring = {
    exact: scoringRow?.scoringExact ?? 15,
    outcome: scoringRow?.scoringOutcome ?? 5,
    riskEnabled: scoringRow?.matchRiskEnabled ?? false,
    penalty: scoringRow?.matchRiskPenalty ?? 5,
  };
  return (
    <UpcomingSection
      locale={locale}
      dict={dict}
      upcoming={upcoming}
      canEdit={access.canEdit}
      lockMinutes={lockMinutes}
      bankBalance={bankBalance}
      scoring={scoring}
    />
  );
}

async function LastBetSectionAsync({
  locale,
  dict,
  userId,
}: {
  locale: Locale;
  dict: Awaited<ReturnType<typeof getDictionary>>;
  userId: string;
}) {
  const lastFinal = await getLatestFinalForUser(userId);
  return <LastBetSection locale={locale} dict={dict} lastFinal={lastFinal} />;
}

async function TrendSectionAsync({
  locale,
  dict,
  userId,
}: {
  locale: Locale;
  dict: Awaited<ReturnType<typeof getDictionary>>;
  userId: string;
}) {
  const trend = await getPointsTrend(userId);
  return <TrendSection locale={locale} dict={dict} trend={trend} />;
}

async function LeaderboardSectionAsync({
  locale,
  dict,
  userId,
}: {
  locale: Locale;
  dict: Awaited<ReturnType<typeof getDictionary>>;
  userId: string;
}) {
  const board = await getLeaderboard(userId);
  return <LeaderboardSection locale={locale} dict={dict} board={board} />;
}

async function LatestNewsSectionAsync({
  locale,
  dict,
}: {
  locale: Locale;
  dict: Awaited<ReturnType<typeof getDictionary>>;
}) {
  const lang: "he" | "en" = locale === "he" ? "he" : "en";
  const page = await loadNewsArchivePage({ lang, limit: 3 });
  return (
    <LatestNewsSection locale={locale} dict={dict} items={page.items} />
  );
}

async function PoolDigestSectionAsync({
  locale,
  dict,
}: {
  locale: Locale;
  dict: Awaited<ReturnType<typeof getDictionary>>;
}) {
  const lang: "he" | "en" = locale === "he" ? "he" : "en";
  const [settingsRow, digest] = await Promise.all([
    getSettingsRow(),
    getTransparencyDigest(lang),
  ]);
  // The admin toggle defaults to enabled; an explicit `false` mutes
  // the widget without changing the page layout (the empty section
  // simply returns null and the bottom grid moves up to occupy the
  // freed space). Skips the digest fetch's render cost, not its DB
  // round-trip — the toggle is cheap to read separately.
  if (settingsRow?.dashboardDigestEnabled === false) {
    return null;
  }
  return (
    <PoolDigestSection
      locale={locale}
      dict={{
        poolDigestTitle: dict.dashboard.poolDigestTitle,
        poolDigestSummary: dict.dashboard.poolDigestSummary,
        poolDigestEmpty: dict.dashboard.poolDigestEmpty,
        poolDigestCta: dict.dashboard.poolDigestCta,
        poolDigestVoteSingle: dict.dashboard.poolDigestVoteSingle,
        poolDigestUnanimous: dict.dashboard.poolDigestUnanimous,
      }}
      transparencyDict={{
        categoryMatch: dict.transparency.categoryMatch,
        categoryLive: dict.transparency.categoryLive,
        categoryTournament: dict.transparency.categoryTournament,
        categoryGroup: dict.transparency.categoryGroup,
        categoryDuel: dict.transparency.categoryDuel,
      }}
      digest={digest}
    />
  );
}

// Legacy non-streaming variant kept only for the `?preview=player`
// dev escape hatch. Mock data has no DB to wait on, so the streaming
// machinery would only add boilerplate without any payoff here.
function PlayerHomePreview({
  locale,
  dict,
  pool,
  tournamentStart,
  currentStage,
  data,
  prize,
  canEdit,
  lockMinutes,
}: {
  locale: Locale;
  dict: Awaited<ReturnType<typeof getDictionary>>;
  pool: { potIls: number; participants: number };
  tournamentStart: string | null;
  currentStage: CurrentStage | null;
  data: DashboardData;
  prize: CategoryPrizeBreakdown;
  canEdit: boolean;
  lockMinutes: number;
}) {
  const isHebrew = locale === "he";
  const countdown = tournamentStart ? computeCountdown(tournamentStart) : null;

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
                    ? currentStageLabel(currentStage, locale)
                    : formatCountdownShort(countdown, locale)
                  : "-"
              }
              label={
                countdown?.started
                  ? (isHebrew ? "השלב הנוכחי" : "Current stage")
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
        <StatusRow locale={locale} dict={dict} rankInfo={data.rankInfo} />

        <UpcomingSection
          locale={locale}
          dict={dict}
          upcoming={data.upcoming}
          canEdit={canEdit}
          lockMinutes={lockMinutes}
          bankBalance={30}
          scoring={{
            exact: 15,
            outcome: 5,
            riskEnabled: false,
            penalty: 5,
          }}
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

        <CategoryPrizeStrip prize={prize} locale={locale} />

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
    <div className="flex flex-col items-center gap-1 md:flex-row md:justify-center md:gap-2 min-w-0 text-center">
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
    <span className="text-on-surface-variant">-</span>
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
              <span className="text-on-surface-variant">-</span>
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
  lockMinutes,
  canEdit,
  bankBalance,
  scoring,
}: {
  locale: Locale;
  dict: Awaited<ReturnType<typeof getDictionary>>;
  upcoming: FixtureWithMyBet[];
  lockMinutes: number;
  canEdit: boolean;
  bankBalance: number;
  scoring: {
    exact: number;
    outcome: number;
    riskEnabled: boolean;
    penalty: number;
  };
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
          href={localePath(locale, "bets")}
          className="font-[family-name:var(--font-label)] text-[12px] font-bold tracking-[0.05em] text-primary hover:underline inline-flex items-center gap-1 min-h-[44px]"
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
            <DashboardPickCard
              key={m.id}
              locale={locale}
              match={{
                id: m.id,
                homeCode: m.homeCode,
                homeNameHe: m.homeNameHe,
                homeNameEn: m.homeNameEn,
                awayCode: m.awayCode,
                awayNameHe: m.awayNameHe,
                awayNameEn: m.awayNameEn,
                kickoffAt: m.kickoffAt,
                status: m.status,
                myHome: m.myHome,
                myAway: m.myAway,
              }}
              countdownLabel={formatRelative(m.kickoffAt, locale)}
              canEdit={canEdit}
              lockMinutes={lockMinutes}
              bankBalance={bankBalance}
              scoring={scoring}
            />
          ))}
        </div>
      )}
    </section>
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
                ? "הגרף יתחיל להתמלא כשהמשחקים יסתיימו והנקודות יחושבו."
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
          {hasBet ? (
            <ScoreLine
              home={match.myHome!}
              away={match.myAway!}
              className="font-[family-name:var(--font-score)] text-[24px] md:text-[28px] leading-none tracking-[0.1em] font-bold text-on-surface"
            />
          ) : (
            <span className="font-[family-name:var(--font-score)] text-[24px] md:text-[28px] leading-none tracking-[0.1em] font-bold text-on-surface tabular-nums">
              -
            </span>
          )}
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

function LatestNewsSection({
  locale,
  dict,
  items,
}: {
  locale: Locale;
  dict: Awaited<ReturnType<typeof getDictionary>>;
  items: NewsArchiveItem[];
}) {
  const isHebrew = locale === "he";
  return (
    <section
      aria-labelledby="latest-news-heading"
      className="flex flex-col gap-4 md:gap-6"
    >
      <div className="flex justify-between items-end">
        <SectionHeading as="h3">
          <span id="latest-news-heading">
            {dict.dashboard.latestNewsTitle}
          </span>
        </SectionHeading>
        <Link
          href={`${localePath(locale, "tournament")}?tab=news`}
          className="font-[family-name:var(--font-label)] text-[12px] font-bold tracking-[0.05em] text-primary hover:underline inline-flex items-center gap-1 min-h-[44px]"
        >
          {dict.dashboard.viewAll}
          <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2} />
        </Link>
      </div>
      {items.length === 0 ? (
        <Card className="p-6 text-center text-on-surface-variant">
          {dict.dashboard.latestNewsEmpty}
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          <ul className="flex flex-col">
            {items.map((item, i) => (
              <li
                key={item.id}
                className={i > 0 ? "border-t border-outline-variant" : ""}
              >
                <LatestNewsCard
                  item={item}
                  locale={locale}
                  isHebrew={isHebrew}
                />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}

function LatestNewsCard({
  item,
  locale,
  isHebrew,
}: {
  item: NewsArchiveItem;
  locale: Locale;
  isHebrew: boolean;
}) {
  const dateLabel = formatDateTime(item.publishedAt, locale, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <a
      href={item.link}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={item.title}
      className="press-down flex gap-3 p-3 md:p-4 min-h-[88px] hover:bg-surface-container transition-colors"
    >
      {item.imageUrl ? (
        <div className="relative shrink-0 w-[64px] h-[64px] md:w-[80px] md:h-[80px] rounded-md overflow-hidden bg-surface-variant">
          <Image
            src={item.imageUrl}
            alt=""
            fill
            sizes="(min-width: 768px) 80px, 64px"
            className="object-cover"
            unoptimized
          />
        </div>
      ) : (
        <div className="shrink-0 w-[64px] h-[64px] md:w-[80px] md:h-[80px] rounded-md bg-surface-variant flex items-center justify-center text-on-surface-variant">
          <Newspaper className="h-5 w-5" strokeWidth={1.75} />
        </div>
      )}
      <div className="flex flex-col gap-1 min-w-0 flex-1 justify-center">
        <h4 className="font-bold text-on-surface text-[14px] md:text-[15px] leading-snug line-clamp-2">
          {item.title}
        </h4>
        <div className="flex items-center gap-2 flex-wrap text-on-surface-variant text-xs">
          <span>{newsSourceLabel(item.source, isHebrew)}</span>
          <span aria-hidden>·</span>
          <time
            className="bidi-ltr"
            dateTime={new Date(item.publishedAt).toISOString()}
          >
            {dateLabel}
          </time>
        </div>
      </div>
      <ExternalLink
        className="h-4 w-4 text-on-surface-variant shrink-0 self-center"
        strokeWidth={2}
      />
    </a>
  );
}

function newsSourceLabel(source: NewsSource, isHebrew: boolean): string {
  switch (source) {
    case "walla":
      return isHebrew ? "וואלה ספורט" : "Walla Sport";
    case "ynet":
      return isHebrew ? "Ynet ספורט" : "Ynet Sport";
    case "bbc":
      return "BBC Sport";
  }
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
      href={localePath(locale, "bets")}
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
            {isHebrew ? "כל ההימורים" : "All bets"}
          </span>
          <span className="text-sm text-on-surface-variant truncate">
            {isHebrew
              ? "ניחושי משחקים, לייב, טורניר ובתים"
              : "Match picks, live, tournament, groups"}
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

// Streamed dashboard companion to SpecialsCard: opens the pool's
// WhatsApp invite. Sits in the same bottom-left cell as Specials so
// the "ways to engage outside the bets surface" cluster reads as one
// unit. Returns null when the admin clears the URL OR the user has
// dismissed it - both leave just SpecialsCard in the cell rather than
// a hole.
async function CommunityCardAsync({
  locale,
  dict,
}: {
  locale: Locale;
  dict: Awaited<ReturnType<typeof getDictionary>>;
}) {
  const row = await getSettingsRow();
  const url = row?.whatsappGroupUrl ?? null;
  if (!url) return null;
  const dismissed = await isWhatsAppCardDismissed(url);
  const isHebrew = locale === "he";
  return (
    <WhatsAppInviteCard
      locale={locale}
      url={url}
      variant="compact"
      title={dict.profile.whatsappTitle}
      subtitle={
        isHebrew
          ? "עדכונים, ויכוחים על משחקים והקנטות בין החברים"
          : "Live banter and updates with the rest of the pool"
      }
      ctaLabel={dict.profile.whatsappCta}
      closeLabel={dict.profile.whatsappDismiss}
      initialDismissed={dismissed}
    />
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
          className="font-[family-name:var(--font-label)] text-[12px] font-bold tracking-[0.05em] text-primary hover:underline inline-flex items-center gap-1 min-h-[44px]"
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
          ? "אין עדיין משתתפים מדורגים. הטבלה תתעדכן ברגע שייסגרו הימורים."
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
  const hours = Math.round(diff / MS_PER_HOUR);
  if (hours < 24) {
    return isHebrew ? `בעוד ${hours} שעות` : `in ${hours}h`;
  }
  const days = Math.round(hours / 24);
  if (days < 7) {
    return isHebrew ? `בעוד ${days} ימים` : `in ${days}d`;
  }
  return formatDateTime(iso, locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
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
  const totalHours = Math.floor(diff / MS_PER_HOUR);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return { days, hours, started: false };
}
