import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import {
  ArrowRight,
  ArrowLeft,
  BookOpen,
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
import { getUser } from "@/lib/supabase/auth";
import { localePath } from "@/lib/paths";
import { Card, LabelCaps, SectionHeading } from "@/components/ui";
import { CategoryPrizeStrip } from "@/components/CategoryPrizeStrip";

export default async function RulesPage({
  params,
}: PageProps<"/[lang]/rules">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const dict = await getDictionary(locale);
  const isHebrew = locale === "he";
  // The page is public - guests browsing the landing should be able to
  // read what they would be signing up for. We still fetch the live
  // prize breakdown so signed-in players see today's pot amounts, and
  // the live scoring config so the page never drifts from the source
  // of truth (admin can flip the risk toggle and the page reflects it).
  const [user, prize, [scoringCfg]] = await Promise.all([
    getUser(),
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
          {PAGE_GUIDE.map((p) => (
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
                    <span className="font-bold text-on-surface">
                      {isHebrew ? p.he.name : p.en.name}
                    </span>
                    <span className="text-xs text-on-surface-variant leading-relaxed">
                      {isHebrew ? p.he.desc : p.en.desc}
                    </span>
                  </div>
                </Card>
              </Link>
            </li>
          ))}
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

// Static index of every public-facing page in the app, with short
// bilingual descriptions for the pages-guide section. Kept inline here
// rather than in the dictionary because the icon mapping lives with
// the names and 20+ separate dictionary keys for one section would
// crowd the JSON without making the copy any easier to edit.
//
// Hebrew copy is intentionally plain everyday language: no jargon,
// short sentences, no em dashes. Anyone in the pool should be able to
// read each line and know exactly what the page does.
const PAGE_GUIDE: Array<{
  path: string;
  icon: React.ReactNode;
  he: { name: string; desc: string };
  en: { name: string; desc: string };
}> = [
  {
    path: "",
    icon: <Home className="h-5 w-5" strokeWidth={1.75} />,
    he: {
      name: "ראשי",
      desc: "המסך הראשי. רואים פה את המקום שלך בטבלה, את המשחקים הבאים ואת הקופה.",
    },
    en: {
      name: "Home",
      desc: "The home screen. Shows your rank, your upcoming matches and the current pot.",
    },
  },
  {
    path: "bets",
    icon: <ListChecks className="h-5 w-5" strokeWidth={1.75} />,
    he: {
      name: "הימורים",
      desc: "העמוד המרכזי להימורים, מחולק ל-3 טאבים: ניחושי משחקים (תוצאות לכל משחק), הימורי טורניר (זוכת המונדיאל, מלך השערים) ודירוגי בתים (סדר הסיום בכל בית).",
    },
    en: {
      name: "Bets",
      desc: "The main bets page, split into 3 tabs: Match picks (score predictions per match), Tournament bets (champion, top scorer) and Group rankings (final standings per group).",
    },
  },
  {
    path: "play",
    icon: <Sparkles className="h-5 w-5" strokeWidth={1.75} />,
    he: {
      name: "הימורי לייב",
      desc: "הימורי בונוס שהאדמין פותח לכל יום משחקים, למשל 'יבקעו יותר מ-3 שערים' או 'יהיו פנדלים'. שונה לחלוטין מהעמוד 'הימורים'.",
    },
    en: {
      name: "Live bets",
      desc: "Bonus bets the admin opens for each match day, like 'more than 3 goals will be scored' or 'penalties will be taken'. Completely separate from the main Bets page.",
    },
  },
  {
    path: "live",
    icon: <Radio className="h-5 w-5" strokeWidth={1.75} />,
    he: {
      name: "תוצאות חיות",
      desc: "כל המשחקים שמתנהלים ברגע זה. מציג את הניחוש שלך ואת הנקודות הצפויות אם המשחק יסתיים עכשיו.",
    },
    en: {
      name: "Live scores",
      desc: "Every match currently in play. Shows your pick and the points you would earn if the match ended right now.",
    },
  },
  {
    path: "duels",
    icon: <Swords className="h-5 w-5" strokeWidth={1.75} />,
    he: {
      name: "דו-קרב",
      desc: "אתגרים 1 על 1 בין חברים. פותחים שאלה של כן או לא, מסכנים נקודות, ומי שצדק לוקח את הסטייק של השני.",
    },
    en: {
      name: "Duels",
      desc: "1v1 challenges between friends. Open a yes/no question, stake points, winner takes both stakes.",
    },
  },
  {
    path: "leaderboard",
    icon: <Medal className="h-5 w-5" strokeWidth={1.75} />,
    he: {
      name: "מובילים",
      desc: "טבלאות המובילים בארבע קטגוריות: כללי, ניחושי משחקים, הימורי לייב ודו-קרב.",
    },
    en: {
      name: "Leaders",
      desc: "Leaderboards across four tabs: overall, matches, live bets and duels.",
    },
  },
  {
    path: "transparency",
    icon: <Eye className="h-5 w-5" strokeWidth={1.75} />,
    he: {
      name: "שקיפות",
      desc: "רואים מי הימר על מה. כל הימור מוצג כאן אחרי שננעל. אפשר לסנן לפי משתתף, סוג הימור או תאריך.",
    },
    en: {
      name: "Transparency",
      desc: "See who picked what. Every bet shows up here after it locks. Filter by player, category or date.",
    },
  },
  {
    path: "me/bank",
    icon: <Wallet className="h-5 w-5" strokeWidth={1.75} />,
    he: {
      name: "הבנק שלי",
      desc: "כל התנועות בבנק שלך, היתרה הנוכחית והפילוח של מאיפה הרווחת או הפסדת נקודות.",
    },
    en: {
      name: "My bank",
      desc: "Every transaction in your bank, the current balance and a breakdown by category.",
    },
  },
  {
    path: "tournament",
    icon: <Trophy className="h-5 w-5" strokeWidth={1.75} />,
    he: {
      name: "אזור מונדיאל",
      desc: "כל המידע על הטורניר במקום אחד. טבלאות בתים, נבחרות וחדשות מהמונדיאל.",
    },
    en: {
      name: "Tournament zone",
      desc: "All World Cup info in one place. Group standings, teams and headlines.",
    },
  },
  {
    path: "pay",
    icon: <Coins className="h-5 w-5" strokeWidth={1.75} />,
    he: {
      name: "תשלום",
      desc: "תשלום של דמי ההשתתפות ובדיקת סטטוס. עד שהמנהל יאשר את התשלום אי אפשר לשמור הימורים חדשים.",
    },
    en: {
      name: "Pay",
      desc: "Pay the entry fee and see the approval status. New picks are blocked until your payment is approved.",
    },
  },
  {
    path: "profile",
    icon: <UserIcon className="h-5 w-5" strokeWidth={1.75} />,
    he: {
      name: "הפרופיל שלי",
      desc: "פרטים אישיים, החלפת שפה והגדרות חשבון.",
    },
    en: {
      name: "Profile",
      desc: "Personal details, language toggle and account settings.",
    },
  },
  {
    path: "rules",
    icon: <BookOpen className="h-5 w-5" strokeWidth={1.75} />,
    he: {
      name: "חוקי המשחק",
      desc: "העמוד הזה. כל החוקים, כל הניקוד וכל ההסברים על איך הטוטו עובד.",
    },
    en: {
      name: "How it works",
      desc: "This page. All the rules, all the payouts and how the pool works.",
    },
  },
];
