import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Calendar, ChevronLeft, ChevronRight, History } from "lucide-react";
import { getDictionary, hasLocale, type Locale } from "../../dictionaries";
import { Card, Chip } from "@/components/ui";
import { BetsTabs } from "@/components/BetsTabs";
import { BetsSubTabs, parseBetsView } from "@/components/BetsSubTabs";
import { PayGateBanner } from "@/components/PayGateBanner";
import { getRequestUser } from "@/lib/request-user";
import { getUserAccess } from "@/lib/access";
import { localePath } from "@/lib/paths";
import { formatDateTime } from "@/lib/format";
import { listOpenPlayDays, listPastPlayDays } from "@/db/queries";

// /bets/live — Live-bets matchday index. The fourth tab in the
// unified Bets surface (Match picks / Tournament / Group rankings /
// Live bets). Each row drills into /bets/live/[date] for that
// matchday's bonus bets.
//
// Used to live at /play; that URL now redirects here so existing
// bookmarks and PWA shortcuts keep working.

export default async function BetsLiveIndexPage({
  params,
  searchParams,
}: PageProps<"/[lang]/bets/live">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const dict = await getDictionary(locale);
  const isHebrew = locale === "he";
  const Chev = isHebrew ? ChevronLeft : ChevronRight;

  const sp = await searchParams;
  const view = parseBetsView(sp.view);

  const user = await getRequestUser();
  if (!user) redirect(localePath(locale, "login"));
  const access = await getUserAccess(user.id);

  if (view === "past") {
    let days: Awaited<ReturnType<typeof listPastPlayDays>> = [];
    try {
      days = await listPastPlayDays(user.id);
    } catch (err) {
      console.error("[bets past] live-days load threw", { userId: user.id, err });
    }
    console.info("[bets past] live-days loaded", {
      userId: user.id,
      dayCount: days.length,
      view: "past",
    });
    return (
      <section className="px-4 md:px-16 py-6 md:py-12 flex flex-col gap-6 md:gap-8 max-w-3xl mx-auto w-full pb-24">
        <header className="flex flex-col gap-3">
          <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-9 md:text-[40px] md:leading-[44px] font-bold text-primary">
            {isHebrew ? "הימורים" : "Bets"}
          </h1>
          <BetsTabs locale={locale} active="live" />
          <BetsSubTabs locale={locale} path="bets/live" view="past" />
          <h2 className="font-[family-name:var(--font-display)] text-lg md:text-xl font-bold text-on-surface inline-flex items-center gap-2 mt-2">
            <History className="h-5 w-5" strokeWidth={1.75} />
            {dict.pastBets.liveTitle}
          </h2>
          <p className="text-sm md:text-base text-on-surface-variant">
            {dict.pastBets.liveSubtitle}
          </p>
        </header>

        {days.length === 0 ? (
          <Card className="p-6 text-center text-on-surface-variant">
            {dict.pastBets.liveEmpty}
          </Card>
        ) : (
          <ul className="flex flex-col gap-3">
            {days.map((d) => (
              <li key={d.date}>
                <Link
                  href={localePath(locale, `bets/live/${d.date}`)}
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
                          {d.matchCount}{" "}
                          {isHebrew
                            ? d.matchCount === 1
                              ? "משחק"
                              : "משחקים"
                            : d.matchCount === 1
                              ? "match"
                              : "matches"}
                        </Chip>
                        {d.myPickCount > 0 ? (
                          <Chip tone="primary">
                            {dict.pastBets.matchesILocked.replace(
                              "{n}",
                              String(d.myPickCount),
                            )}
                          </Chip>
                        ) : (
                          <Chip>
                            {dict.pastBets.matchesNonePicked}
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
    );
  }

  const days = await listOpenPlayDays();

  return (
    <section className="px-4 md:px-16 py-6 md:py-12 flex flex-col gap-6 md:gap-8 max-w-3xl mx-auto w-full pb-24">
      <header className="flex flex-col gap-3">
        <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-9 md:text-[40px] md:leading-[44px] font-bold text-primary">
          {isHebrew ? "הימורים" : "Bets"}
        </h1>
        <BetsTabs locale={locale} active="live" />
        <BetsSubTabs locale={locale} path="bets/live" view="upcoming" />
        <p className="text-sm md:text-base text-on-surface-variant mt-2">
          {isHebrew
            ? "הימורי בונוס שהאדמין פותח לכל יום משחקים, למשל כמה שערים יבקעו או האם יהיו פנדלים."
            : "Bonus bets the admin opens for each match day, like total goals or penalties."}
        </p>
      </header>

      {!access.canEdit && <PayGateBanner locale={locale} dict={dict} />}

      <section className="flex flex-col gap-3">
        <h2 className="font-[family-name:var(--font-display)] text-xl md:text-2xl font-bold text-on-surface inline-flex items-center gap-2">
          <Calendar className="h-5 w-5 text-tertiary-fixed-dim" strokeWidth={1.75} />
          {dict.live.daysHeading}
        </h2>

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
                  href={localePath(locale, `bets/live/${d.date}`)}
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
                          {d.matchCount}{" "}
                          {isHebrew
                            ? d.matchCount === 1
                              ? "משחק"
                              : "משחקים"
                            : d.matchCount === 1
                              ? "match"
                              : "matches"}
                        </Chip>
                        {d.openBetCount > 0 && (
                          <Chip tone="primary">
                            {d.openBetCount}{" "}
                            {isHebrew
                              ? d.openBetCount === 1
                                ? "הימור פתוח"
                                : "הימורים פתוחים"
                              : d.openBetCount === 1
                                ? "open bet"
                                : "open bets"}
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
