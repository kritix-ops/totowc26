import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  LogOut,
  ChevronLeft,
  ChevronRight,
  ListChecks,
  Radio,
  Trophy,
  Swords,
  Target,
  Crosshair,
  Flame,
  ArrowUpRight,
  Check,
  X as XIcon,
  Clock,
  Lock,
  CircleDot,
  Bell,
} from "lucide-react";
import { clsx } from "clsx";
import { getDictionary, hasLocale, type Locale } from "../dictionaries";
import { getRequestUser } from "@/lib/request-user";
import {
  getProfileStats,
  getMyHistory,
  getMyCustomPicks,
  getMyDuels,
  type ProfileStats,
  type HistoryRow,
  type MyCustomPickRow,
  type MyDuelRow,
} from "@/db/queries";
import { db } from "@/db";
import { profiles, settings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { Card, LabelCaps, SectionHeading, Chip } from "@/components/ui";
import { Flag } from "@/components/Flag";
import { PushOptInToggle } from "@/components/PushOptInToggle";
import { WhatsAppInviteCard } from "@/components/WhatsAppInviteCard";
import { isWhatsAppCardDismissed } from "@/lib/whatsapp-dismiss";
import { countUnreadNotifications } from "@/lib/notifications";
import { localePath } from "@/lib/paths";
import { formatDateTime } from "@/lib/format";
import type {
  AnswerConfig,
  MultiChoiceConfig,
  PickAnswer,
  ResolvedValue,
} from "@/lib/bets/types";

export default async function ProfilePage({
  params,
}: PageProps<"/[lang]/profile">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const dict = await getDictionary(locale);

  const user = await getRequestUser();
  if (!user) redirect(localePath(locale, "login"));

  const [
    [profile],
    stats,
    matchPicks,
    liveBetPicks,
    tournamentBetPicks,
    duelPicks,
    unreadCount,
    [settingsRow],
  ] = await Promise.all([
    db
      .select({
        displayName: profiles.displayName,
        role: profiles.role,
        pushOptIn: profiles.pushOptIn,
      })
      .from(profiles)
      .where(eq(profiles.id, user.id))
      .limit(1),
    getProfileStats(user.id),
    getMyHistory(user.id, 5),
    getMyCustomPicks(user.id, ["match", "day"], 5),
    getMyCustomPicks(user.id, ["tournament", "stage", "group"], 5),
    getMyDuels(user.id, 5),
    countUnreadNotifications(user.id),
    db
      .select({ whatsappGroupUrl: settings.whatsappGroupUrl })
      .from(settings)
      .where(eq(settings.id, 1))
      .limit(1),
  ]);

  const whatsappUrl = settingsRow?.whatsappGroupUrl ?? null;
  const whatsappDismissed = await isWhatsAppCardDismissed(whatsappUrl);
  const isHebrew = locale === "he";
  const displayName = profile?.displayName ?? (user.email ?? "");
  const initials = displayName.charAt(0).toUpperCase();
  const memberSinceLabel = stats.memberSince
    ? formatDateTime(stats.memberSince, locale, {
        month: "short",
        year: "numeric",
      })
    : "-";

  return (
    <section className="px-4 md:px-16 py-6 md:py-12 flex flex-col gap-8 md:gap-10 max-w-3xl mx-auto w-full pb-24">
      <header className="flex items-center gap-4 md:gap-6">
        <div
          className="w-20 h-20 md:w-24 md:h-24 rounded-full bg-primary text-on-primary flex items-center justify-center text-3xl md:text-4xl font-bold ring-2 ring-tertiary-fixed-dim shrink-0"
          aria-hidden
        >
          {initials}
        </div>
        <div className="flex flex-col gap-1 min-w-0">
          <h1 className="font-[family-name:var(--font-display)] text-[26px] leading-9 md:text-[40px] md:leading-[44px] font-bold text-on-surface truncate">
            {displayName}
          </h1>
          <p className="text-sm md:text-base text-on-surface-variant">
            {dict.profile.memberSince} {memberSinceLabel}
          </p>
          {profile?.role === "admin" && (
            <p className="text-xs font-bold text-tertiary">
              {isHebrew ? "אדמין" : "Admin"}
            </p>
          )}
        </div>
      </header>

      <section className="flex flex-col gap-4 md:gap-5">
        <SectionHeading>{dict.profile.stats}</SectionHeading>

        <BalanceHero locale={locale} dict={dict} stats={stats} />

        <PointsBreakdown locale={locale} dict={dict} stats={stats} />

        <AccuracyBlock locale={locale} dict={dict} stats={stats} />
      </section>

      <MyPicksSection
        locale={locale}
        dict={dict}
        matchPicks={matchPicks}
        liveBetPicks={liveBetPicks}
        tournamentBetPicks={tournamentBetPicks}
        duelPicks={duelPicks}
      />

      <section className="flex flex-col gap-4">
        <SectionHeading>
          {isHebrew ? "התראות" : "Notifications"}
        </SectionHeading>
        <Link
          href={localePath(locale, "notifications")}
          className="press-down"
        >
          <Card className="p-4 md:p-5 flex items-center gap-3 min-h-[64px] hover:bg-surface-container transition-colors">
            <div className="w-10 h-10 rounded-full bg-primary-fixed text-on-primary-fixed-variant flex items-center justify-center shrink-0 relative">
              <Bell className="h-5 w-5" strokeWidth={1.75} />
              {unreadCount > 0 && (
                <span
                  className="absolute -top-1 -end-1 min-w-[18px] h-[18px] px-1 rounded-full bg-error text-on-error text-[10px] font-bold inline-flex items-center justify-center tabular-nums"
                  aria-label={
                    isHebrew
                      ? `${unreadCount} התראות חדשות`
                      : `${unreadCount} unread`
                  }
                >
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm text-on-surface">
                {isHebrew ? "כל ההתראות" : "All notifications"}
              </p>
              <p className="text-xs text-on-surface-variant">
                {unreadCount > 0
                  ? isHebrew
                    ? `${unreadCount} חדשות`
                    : `${unreadCount} unread`
                  : isHebrew
                    ? "אין התראות חדשות"
                    : "No unread"}
              </p>
            </div>
            {isHebrew ? (
              <ChevronLeft className="h-4 w-4 text-on-surface-variant shrink-0" />
            ) : (
              <ChevronRight className="h-4 w-4 text-on-surface-variant shrink-0" />
            )}
          </Card>
        </Link>
      </section>

      {whatsappUrl && (
        <WhatsAppInviteCard
          locale={locale}
          url={whatsappUrl}
          variant="spotlight"
          title={dict.profile.whatsappTitle}
          subtitle={dict.profile.whatsappSubtitle}
          ctaLabel={dict.profile.whatsappCta}
          closeLabel={dict.profile.whatsappDismiss}
          initialDismissed={whatsappDismissed}
        />
      )}

      <section className="flex flex-col gap-4">
        <SectionHeading>{dict.profile.settings}</SectionHeading>
        <Card className="p-0 overflow-hidden">
          <SettingRow
            label={dict.profile.language}
            value={isHebrew ? "עברית" : "English"}
            isHebrew={isHebrew}
          />
          <PushOptInToggle
            locale={locale}
            initialOptIn={profile?.pushOptIn ?? false}
          />
          <form action="/auth/signout" method="POST">
            <button
              type="submit"
              className="w-full min-h-[56px] flex items-center justify-between gap-3 px-5 py-4 text-error hover:bg-error-container transition-colors"
            >
              <span className="font-bold">{dict.profile.logout}</span>
              <LogOut className="h-5 w-5" strokeWidth={1.75} />
            </button>
          </form>
        </Card>
      </section>
    </section>
  );
}

// Balance hero. Total points (= bank balance, = leaderboard score) and
// the same number framed as "available to bet". They are equal because
// every stake is debited from the bank when placed - showing both
// surfaces the two mental questions a player has (where do I stand?
// what can I still wager?) without confusing them with a second figure
// that doesn't exist in the accounting model.
function BalanceHero({
  locale,
  dict,
  stats,
}: {
  locale: Locale;
  dict: Awaited<ReturnType<typeof getDictionary>>;
  stats: ProfileStats;
}) {
  const isHebrew = locale === "he";
  const totalLabel = dict.profile.totalPoints;
  const availableLabel = dict.profile.availablePoints;
  const hint = dict.profile.balanceHint;

  return (
    <Card className="p-5 md:p-7 flex flex-col gap-4 md:gap-5 bg-gradient-to-br from-primary-fixed via-surface-container-low to-surface-container-low">
      <div className="grid grid-cols-2 gap-3 md:gap-6">
        <div className="flex flex-col gap-1">
          <LabelCaps as="div" className="text-on-primary-fixed-variant">
            {totalLabel}
          </LabelCaps>
          <div className="font-[family-name:var(--font-display)] text-[40px] md:text-[56px] leading-none font-bold text-primary tabular-nums">
            <span className="bidi-ltr">{stats.totalPoints.toLocaleString(isHebrew ? "he-IL" : "en-US")}</span>
          </div>
          <span className="font-[family-name:var(--font-label)] text-[11px] tracking-[0.05em] text-on-surface-variant">
            {isHebrew ? "נק'" : "pts"}
          </span>
        </div>

        <div className="flex flex-col gap-1 border-s border-outline-variant ps-3 md:ps-6">
          <LabelCaps as="div">{availableLabel}</LabelCaps>
          <div className="font-[family-name:var(--font-display)] text-[32px] md:text-[44px] leading-none font-bold text-on-surface tabular-nums">
            <span className="bidi-ltr">{stats.availablePoints.toLocaleString(isHebrew ? "he-IL" : "en-US")}</span>
          </div>
          <span className="font-[family-name:var(--font-label)] text-[11px] tracking-[0.05em] text-on-surface-variant">
            {isHebrew ? "נק'" : "pts"}
          </span>
        </div>
      </div>
      <p className="text-xs md:text-sm text-on-surface-variant leading-snug">
        {hint}
      </p>
    </Card>
  );
}

// Per-category breakdown. Net contribution to the bank from each bet
// surface, signed. Positive numbers tint green (secondary), losses
// tint red (error), zero is muted - colour is doing the work so the
// user can scan the breakdown without reading each number.
function PointsBreakdown({
  locale,
  dict,
  stats,
}: {
  locale: Locale;
  dict: Awaited<ReturnType<typeof getDictionary>>;
  stats: ProfileStats;
}) {
  const isHebrew = locale === "he";

  type CategoryDef = {
    key: string;
    label: string;
    href: string;
    icon: typeof ListChecks;
    value: number;
  };

  const cats: CategoryDef[] = [
    {
      key: "matches",
      label: dict.profile.pointsFromMatches,
      href: localePath(locale, "bets"),
      icon: ListChecks,
      value: stats.pointsFromMatches,
    },
    {
      key: "live",
      label: dict.profile.pointsFromLiveBets,
      href: localePath(locale, "bets/live"),
      icon: Radio,
      value: stats.pointsFromLiveBets,
    },
    {
      key: "tournament",
      label: dict.profile.pointsFromTournamentBets,
      href: localePath(locale, "bets/tournament"),
      icon: Trophy,
      value: stats.pointsFromTournamentBets,
    },
    {
      key: "duels",
      label: dict.profile.pointsFromDuels,
      href: localePath(locale, "duels"),
      icon: Swords,
      value: stats.pointsFromDuels,
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-[family-name:var(--font-display)] text-[16px] md:text-[18px] font-bold text-on-surface">
        {dict.profile.pointsByCategory}
      </h3>
      <ul className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {cats.map((c) => (
          <li key={c.key}>
            <Link
              href={c.href}
              className="block press-down h-full"
              aria-label={c.label}
            >
              <Card className="p-4 md:p-5 flex flex-col gap-2 h-full hover:bg-surface-container transition-colors min-h-[120px]">
                <div className="flex items-center gap-2">
                  <c.icon
                    className="h-4 w-4 text-tertiary-fixed-dim shrink-0"
                    strokeWidth={1.75}
                  />
                  <LabelCaps as="span" className="truncate">
                    {c.label}
                  </LabelCaps>
                </div>
                <div className="flex items-baseline gap-1 mt-auto">
                  <span
                    className={clsx(
                      "font-[family-name:var(--font-display)] text-2xl md:text-3xl leading-none font-bold tabular-nums bidi-ltr",
                      c.value > 0
                        ? "text-secondary"
                        : c.value < 0
                          ? "text-error"
                          : "text-on-surface",
                    )}
                  >
                    {c.value > 0 ? "+" : ""}
                    {c.value.toLocaleString(isHebrew ? "he-IL" : "en-US")}
                  </span>
                  <span className="text-[11px] text-on-surface-variant">
                    {isHebrew ? "נק'" : "pts"}
                  </span>
                </div>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
      {stats.pointsFromAdjustments !== 0 && (
        <Card className="p-3 px-4 flex items-center justify-between gap-3">
          <span className="text-xs md:text-sm text-on-surface-variant inline-flex items-center gap-2">
            <Flame className="h-3.5 w-3.5 text-tertiary-fixed-dim" strokeWidth={1.75} />
            {dict.profile.pointsFromAdjustments}
          </span>
          <span
            className={clsx(
              "font-[family-name:var(--font-display)] text-base md:text-lg font-bold tabular-nums bidi-ltr",
              stats.pointsFromAdjustments > 0
                ? "text-secondary"
                : "text-error",
            )}
          >
            {stats.pointsFromAdjustments > 0 ? "+" : ""}
            {stats.pointsFromAdjustments}
          </span>
        </Card>
      )}
    </div>
  );
}

// Match-pick accuracy. The headline metric is "70 / 72" - correct
// outcomes over total finished matches in the tournament. We use the
// tournament-wide denominator (not just bets the user placed) so the
// number captures both wrong picks and missed picks; that is the
// number a friends-pool player actually cares about.
function AccuracyBlock({
  locale,
  dict,
  stats,
}: {
  locale: Locale;
  dict: Awaited<ReturnType<typeof getDictionary>>;
  stats: ProfileStats;
}) {
  void locale;
  const denom = stats.totalFinalMatches;
  const hasFinals = denom > 0;
  const exact = stats.exactCount;
  const correct = stats.correctOutcomeCount;
  const pct = hasFinals ? Math.round((correct / denom) * 100) : 0;
  const exactPct = hasFinals ? Math.round((exact / denom) * 100) : 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <Card className="p-4 md:p-5 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Target
            className="h-4 w-4 text-primary shrink-0"
            strokeWidth={1.75}
          />
          <LabelCaps as="span">{dict.profile.matchAccuracy}</LabelCaps>
        </div>
        {hasFinals ? (
          <>
            <div className="flex items-baseline gap-2">
              <span className="font-[family-name:var(--font-display)] text-[42px] md:text-[52px] leading-none font-bold text-primary tabular-nums bidi-ltr">
                {correct}
              </span>
              <span className="font-[family-name:var(--font-display)] text-2xl md:text-3xl font-bold text-on-surface-variant tabular-nums bidi-ltr">
                / {denom}
              </span>
              <span className="ms-auto font-[family-name:var(--font-label)] text-xs font-bold text-on-surface-variant bidi-ltr">
                {pct}%
              </span>
            </div>
            <ProgressBar value={pct} tone="primary" />
          </>
        ) : (
          <div className="font-[family-name:var(--font-display)] text-base text-on-surface-variant">
            {dict.profile.noFinalMatchesYet}
          </div>
        )}
        <p className="text-[11px] md:text-xs text-on-surface-variant leading-snug">
          {dict.profile.matchAccuracyHint}
        </p>
      </Card>

      <Card className="p-4 md:p-5 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Crosshair
            className="h-4 w-4 text-secondary shrink-0"
            strokeWidth={1.75}
          />
          <LabelCaps as="span">{dict.profile.exactScores}</LabelCaps>
        </div>
        {hasFinals ? (
          <>
            <div className="flex items-baseline gap-2">
              <span className="font-[family-name:var(--font-display)] text-[42px] md:text-[52px] leading-none font-bold text-secondary tabular-nums bidi-ltr">
                {exact}
              </span>
              <span className="font-[family-name:var(--font-display)] text-2xl md:text-3xl font-bold text-on-surface-variant tabular-nums bidi-ltr">
                / {denom}
              </span>
              <span className="ms-auto font-[family-name:var(--font-label)] text-xs font-bold text-on-surface-variant bidi-ltr">
                {exactPct}%
              </span>
            </div>
            <ProgressBar value={exactPct} tone="secondary" />
          </>
        ) : (
          <div className="font-[family-name:var(--font-display)] text-base text-on-surface-variant">
            {dict.profile.noFinalMatchesYet}
          </div>
        )}
        <p className="text-[11px] md:text-xs text-on-surface-variant leading-snug">
          {dict.profile.exactScoresHint}
        </p>
      </Card>

      {stats.streak > 0 && (
        <Card className="p-4 md:col-span-2 flex items-center gap-3">
          <Flame className="h-5 w-5 text-tertiary shrink-0" strokeWidth={1.75} />
          <span className="text-sm md:text-base font-bold text-on-surface">
            {dict.profile.streak}
          </span>
          <span className="ms-auto font-[family-name:var(--font-display)] text-2xl font-bold text-tertiary tabular-nums bidi-ltr">
            {stats.streak}
          </span>
        </Card>
      )}
    </div>
  );
}

function ProgressBar({
  value,
  tone,
}: {
  value: number;
  tone: "primary" | "secondary";
}) {
  const clamped = Math.max(0, Math.min(100, value));
  const fill =
    tone === "primary" ? "bg-primary" : "bg-secondary";
  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      className="h-1.5 w-full rounded-full bg-surface-variant overflow-hidden"
    >
      <div
        className={clsx("h-full rounded-full transition-all", fill)}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

function SettingRow({
  label,
  value,
  isHebrew,
}: {
  label: string;
  value: string;
  isHebrew: boolean;
}) {
  const Chev = isHebrew ? ChevronLeft : ChevronRight;
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-outline-variant last:border-0 min-h-[56px]">
      <span className="font-bold text-on-surface">{label}</span>
      <span className="inline-flex items-center gap-1 text-on-surface-variant">
        {value}
        <Chev className="h-4 w-4" />
      </span>
    </div>
  );
}



// ─────────────────────────────────────────────────────────────────────────────
// My picks — every prediction the user has placed, grouped by surface.
//
// Four buckets, each with the 5 most recent items: match picks, live bets,
// tournament bets, duels. Empty categories show a friendly "no picks yet"
// state with a CTA to the corresponding bet surface so the user can act
// from here. Each section also has a "view all" link to its bet hub.
// ─────────────────────────────────────────────────────────────────────────────

function MyPicksSection({
  locale,
  dict,
  matchPicks,
  liveBetPicks,
  tournamentBetPicks,
  duelPicks,
}: {
  locale: Locale;
  dict: Awaited<ReturnType<typeof getDictionary>>;
  matchPicks: HistoryRow[];
  liveBetPicks: MyCustomPickRow[];
  tournamentBetPicks: MyCustomPickRow[];
  duelPicks: MyDuelRow[];
}) {
  return (
    <section className="flex flex-col gap-5 md:gap-6">
      <div className="flex flex-col gap-1">
        <SectionHeading>{dict.profile.myPicks}</SectionHeading>
        <p className="text-sm text-on-surface-variant leading-snug">
          {dict.profile.myPicksHint}
        </p>
      </div>

      <PicksBucket
        locale={locale}
        dict={dict}
        title={dict.profile.pointsFromMatches}
        icon={ListChecks}
        viewAllHref={localePath(locale, "bets")}
        emptyHref={localePath(locale, "bets")}
        isEmpty={matchPicks.length === 0}
      >
        <ul className="flex flex-col gap-2 md:gap-3">
          {matchPicks.map((p) => (
            <li key={p.matchId}>
              <MatchPickRow locale={locale} dict={dict} pick={p} />
            </li>
          ))}
        </ul>
      </PicksBucket>

      <PicksBucket
        locale={locale}
        dict={dict}
        title={dict.profile.pointsFromLiveBets}
        icon={Radio}
        viewAllHref={localePath(locale, "bets/live")}
        emptyHref={localePath(locale, "bets/live")}
        isEmpty={liveBetPicks.length === 0}
      >
        <ul className="flex flex-col gap-2 md:gap-3">
          {liveBetPicks.map((p) => (
            <li key={p.pickId}>
              <CustomBetPickRow locale={locale} dict={dict} pick={p} />
            </li>
          ))}
        </ul>
      </PicksBucket>

      <PicksBucket
        locale={locale}
        dict={dict}
        title={dict.profile.pointsFromTournamentBets}
        icon={Trophy}
        viewAllHref={localePath(locale, "bets/tournament")}
        emptyHref={localePath(locale, "bets/tournament")}
        isEmpty={tournamentBetPicks.length === 0}
      >
        <ul className="flex flex-col gap-2 md:gap-3">
          {tournamentBetPicks.map((p) => (
            <li key={p.pickId}>
              <CustomBetPickRow locale={locale} dict={dict} pick={p} />
            </li>
          ))}
        </ul>
      </PicksBucket>

      <PicksBucket
        locale={locale}
        dict={dict}
        title={dict.profile.pointsFromDuels}
        icon={Swords}
        viewAllHref={localePath(locale, "duels")}
        emptyHref={localePath(locale, "duels")}
        isEmpty={duelPicks.length === 0}
      >
        <ul className="flex flex-col gap-2 md:gap-3">
          {duelPicks.map((d) => (
            <li key={d.duelId}>
              <DuelPickRow locale={locale} dict={dict} pick={d} />
            </li>
          ))}
        </ul>
      </PicksBucket>
    </section>
  );
}

// One labelled bucket inside MyPicksSection. Renders its own header
// (icon + title + "view all" link), and either the children list or
// a friendly empty state that doubles as a CTA into the bet surface.
function PicksBucket({
  locale,
  dict,
  title,
  icon: Icon,
  viewAllHref,
  emptyHref,
  isEmpty,
  children,
}: {
  locale: Locale;
  dict: Awaited<ReturnType<typeof getDictionary>>;
  title: string;
  icon: typeof ListChecks;
  viewAllHref: string;
  emptyHref: string;
  isEmpty: boolean;
  children: React.ReactNode;
}) {
  const isHebrew = locale === "he";
  void dict;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-3">
        <h3 className="font-[family-name:var(--font-display)] text-lg md:text-xl font-bold text-on-surface inline-flex items-center gap-2">
          <Icon
            className="h-5 w-5 text-tertiary-fixed-dim shrink-0"
            strokeWidth={1.75}
          />
          {title}
        </h3>
        {!isEmpty && (
          <Link
            href={viewAllHref}
            className="font-[family-name:var(--font-label)] text-[12px] font-bold tracking-[0.05em] text-primary hover:underline inline-flex items-center gap-1 min-h-[40px]"
          >
            {dict.profile.viewAllPicks}
            <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2} />
          </Link>
        )}
      </div>
      {isEmpty ? (
        <Link href={emptyHref} className="block press-down">
          <Card className="p-5 md:p-6 flex items-center justify-between gap-3 text-on-surface-variant hover:bg-surface-container transition-colors">
            <span className="text-sm md:text-base">
              {dict.profile.noPicksInCategory}
            </span>
            <span className="text-xs font-bold text-primary inline-flex items-center gap-1">
              {isHebrew ? "להמר" : "Place a bet"}
              <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2} />
            </span>
          </Card>
        </Link>
      ) : (
        children
      )}
    </section>
  );
}

// Compact match-pick row. Status chip + flags/teams + my pick + actual
// score (when final) + points earned. Tappable for full match drilldown.
function MatchPickRow({
  locale,
  dict,
  pick,
}: {
  locale: Locale;
  dict: Awaited<ReturnType<typeof getDictionary>>;
  pick: HistoryRow;
}) {
  const isHebrew = locale === "he";
  const Chev = isHebrew ? ChevronLeft : ChevronRight;
  const homeName = isHebrew ? pick.homeNameHe : pick.homeNameEn;
  const awayName = isHebrew ? pick.awayNameHe : pick.awayNameEn;
  const isFinal = pick.status === "final";
  const isLive = pick.status === "live";
  const hasPick = pick.myHome !== null && pick.myAway !== null;
  const points = pick.pointsEarned ?? 0;

  return (
    <Link
      href={localePath(locale, `match/${pick.matchId}`)}
      className="block press-down"
    >
      <Card className="p-3 md:p-4 flex flex-col gap-2 hover:bg-surface-container transition-colors">
        <div className="flex items-center gap-2">
          <StatusChip
            tone={isFinal ? "secondary" : isLive ? "warning" : "default"}
            label={
              isFinal
                ? dict.profile.pickStatusFinal
                : isLive
                  ? dict.profile.pickStatusLive
                  : dict.profile.pickStatusLocked
            }
          />
          <span className="text-[11px] text-on-surface-variant">
            {formatDateTime(pick.kickoffAt, locale, {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          <Chev className="h-4 w-4 text-outline shrink-0 ms-auto" />
        </div>

        <div className="flex items-center gap-2 md:gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Flag code={pick.homeCode} size={20} />
            <span className="text-xs md:text-sm font-bold truncate">
              {homeName}
            </span>
          </div>
          <span className="text-on-surface-variant text-[11px] px-0.5">
            vs
          </span>
          <div className="flex items-center gap-2 flex-1 min-w-0 justify-end">
            <span className="text-xs md:text-sm font-bold truncate text-end">
              {awayName}
            </span>
            <Flag code={pick.awayCode} size={20} />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 pt-2 border-t border-outline-variant text-xs md:text-sm">
          <div className="flex flex-col gap-0.5 min-w-0">
            <LabelCaps as="span" className="text-[10px]">
              {dict.profile.pickAnswerMine}
            </LabelCaps>
            <span className="font-[family-name:var(--font-score)] text-sm md:text-base font-bold tabular-nums bidi-ltr">
              {hasPick
                ? `${pick.myHome} - ${pick.myAway}`
                : (
                  <span className="text-on-surface-variant font-normal italic">
                    {dict.profile.pickStatusNoBet}
                  </span>
                )}
            </span>
          </div>
          {isFinal && pick.homeScore !== null && pick.awayScore !== null && (
            <div className="flex flex-col items-center gap-0.5 min-w-0">
              <LabelCaps as="span" className="text-[10px]">
                {dict.profile.pickResultActual}
              </LabelCaps>
              <span className="font-[family-name:var(--font-score)] text-sm md:text-base font-bold tabular-nums bidi-ltr">
                {pick.homeScore} - {pick.awayScore}
              </span>
            </div>
          )}
          <PointsBadge value={isFinal ? points : null} locale={locale} />
        </div>
      </Card>
    </Link>
  );
}

// Compact custom-bet pick row. Renders for both live (match/day) and
// tournament (tournament/stage/group) scopes - the only visual diff is
// the scope/stage chip in the header.
function CustomBetPickRow({
  locale,
  dict,
  pick,
}: {
  locale: Locale;
  dict: Awaited<ReturnType<typeof getDictionary>>;
  pick: MyCustomPickRow;
}) {
  const isHebrew = locale === "he";
  const question = isHebrew ? pick.questionHe : pick.questionEn;
  const answerLabel = formatPickAnswer(
    pick.myAnswer as PickAnswer,
    pick.answerConfig as AnswerConfig | null,
    locale,
  );
  const resolvedLabel = pick.resolvedValue
    ? formatPickAnswer(
        pick.resolvedValue as ResolvedValue,
        pick.answerConfig as AnswerConfig | null,
        locale,
      )
    : null;
  const isGraded = pick.status === "graded";
  const isCancelled = pick.status === "cancelled";
  const isOpen = pick.status === "open";
  const scopeChipLabel = stageOrScopeLabel(pick, dict);

  // Points delta = points_earned - stake_paid. The stake was debited
  // when the pick was placed, so the net is what shows on the row.
  const netPoints = pick.pointsEarned !== null
    ? pick.pointsEarned - pick.stakePaid
    : null;

  return (
    <Card className="p-3 md:p-4 flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <StatusChip
          tone={
            isCancelled
              ? "default"
              : isGraded
                ? (pick.wasCorrect ? "secondary" : "default")
                : isOpen
                  ? "primary"
                  : "warning"
          }
          label={
            isCancelled
              ? dict.profile.pickStatusCancelled
              : isGraded
                ? dict.profile.pickStatusGraded
                : isOpen
                  ? dict.profile.pickStatusOpen
                  : dict.profile.pickStatusLocked
          }
        />
        {scopeChipLabel && (
          <Chip className="text-[11px] py-0.5">{scopeChipLabel}</Chip>
        )}
        <span className="ms-auto text-[11px] text-on-surface-variant">
          {formatDateTime(pick.lockAt, locale, {
            day: "numeric",
            month: "short",
          })}
        </span>
      </div>

      <p className="text-sm md:text-base font-bold text-on-surface leading-snug line-clamp-2">
        {question}
      </p>

      <div className="flex items-baseline justify-between gap-3 pt-1.5 border-t border-outline-variant">
        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
          <LabelCaps as="span" className="text-[10px]">
            {dict.profile.pickAnswerMine}
          </LabelCaps>
          <span className="text-sm md:text-base font-bold text-on-surface truncate">
            {answerLabel}
          </span>
        </div>
        {isGraded && resolvedLabel && (
          <div className="flex flex-col gap-0.5 min-w-0 max-w-[40%]">
            <LabelCaps as="span" className="text-[10px]">
              {dict.profile.pickResultActual}
            </LabelCaps>
            <span
              className={clsx(
                "text-sm md:text-base font-bold truncate",
                pick.wasCorrect ? "text-secondary" : "text-on-surface-variant",
              )}
            >
              {resolvedLabel}
            </span>
          </div>
        )}
        <PointsBadge value={netPoints} locale={locale} stake={pick.stakePaid} />
      </div>
    </Card>
  );
}

// Compact duel row. The duel is either open (waiting for joiner),
// matched (locked in, waiting on result), settled (won/lost), or
// cancelled (refunded). Each state renders its own primary affordance.
function DuelPickRow({
  locale,
  dict,
  pick,
}: {
  locale: Locale;
  dict: Awaited<ReturnType<typeof getDictionary>>;
  pick: MyDuelRow;
}) {
  const isHebrew = locale === "he";
  const Chev = isHebrew ? ChevronLeft : ChevronRight;
  const question = isHebrew ? pick.questionHe : pick.questionEn;
  const yesNo = pick.myAnswer
    ? dict.profile.pickAnswerYes
    : dict.profile.pickAnswerNo;
  const isSettled = pick.status === "settled";
  const isCancelled = pick.status === "cancelled";
  const isOpen = pick.status === "open";
  const isMatched = pick.status === "matched";
  const won = isSettled && pick.myPointsDelta > 0;

  let statusLabel = dict.profile.pickStatusOpen;
  let statusTone: "default" | "primary" | "secondary" | "warning" = "primary";
  if (isCancelled) {
    statusLabel = dict.profile.pickStatusCancelled;
    statusTone = "default";
  } else if (isSettled) {
    statusLabel = won
      ? dict.profile.pickAnswerCorrect
      : dict.profile.pickAnswerWrong;
    statusTone = won ? "secondary" : "default";
  } else if (isMatched) {
    statusLabel = dict.profile.pickStatusMatched;
    statusTone = "warning";
  }

  return (
    <Link
      href={localePath(locale, `duels/${pick.duelId}`)}
      className="block press-down"
    >
      <Card className="p-3 md:p-4 flex flex-col gap-2 hover:bg-surface-container transition-colors">
        <div className="flex items-center gap-2 flex-wrap">
          <StatusChip tone={statusTone} label={statusLabel} />
          <span className="ms-auto text-[11px] text-on-surface-variant">
            {formatDateTime(pick.createdAt, locale, {
              day: "numeric",
              month: "short",
            })}
          </span>
        </div>

        <p className="text-sm md:text-base font-bold text-on-surface leading-snug line-clamp-2">
          {question}
        </p>

        <div className="flex items-baseline justify-between gap-3 pt-1.5 border-t border-outline-variant">
          <div className="flex flex-col gap-0.5 min-w-0 flex-1">
            <LabelCaps as="span" className="text-[10px]">
              {dict.profile.pickAnswerMine}
            </LabelCaps>
            <span className="text-sm md:text-base font-bold text-on-surface truncate inline-flex items-center gap-1">
              {pick.myAnswer ? (
                <Check className="h-3.5 w-3.5 text-secondary" strokeWidth={2.5} />
              ) : (
                <XIcon className="h-3.5 w-3.5 text-error" strokeWidth={2.5} />
              )}
              {yesNo}
            </span>
          </div>
          <div className="flex flex-col gap-0.5 min-w-0 max-w-[40%]">
            <LabelCaps as="span" className="text-[10px]">
              {dict.profile.pickDuelOpponent}
            </LabelCaps>
            <span className="text-sm md:text-base font-bold text-on-surface-variant truncate">
              {pick.opponentDisplayName
                ?? (isOpen
                  ? dict.profile.pickDuelAwaiting
                  : "—")}
            </span>
          </div>
          <PointsBadge
            value={isSettled ? pick.myPointsDelta : null}
            locale={locale}
            stake={pick.stake}
          />
          <Chev className="h-4 w-4 text-outline shrink-0" />
        </div>
      </Card>
    </Link>
  );
}

// Small bordered chip used in every pick-row header for the status.
// Keeps the visual language consistent across categories so the user
// reads "this is settled" / "this is open" the same way every time.
function StatusChip({
  tone,
  label,
}: {
  tone: "default" | "primary" | "secondary" | "warning";
  label: string;
}) {
  const toneIcon = {
    default: <CircleDot className="h-3 w-3" strokeWidth={2.5} />,
    primary: <CircleDot className="h-3 w-3" strokeWidth={2.5} />,
    secondary: <Check className="h-3 w-3" strokeWidth={2.5} />,
    warning: <Lock className="h-3 w-3" strokeWidth={2.5} />,
  }[tone];
  const toneClass = {
    default:
      "bg-surface-variant text-on-surface border-outline-variant",
    primary:
      "bg-primary-fixed text-on-primary-fixed-variant border-primary-fixed-dim",
    secondary:
      "bg-secondary-container text-on-secondary-container border-secondary-fixed",
    warning:
      "bg-tertiary-fixed text-on-tertiary-fixed-variant border-tertiary-fixed-dim",
  }[tone];
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-bold",
        toneClass,
      )}
    >
      {toneIcon}
      {label}
    </span>
  );
}

// Right-aligned points-earned badge used on every pick row. `value`
// being null means the bet isn't graded yet - we show a small clock
// + stake instead so the user remembers what's on the line.
function PointsBadge({
  value,
  locale,
  stake,
}: {
  value: number | null;
  locale: Locale;
  stake?: number;
}) {
  const isHebrew = locale === "he";
  if (value === null) {
    if (typeof stake === "number" && stake > 0) {
      return (
        <span className="inline-flex flex-col items-end gap-0.5 min-w-[64px]">
          <span className="font-[family-name:var(--font-label)] text-[10px] font-bold tracking-[0.05em] text-on-surface-variant uppercase">
            {isHebrew ? "השקעה" : "Stake"}
          </span>
          <span className="inline-flex items-center gap-1 text-on-surface-variant font-[family-name:var(--font-score)] font-bold tabular-nums text-sm bidi-ltr">
            <Clock className="h-3 w-3" strokeWidth={2} />
            {stake}
          </span>
        </span>
      );
    }
    return null;
  }
  const tone =
    value > 0
      ? "text-secondary"
      : value < 0
        ? "text-error"
        : "text-on-surface-variant";
  return (
    <span className="inline-flex flex-col items-end gap-0.5 min-w-[64px]">
      <LabelCaps as="span" className="text-[10px]">
        {isHebrew ? "נקודות" : "Points"}
      </LabelCaps>
      <span
        className={clsx(
          "font-[family-name:var(--font-score)] text-base md:text-lg font-bold tabular-nums bidi-ltr",
          tone,
        )}
      >
        {value > 0 ? "+" : ""}
        {value}
      </span>
    </span>
  );
}

// Formats a custom-bet PickAnswer or ResolvedValue into a readable
// string for display in a row. Multi-choice answers get translated
// through the bet's answer_config.options so we show "Argentina" rather
// than the option's machine value "ARG".
function formatPickAnswer(
  answer: PickAnswer | null,
  cfg: AnswerConfig | null,
  locale: Locale,
): string {
  if (!answer) return "—";
  const isHebrew = locale === "he";
  switch (answer.type) {
    case "yes_no":
      return answer.value
        ? isHebrew ? "כן" : "Yes"
        : isHebrew ? "לא" : "No";
    case "number":
      return String(answer.value);
    case "multi_choice": {
      if (cfg && cfg.kind === "multi_choice") {
        const mc = cfg as MultiChoiceConfig;
        const opt = mc.options.find((o) => o.value === answer.value);
        if (opt) return isHebrew ? opt.labelHe : opt.labelEn;
      }
      return String(answer.value);
    }
    case "free_text":
      return String(answer.value);
    default:
      return "—";
  }
}

// Decides what label to put on the small "scope" chip in a custom-bet
// row header. For tournament-stage bets we surface the stage name
// (R16/QF/etc.); for group bets we show "Group A"; for day-scoped bets
// just "Matchday"; match-scope omits the chip since the question text
// already carries the matchup.
function stageOrScopeLabel(
  pick: MyCustomPickRow,
  dict: Awaited<ReturnType<typeof getDictionary>>,
): string | null {
  if (pick.scope === "stage" && pick.stage) {
    const stageDict: Record<typeof pick.stage & string, string> = {
      group: dict.profile.stageGroup,
      r32: dict.profile.stageR32,
      r16: dict.profile.stageR16,
      qf: dict.profile.stageQf,
      sf: dict.profile.stageSf,
      third_place: dict.profile.stageThirdPlace,
      final: dict.profile.stageFinal,
    };
    return stageDict[pick.stage as keyof typeof stageDict] ?? null;
  }
  if (pick.scope === "group" && pick.groupId) {
    return `${dict.profile.scopeGroup} ${pick.groupId}`;
  }
  if (pick.scope === "tournament") {
    return dict.profile.scopeTournament;
  }
  if (pick.scope === "day") {
    return dict.profile.scopeDay;
  }
  return null;
}
