import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  ListChecks,
  Sparkles,
  Trophy,
} from "lucide-react";
import { getDictionary, hasLocale, type Locale } from "../dictionaries";
import { Card, Chip, LabelCaps } from "@/components/ui";
import { PayGateBanner } from "@/components/PayGateBanner";
import { getUser } from "@/lib/supabase/auth";
import { getUserAccess } from "@/lib/access";
import { localePath } from "@/lib/paths";
import { formatDateTime } from "@/lib/format";
import {
  listOpenPlayDays,
  getOpenTournamentBetCount,
  getOpenGroupBetCount,
} from "@/db/queries";

export default async function PlayIndexPage({
  params,
}: PageProps<"/[lang]/play">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const dict = await getDictionary(locale);
  const isHebrew = locale === "he";
  const Chev = isHebrew ? ChevronLeft : ChevronRight;

  const user = await getUser();
  if (!user) redirect(localePath(locale, "login"));
  const access = await getUserAccess(user.id);

  const [days, tournamentCount, groupCount] = await Promise.all([
    listOpenPlayDays(),
    getOpenTournamentBetCount(),
    getOpenGroupBetCount(),
  ]);

  return (
    <section className="px-4 md:px-16 py-6 md:py-12 flex flex-col gap-6 md:gap-8 max-w-3xl mx-auto w-full pb-24">
      <header className="flex flex-col gap-2">
        <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-9 md:text-[48px] md:leading-[52px] font-bold text-primary">
          {isHebrew ? "הימורים" : "Play"}
        </h1>
        <p className="text-sm md:text-base text-on-surface-variant">
          {isHebrew
            ? "ניחושים יומיים, הימורי בתים והימורי טורניר במקום אחד."
            : "Daily picks, group bets, and tournament-wide bets in one place."}
        </p>
      </header>

      {!access.canEdit && <PayGateBanner locale={locale} dict={dict} />}

      {/* Quick-fill shortcut — full list of upcoming matches one tap away. */}
      <Link
        href={localePath(locale, "bets")}
        className="press-down block"
      >
        <Card className="p-4 md:p-5 flex items-center gap-3 hover:bg-surface-container transition-colors bg-primary-fixed border-primary text-on-primary-fixed-variant">
          <div className="w-10 h-10 rounded-full bg-primary text-on-primary flex items-center justify-center shrink-0">
            <ListChecks className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <div className="flex-1 min-w-0">
            <span className="block font-[family-name:var(--font-display)] text-base font-bold truncate">
              {dict.quickBets.title}
            </span>
            <span className="block text-xs opacity-80 truncate mt-0.5">
              {dict.quickBets.subtitle}
            </span>
          </div>
          <Chev className="h-5 w-5 shrink-0" />
        </Card>
      </Link>

      {/* Pinned: tournament + groups */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <PinnedCard
          locale={locale}
          href={localePath(locale, "play/tournament")}
          icon={<Trophy className="h-5 w-5" strokeWidth={1.75} />}
          title={isHebrew ? "הימורי טורניר" : "Tournament bets"}
          subtitle={
            isHebrew
              ? "מלך השערים, זוכת המונדיאל ועוד"
              : "Top scorer, champion, and more"
          }
          count={tournamentCount}
          countLabel={isHebrew ? "פתוחים" : "open"}
        />
        <PinnedCard
          locale={locale}
          href={localePath(locale, "play/groups")}
          icon={<Sparkles className="h-5 w-5" strokeWidth={1.75} />}
          title={isHebrew ? "דירוגי בתים" : "Group rankings"}
          subtitle={
            isHebrew
              ? "ניחוש סדר הסיום בכל בית"
              : "Predict the final standings per group"
          }
          count={groupCount}
          countLabel={isHebrew ? "פתוחים" : "open"}
        />
      </div>

      {/* Daily list */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-[family-name:var(--font-display)] text-xl md:text-2xl font-bold text-on-surface inline-flex items-center gap-2">
            <Calendar className="h-5 w-5 text-tertiary-fixed-dim" strokeWidth={1.75} />
            {dict.live.daysHeading}
          </h2>
          <LabelCaps>{days.length}</LabelCaps>
        </div>

        {days.length === 0 ? (
          <Card className="p-6 text-center text-on-surface-variant">
            {isHebrew
              ? "אין משחקים מתוזמנים עדיין."
              : "No matches scheduled yet."}
          </Card>
        ) : (
          <ul className="flex flex-col gap-3">
            {days.map((d) => (
              <li key={d.date}>
                <Link
                  href={localePath(locale, `play/${d.date}`)}
                  className="block press-down"
                >
                  <Card className="p-4 md:p-5 flex items-center justify-between gap-3 hover:bg-surface-container transition-colors">
                    <div className="flex flex-col gap-1 min-w-0 flex-1">
                      <span className="font-[family-name:var(--font-display)] text-base md:text-lg font-bold text-on-surface">
                        {formatDateTime(d.firstKickoffAt, locale, {
                          weekday: "long",
                          day: "numeric",
                          month: "long",
                        })}
                      </span>
                      <span className="text-sm text-on-surface-variant truncate">
                        {d.flagsPreview}
                      </span>
                      <div className="flex gap-2 items-center mt-1 flex-wrap">
                        <Chip>
                          {d.matchCount} {isHebrew ? "משחקים" : "matches"}
                        </Chip>
                        {d.openBetCount > 0 && (
                          <Chip tone="primary">
                            {d.openBetCount}{" "}
                            {isHebrew ? "הימורים פתוחים" : "open bets"}
                          </Chip>
                        )}
                      </div>
                    </div>
                    <Chev className="h-5 w-5 text-outline shrink-0" />
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

function PinnedCard({
  locale,
  href,
  icon,
  title,
  subtitle,
  count,
  countLabel,
}: {
  locale: Locale;
  href: string;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  count: number;
  countLabel: string;
}) {
  const isHebrew = locale === "he";
  const Chev = isHebrew ? ChevronLeft : ChevronRight;
  return (
    <Link href={href} className="press-down block">
      <Card className="p-4 md:p-5 flex items-center gap-3 min-h-[80px] hover:bg-surface-container transition-colors h-full">
        <div className="w-10 h-10 rounded-full bg-primary-fixed flex items-center justify-center text-on-primary-fixed-variant shrink-0">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-[family-name:var(--font-display)] text-base font-bold text-on-surface truncate">
              {title}
            </span>
            {count > 0 && (
              <Chip tone="primary" className="text-xs px-2 py-0.5">
                {count} {countLabel}
              </Chip>
            )}
          </div>
          <span className="block text-xs text-on-surface-variant truncate mt-0.5">
            {subtitle}
          </span>
        </div>
        <Chev className="h-5 w-5 text-outline shrink-0" />
      </Card>
    </Link>
  );
}
