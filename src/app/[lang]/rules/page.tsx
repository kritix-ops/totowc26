import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import {
  ArrowRight,
  ArrowLeft,
  Bell,
  BookOpen,
  CalendarClock,
  Coins,
  Eye,
  Home,
  ListChecks,
  Map,
  Medal,
  Radio,
  Sparkles,
  Swords,
  Target,
  Trophy,
  User as UserIcon,
  Wallet,
} from "lucide-react";
import { getDictionary, hasLocale, type Locale } from "../dictionaries";
import { getCategoryPrizeBreakdown } from "@/db/queries";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { getRequestUser } from "@/lib/request-user";
import { localePath } from "@/lib/paths";
import { gatePage } from "@/lib/page-visibility";
import { Card, LabelCaps, SectionHeading } from "@/components/ui";
import { CategoryPrizeStrip } from "@/components/CategoryPrizeStrip";

export default async function RulesPage({
  params,
}: PageProps<"/[lang]/rules">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  await gatePage("rules", lang);
  const locale = lang as Locale;
  const dict = await getDictionary(locale);
  const isHebrew = locale === "he";
  // The page is public - guests browsing the landing should be able to
  // read what they would be signing up for. We still fetch the live
  // prize breakdown so signed-in players see today's pot amounts, and
  // the live scoring config so the page never drifts from the source
  // of truth (admin can flip the risk toggle and the page reflects it).
  const [user, prize, [scoringCfg]] = await Promise.all([
    getRequestUser(),
    getCategoryPrizeBreakdown(),
    db
      .select({
        scoringExact: settings.scoringExact,
        scoringOutcome: settings.scoringOutcome,
        matchRiskEnabled: settings.matchRiskEnabled,
        matchRiskPenalty: settings.matchRiskPenalty,
        startingBank: settings.startingBank,
      })
      .from(settings)
      .where(eq(settings.id, 1)),
  ]);
  const signedIn = !!user;
  const scoring = scoringCfg ?? {
    scoringExact: 15,
    scoringOutcome: 5,
    matchRiskEnabled: false,
    matchRiskPenalty: 5,
    startingBank: 30,
  };
  const pts = dict.rules.scoringPointsUnit;
  const bankBody = dict.rules.bankBody.replace(
    "{startingBank}",
    String(scoring.startingBank),
  );

  console.info("[rules render]", {
    isHebrew,
    potIls: prize.potIls,
    signedIn,
    matchRiskEnabled: scoring.matchRiskEnabled,
  });

  const BackArrow = isHebrew ? ArrowRight : ArrowLeft;

  return (
    <section className="px-4 md:px-16 py-6 md:py-12 flex flex-col gap-6 md:gap-10 max-w-3xl mx-auto w-full">
      <header className="flex flex-col gap-3">
        <span className="inline-flex items-center gap-2 self-start px-3 py-1 rounded-full bg-tertiary-container text-on-tertiary-container">
          <BookOpen className="h-4 w-4" strokeWidth={1.75} />
          <LabelCaps>{dict.nav.rules}</LabelCaps>
        </span>
        <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-9 md:text-[44px] md:leading-[48px] font-bold text-primary">
          {dict.rules.title}
        </h1>
        <p className="text-sm md:text-base text-on-surface-variant">
          {dict.rules.subtitle}
        </p>
      </header>

      <RuleSection
        icon={<Target className="h-5 w-5" strokeWidth={1.75} />}
        title={dict.rules.whatTitle}
      >
        <p>{dict.rules.whatBody}</p>
      </RuleSection>

      <RuleSection
        icon={<ListChecks className="h-5 w-5" strokeWidth={1.75} />}
        title={dict.rules.howTitle}
      >
        <p>{dict.rules.howBody}</p>
      </RuleSection>

      <RuleSection
        icon={<CalendarClock className="h-5 w-5" strokeWidth={1.75} />}
        title={dict.rules.deadlinesTitle}
      >
        <p>{dict.rules.deadlinesBody}</p>
      </RuleSection>

      <RuleSection
        icon={<Coins className="h-5 w-5" strokeWidth={1.75} />}
        title={dict.rules.scoringTitle}
      >
        <Card className="p-4 md:p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <ScoringRow
            label={dict.rules.scoringExact}
            value={`+${scoring.scoringExact} ${pts}`}
            tone="primary"
          />
          <ScoringRow
            label={dict.rules.scoringDirection}
            value={`+${scoring.scoringOutcome} ${pts}`}
          />
          <ScoringRow
            label={dict.rules.scoringWrong}
            value={
              scoring.matchRiskEnabled
                ? `−${scoring.matchRiskPenalty} ${pts}`
                : `0 ${pts}`
            }
            tone={scoring.matchRiskEnabled ? "error" : undefined}
          />
        </Card>
        <p className="text-sm text-on-surface-variant">
          {scoring.matchRiskEnabled
            ? dict.rules.scoringRiskOnNote
            : dict.rules.scoringRiskOffNote}
        </p>
        <p className="text-sm text-on-surface-variant">
          {dict.rules.scoringExtras}
        </p>
      </RuleSection>

      <RuleSection
        icon={<Sparkles className="h-5 w-5" strokeWidth={1.75} />}
        title={dict.rules.liveTitle}
      >
        <p>{dict.rules.liveBody}</p>
      </RuleSection>

      <RuleSection
        icon={<Swords className="h-5 w-5" strokeWidth={1.75} />}
        title={dict.rules.duelsTitle}
      >
        <p>{dict.rules.duelsBody}</p>
      </RuleSection>

      <RuleSection
        icon={<Wallet className="h-5 w-5" strokeWidth={1.75} />}
        title={dict.rules.bankTitle}
      >
        <p>{bankBody}</p>
      </RuleSection>

      <RuleSection
        icon={<Medal className="h-5 w-5" strokeWidth={1.75} />}
        title={dict.rules.leaderboardTitle}
      >
        <p>{dict.rules.leaderboardBody}</p>
      </RuleSection>

      <RuleSection
        icon={<Eye className="h-5 w-5" strokeWidth={1.75} />}
        title={dict.rules.transparencyTitle}
      >
        <p>{dict.rules.transparencyBody}</p>
      </RuleSection>

      <RuleSection
        icon={<Radio className="h-5 w-5" strokeWidth={1.75} />}
        title={dict.rules.liveViewTitle}
      >
        <p>{dict.rules.liveViewBody}</p>
      </RuleSection>

      <RuleSection
        icon={<Trophy className="h-5 w-5" strokeWidth={1.75} />}
        title={dict.rules.prizesTitle}
      >
        <p>{dict.rules.prizesEntry}</p>
        <p>{dict.rules.prizesBody}</p>
        <CategoryPrizeStrip prize={prize} locale={locale} />
      </RuleSection>

      <RuleSection
        icon={<Map className="h-5 w-5" strokeWidth={1.75} />}
        title={dict.rules.pagesGuideTitle}
      >
        <p>{dict.rules.pagesGuideIntro}</p>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {PAGE_GUIDE_META.map((p) => {
            const copy = dict.rules.pageGuide[p.key];
            return (
              <li key={p.path}>
                <Link
                  href={p.path === "" ? localePath(locale) : localePath(locale, p.path)}
                  className="press-down block h-full"
                >
                  <Card className="p-3 md:p-4 h-full flex items-start gap-3 hover:bg-surface-container transition-colors">
                    <span
                      aria-hidden
                      className="mt-0.5 inline-flex items-center justify-center w-9 h-9 rounded-full bg-tertiary-fixed text-on-tertiary-fixed-variant shrink-0"
                    >
                      {p.icon}
                    </span>
                    <div className="flex flex-col gap-1 min-w-0">
                      <span className="font-bold text-on-surface">{copy.name}</span>
                      <span className="text-xs text-on-surface-variant leading-relaxed">
                        {copy.desc}
                      </span>
                    </div>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      </RuleSection>

      <div>
        <Link
          href={localePath(locale)}
          className="press-down inline-flex items-center gap-2 px-5 min-h-[44px] rounded-full bg-surface-container-lowest border border-outline-variant text-on-surface font-[family-name:var(--font-label)] text-[13px] font-bold tracking-[0.04em] hover:bg-surface-container transition-colors"
        >
          <BackArrow className="h-4 w-4" strokeWidth={2} />
          {dict.rules.ctaBack}
        </Link>
      </div>
    </section>
  );
}

function RuleSection({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 md:gap-4 text-on-surface text-sm md:text-base leading-relaxed">
      <SectionHeading as="h2" underline="thin">
        <span className="inline-flex items-center gap-2">
          <span aria-hidden className="text-tertiary-fixed-dim">
            {icon}
          </span>
          {title}
        </span>
      </SectionHeading>
      <div className="flex flex-col gap-3 text-on-surface-variant">
        {children}
      </div>
    </section>
  );
}

function ScoringRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "primary" | "error";
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 px-3 rounded-lg bg-surface-container-lowest border border-outline-variant">
      <span className="text-sm font-bold text-on-surface">{label}</span>
      <span
        className={`font-[family-name:var(--font-display)] text-xl leading-none font-bold tabular-nums bidi-ltr ${
          tone === "primary"
            ? "text-surface-tint"
            : tone === "error"
              ? "text-error"
              : "text-on-surface"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

// Page-guide index. Names and descriptions live in the dictionary
// (`rules.pageGuide.<key>`) so they're editable from /admin/rules; only
// the path → icon pairing stays inline because icons aren't user copy.
// Order here is the display order.
export const PAGE_GUIDE_KEYS = [
  "home",
  "bets",
  "live",
  "duels",
  "leaderboard",
  "transparency",
  "meBank",
  "tournament",
  "pay",
  "profile",
  "notifications",
  "rules",
] as const;

export type PageGuideKey = (typeof PAGE_GUIDE_KEYS)[number];

const PAGE_GUIDE_META: Array<{
  key: PageGuideKey;
  path: string;
  icon: React.ReactNode;
}> = [
  { key: "home", path: "", icon: <Home className="h-5 w-5" strokeWidth={1.75} /> },
  { key: "bets", path: "bets", icon: <ListChecks className="h-5 w-5" strokeWidth={1.75} /> },
  { key: "live", path: "live", icon: <Radio className="h-5 w-5" strokeWidth={1.75} /> },
  { key: "duels", path: "duels", icon: <Swords className="h-5 w-5" strokeWidth={1.75} /> },
  { key: "leaderboard", path: "leaderboard", icon: <Medal className="h-5 w-5" strokeWidth={1.75} /> },
  { key: "transparency", path: "transparency", icon: <Eye className="h-5 w-5" strokeWidth={1.75} /> },
  { key: "meBank", path: "me/bank", icon: <Wallet className="h-5 w-5" strokeWidth={1.75} /> },
  { key: "tournament", path: "tournament", icon: <Trophy className="h-5 w-5" strokeWidth={1.75} /> },
  { key: "pay", path: "pay", icon: <Coins className="h-5 w-5" strokeWidth={1.75} /> },
  { key: "profile", path: "profile", icon: <UserIcon className="h-5 w-5" strokeWidth={1.75} /> },
  { key: "notifications", path: "notifications", icon: <Bell className="h-5 w-5" strokeWidth={1.75} /> },
  { key: "rules", path: "rules", icon: <BookOpen className="h-5 w-5" strokeWidth={1.75} /> },
];
