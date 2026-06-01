import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Flame, Trophy } from "lucide-react";
import { clsx } from "clsx";
import { getDictionary, hasLocale, type Locale } from "../dictionaries";
import { getRequestUser } from "@/lib/request-user";
import {
  getCategoryPrizeBreakdown,
  getLeaderboard,
  getMonkeyBenchmark,
  type LeaderboardTab,
} from "@/db/queries";
import { Card, LabelCaps } from "@/components/ui";
import { CategoryPrizeStrip } from "@/components/CategoryPrizeStrip";
import { localePath } from "@/lib/paths";
import { gatePage } from "@/lib/page-visibility";

type SearchSP = { tab?: string | string[] };

type PageParams = {
  params: Promise<{ lang: string }>;
  searchParams: Promise<SearchSP>;
};

const TABS: LeaderboardTab[] = ["overall", "matches", "live", "duels"];

export default async function LeaderboardPage({
  params,
  searchParams,
}: PageParams) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  await gatePage("leaderboard", lang);
  const locale = lang as Locale;
  const dict = await getDictionary(locale);
  const isHebrew = locale === "he";

  const user = await getRequestUser();
  if (!user) redirect(localePath(locale, "login"));

  const sp = await searchParams;
  const rawTab = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const tab: LeaderboardTab =
    rawTab && (TABS as string[]).includes(rawTab)
      ? (rawTab as LeaderboardTab)
      : "overall";

  const [rows, categoryPrize, monkey] = await Promise.all([
    getLeaderboard(user.id, tab),
    getCategoryPrizeBreakdown(),
    getMonkeyBenchmark(tab),
  ]);

  // The monkey is a benchmark, not a ranked competitor: show how many humans
  // are currently ahead of its odds-weighted-random score.
  const beatingMonkey = monkey
    ? rows.filter((r) => r.points > monkey.points).length
    : 0;

  // Per-rank prize ILS amounts only render alongside the overall tab,
  // and they come from the category split (king 1/2/3) so the chip
  // next to each row matches the strip above the list. Category tabs
  // surface their single-winner prize through the standalone card.
  const prizeByRank =
    tab === "overall"
      ? new Map<number, number>([
          [1, categoryPrize.prizes.find((p) => p.key === "king_first")?.ils ?? 0],
          [2, categoryPrize.prizes.find((p) => p.key === "king_second")?.ils ?? 0],
          [3, categoryPrize.prizes.find((p) => p.key === "king_third")?.ils ?? 0],
        ])
      : new Map<number, number>();

  // Map each category tab to the matching slot in the 7-way split so
  // we can highlight the winner's prize on the first row.
  const categoryPrizeIls = (() => {
    if (tab === "overall") return null;
    const key =
      tab === "matches"
        ? "matches_winner"
        : tab === "live"
          ? "live_winner"
          : "duels_winner";
    return categoryPrize.prizes.find((p) => p.key === key)?.ils ?? 0;
  })();

  return (
    <section className="px-4 md:px-16 py-6 md:py-12 flex flex-col gap-6 md:gap-8 max-w-3xl mx-auto w-full">
      <header className="flex flex-col gap-4">
        <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-9 md:text-[48px] md:leading-[52px] font-bold text-primary">
          {dict.leaderboard.title}
        </h1>
        <p className="text-sm text-on-surface-variant">
          {tabSubtitle(tab, dict)}
        </p>
      </header>

      <nav
        aria-label={dict.leaderboard.title}
        className="flex gap-2 overflow-x-auto snap-x snap-mandatory -mx-1 px-1"
      >
        {TABS.map((t) => (
          <TabPill
            key={t}
            locale={locale}
            label={tabLabel(t, dict)}
            tabKey={t}
            active={t === tab}
          />
        ))}
      </nav>

      {tab === "overall" && <CategoryPrizeStrip prize={categoryPrize} locale={locale} />}

      {tab !== "overall" && categoryPrizeIls !== null && categoryPrizeIls > 0 && (
        <Card className="p-4 md:p-5 flex items-center justify-between gap-3 bg-secondary-container text-on-secondary-container border border-secondary-fixed">
          <span className="text-sm font-bold inline-flex items-center gap-2">
            <Trophy className="h-4 w-4" strokeWidth={2} />
            {isHebrew
              ? "פרס המוביל בקטגוריה"
              : "Category-leader prize"}
          </span>
          <span className="font-[family-name:var(--font-display)] text-xl font-bold tabular-nums">
            <bdi>
              {categoryPrizeIls.toLocaleString()} {isHebrew ? "ש\"ח" : "ILS"}
            </bdi>
          </span>
        </Card>
      )}

      {monkey && (
        <Card className="p-4 md:p-5 flex items-center gap-3 md:gap-4 bg-tertiary-fixed text-on-tertiary-fixed-variant border border-dashed border-tertiary-fixed-dim">
          <span className="text-2xl md:text-3xl leading-none shrink-0" aria-hidden>
            🐒
          </span>
          <div className="flex-1 min-w-0 flex flex-col gap-0.5">
            <span className="text-sm md:text-base font-bold truncate">
              {isHebrew ? "הקוף" : "The Monkey"}
            </span>
            <span className="text-xs">
              {isHebrew
                ? `יעד להכות · ${beatingMonkey} מתוך ${rows.length} מובילים עליו`
                : `Beat-the-monkey baseline · ${beatingMonkey} of ${rows.length} ahead`}
            </span>
          </div>
          <div className="text-end shrink-0 flex flex-col items-end gap-0.5">
            <span className="font-[family-name:var(--font-display)] text-xl md:text-2xl leading-none font-bold">
              <span className="bidi-ltr">{monkey.points}</span>
            </span>
            <LabelCaps as="div">{dict.common.points}</LabelCaps>
          </div>
        </Card>
      )}

      {rows.length === 0 ? (
        <Card className="p-6 text-center text-on-surface-variant">
          {isHebrew
            ? "אין עדיין משתתפים בקבוצה"
            : "No players in the pool yet"}
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => {
            const top3 = row.rank <= 3;
            const prizeIls = prizeByRank.get(row.rank) ?? 0;
            return (
              <li
                key={row.userId}
                className={clsx(
                  "flex items-center gap-3 md:gap-4 p-3 md:p-4 rounded-lg border transition-colors",
                  row.isYou
                    ? "border-primary bg-primary-fixed sticky top-14 md:top-16 z-10 shadow-md"
                    : "border-outline-variant bg-surface-container-lowest",
                )}
              >
                <span className="font-[family-name:var(--font-display)] text-xl md:text-2xl leading-none font-bold text-on-surface w-7 md:w-8 text-center bidi-ltr">
                  {row.rank}
                </span>
                <div
                  className={clsx(
                    "w-10 h-10 md:w-12 md:h-12 rounded-full bg-surface-variant flex items-center justify-center text-base md:text-lg font-bold text-on-surface shrink-0",
                    top3 && "ring-2 ring-tertiary-fixed-dim",
                  )}
                  aria-hidden
                >
                  {row.displayName.charAt(0)}
                </div>
                <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                  <span className="text-sm md:text-base font-bold text-on-surface truncate">
                    {row.isYou ? dict.leaderboard.you : row.displayName}
                  </span>
                  {row.betCount > 0 && (
                    <span className="inline-flex items-center gap-1 text-xs text-on-surface-variant">
                      <Flame className="h-3 w-3" strokeWidth={2} />
                      <span className="bidi-ltr">{row.betCount}</span>{" "}
                      <span>{isHebrew ? "הימורים" : "bets"}</span>
                    </span>
                  )}
                </div>
                <div className="text-end shrink-0 flex flex-col items-end gap-0.5">
                  <span className="font-[family-name:var(--font-display)] text-xl md:text-2xl leading-none font-bold text-surface-tint">
                    <span className="bidi-ltr">{row.points}</span>
                  </span>
                  <LabelCaps as="div">{dict.common.points}</LabelCaps>
                  {prizeIls > 0 && row.rank <= 3 && (
                    <span
                      className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-tertiary-fixed text-on-tertiary-fixed-variant text-[11px] font-bold tabular-nums"
                      aria-label={
                        isHebrew
                          ? `פרס למקום ${row.rank}: ${prizeIls} ש"ח`
                          : `Prize for rank ${row.rank}: ${prizeIls} ILS`
                      }
                    >
                      <Trophy className="h-3 w-3" strokeWidth={2} />
                      <bdi>
                        {prizeIls.toLocaleString()} {isHebrew ? "ש\"ח" : "ILS"}
                      </bdi>
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function TabPill({
  locale,
  label,
  tabKey,
  active,
}: {
  locale: Locale;
  label: string;
  tabKey: LeaderboardTab;
  active: boolean;
}) {
  const href =
    tabKey === "overall"
      ? localePath(locale, "leaderboard")
      : `${localePath(locale, "leaderboard")}?tab=${tabKey}`;
  return (
    <Link
      href={href}
      className={clsx(
        "snap-start press-down inline-flex items-center justify-center h-10 px-4 rounded-full border text-sm font-bold whitespace-nowrap",
        active
          ? "bg-primary text-on-primary border-primary"
          : "bg-surface-container-lowest text-on-surface border-outline-variant hover:bg-surface-container",
      )}
    >
      {label}
    </Link>
  );
}

function tabLabel(
  tab: LeaderboardTab,
  dict: Awaited<ReturnType<typeof getDictionary>>,
): string {
  switch (tab) {
    case "overall":
      return dict.leaderboard.tabOverall;
    case "matches":
      return dict.leaderboard.tabMatches;
    case "live":
      return dict.leaderboard.tabLive;
    case "duels":
      return dict.leaderboard.tabDuels;
  }
}

function tabSubtitle(
  tab: LeaderboardTab,
  dict: Awaited<ReturnType<typeof getDictionary>>,
): string {
  switch (tab) {
    case "overall":
      return dict.leaderboard.subtitleOverall;
    case "matches":
      return dict.leaderboard.subtitleMatches;
    case "live":
      return dict.leaderboard.subtitleLive;
    case "duels":
      return dict.leaderboard.subtitleDuels;
  }
}
