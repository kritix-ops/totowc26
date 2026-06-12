"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Search, Stamp, X } from "lucide-react";
import { clsx } from "clsx";
import type { Locale } from "@/app/[lang]/dictionaries";
import { Card, LabelCaps, ScoreLine } from "@/components/ui";
import { Flag } from "@/components/Flag";
import {
  CustomBetCard,
  type CustomBetCardData,
} from "@/components/CustomBetCard";
import { localePath } from "@/lib/paths";
import { formatDateTime } from "@/lib/format";
import type { LiveStakeUiConfig } from "@/lib/bank";

// Client board for /bets/live/[date].
//
// Why client: the page now ships an inline search box and a status-chip
// strip so a player can narrow the view to a single fixture or only the
// still-open bets. Filters run locally over the already-loaded data — no
// network round trip per keystroke. The server still does the heavy
// lifting (data load, finished-fixture filter, editability/lock math) so
// this island stays pure presentation + filtering.

export type FixtureItem = {
  id: string;
  kickoffAt: string;
  homeCode: string;
  homeNameHe: string;
  homeNameEn: string;
  awayCode: string;
  awayNameHe: string;
  awayNameEn: string;
  status: "scheduled" | "live" | "final";
  myHome: number | null;
  myAway: number | null;
  matchBets: BetItem[];
};

export type BetItem = {
  cardData: CustomBetCardData;
  editable: boolean;
};

type StatusKey = "all" | "open" | "locked" | "graded";

export function BetsDayBoard({
  locale,
  fixtures,
  dayBets,
  bankBalance,
  liveStakeConfig,
  maxOverdraft,
  lockedFromBetting,
  dayWideTitle,
  dayWideHint,
  emptyDay,
}: {
  locale: Locale;
  fixtures: FixtureItem[];
  dayBets: BetItem[];
  bankBalance: number;
  liveStakeConfig: LiveStakeUiConfig;
  maxOverdraft: number;
  lockedFromBetting: boolean;
  dayWideTitle: string;
  dayWideHint: string;
  emptyDay: string;
}) {
  const isHebrew = locale === "he";
  const Chev = isHebrew ? ChevronLeft : ChevronRight;
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusKey>("all");

  const q = query.trim().toLowerCase();

  // Per-fixture tokens (codes + both-locale names) so a query like "bra"
  // or "ברזיל" hits the same row. Bet question text is searched in both
  // locales too — no language detection needed and it covers admins
  // working from one locale while a friend asks "where's the Mexico
  // bet".
  const matchesStatus = (s: BetItem["cardData"]["status"]): boolean => {
    if (statusFilter === "all") return true;
    if (statusFilter === "open") return s === "open";
    if (statusFilter === "locked") return s === "locked";
    if (statusFilter === "graded") return s === "graded" || s === "reversed";
    return true;
  };

  const tokenMatch = (tokens: string[]): boolean => {
    if (q === "") return true;
    return tokens.some((t) => t.toLowerCase().includes(q));
  };

  const betMatchesText = (b: BetItem): boolean =>
    tokenMatch([b.cardData.questionHe, b.cardData.questionEn, b.cardData.scopeLabel ?? ""]);

  const visibleFixtures = useMemo(() => {
    return fixtures
      .map((f) => {
        const fixtureTokens = [
          f.homeCode,
          f.awayCode,
          f.homeNameHe,
          f.homeNameEn,
          f.awayNameHe,
          f.awayNameEn,
        ];
        const fixtureTextHit = tokenMatch(fixtureTokens);
        // A match-bet survives when its status matches the chip AND
        // either the fixture itself matches the query (then all its
        // bets ride along) or this bet's question matches the query.
        const visibleBets = f.matchBets.filter(
          (b) =>
            matchesStatus(b.cardData.status) &&
            (fixtureTextHit || betMatchesText(b)),
        );
        const showFixture = fixtureTextHit || visibleBets.length > 0;
        return { fixture: f, visibleBets, showFixture };
      })
      .filter((row) => row.showFixture);
    // matchesStatus and betMatchesText close over q/statusFilter — re-run
    // whenever those change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixtures, q, statusFilter]);

  const visibleDayBets = useMemo(
    () =>
      dayBets.filter((b) => matchesStatus(b.cardData.status) && betMatchesText(b)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dayBets, q, statusFilter],
  );

  const isFiltering = q !== "" || statusFilter !== "all";
  const nothingShown =
    visibleFixtures.length === 0 && visibleDayBets.length === 0;

  const statusChips: Array<{ key: StatusKey; labelHe: string; labelEn: string }> = [
    { key: "all",    labelHe: "הכל",    labelEn: "All" },
    { key: "open",   labelHe: "פתוח",   labelEn: "Open" },
    { key: "locked", labelHe: "נסגר",   labelEn: "Locked" },
    { key: "graded", labelHe: "נמדד",   labelEn: "Graded" },
  ];

  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="relative">
          <Search
            className="absolute top-1/2 -translate-y-1/2 start-3 h-4 w-4 text-on-surface-variant pointer-events-none"
            strokeWidth={2}
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              isHebrew
                ? "חפש משחק או הימור…"
                : "Search fixture or bet…"
            }
            dir={isHebrew ? "rtl" : "ltr"}
            inputMode="search"
            autoComplete="off"
            className="w-full min-h-[48px] ps-10 pe-10 rounded-full bg-surface-container-lowest border border-outline text-base focus:outline-none focus:border-primary"
            aria-label={isHebrew ? "חיפוש" : "Search"}
          />
          {query !== "" && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label={isHebrew ? "נקה חיפוש" : "Clear search"}
              className="absolute top-1/2 -translate-y-1/2 end-2 inline-flex items-center justify-center w-8 h-8 rounded-full hover:bg-surface-container text-on-surface-variant"
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          )}
        </div>
        <nav
          aria-label={isHebrew ? "סינון לפי סטטוס" : "Filter by status"}
          className="flex gap-2 overflow-x-auto snap-x snap-mandatory -mx-1 px-1"
        >
          {statusChips.map((s) => {
            const active = statusFilter === s.key;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => setStatusFilter(s.key)}
                aria-pressed={active}
                className={clsx(
                  "snap-start press-down inline-flex items-center justify-center min-h-[40px] px-4 rounded-full border text-sm font-bold whitespace-nowrap",
                  active
                    ? "bg-primary text-on-primary border-primary"
                    : "bg-surface-container-lowest text-on-surface border-outline-variant hover:bg-surface-container",
                )}
              >
                {isHebrew ? s.labelHe : s.labelEn}
              </button>
            );
          })}
        </nav>
      </div>

      {visibleFixtures.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionTitle>
            {isHebrew ? "המשחקים של היום" : "Today's fixtures"}
          </SectionTitle>
          <ul className="flex flex-col gap-3">
            {visibleFixtures.map(({ fixture: m, visibleBets }) => {
              const homeName = isHebrew ? m.homeNameHe : m.homeNameEn;
              const awayName = isHebrew ? m.awayNameHe : m.awayNameEn;
              const hasPick = m.myHome !== null && m.myAway !== null;
              return (
                <li key={m.id}>
                  <Link
                    href={localePath(locale, `bets/${m.id}`)}
                    className="press-down block"
                  >
                    <Card className="p-4 md:p-5 flex items-center justify-between gap-3 hover:bg-surface-container transition-colors">
                      <div className="flex items-center gap-2 md:gap-3 flex-1 min-w-0">
                        <Flag code={m.homeCode} size={28} />
                        <span className="text-sm md:text-base font-bold truncate">
                          {homeName}
                        </span>
                        <span className="text-on-surface-variant text-xs md:text-sm px-1">
                          vs
                        </span>
                        <span className="text-sm md:text-base font-bold truncate">
                          {awayName}
                        </span>
                        <Flag code={m.awayCode} size={28} />
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        {hasPick ? (
                          <div className="text-end">
                            <LabelCaps as="div" className="mb-0.5">
                              {isHebrew ? "תחזית" : "Prediction"}
                            </LabelCaps>
                            <ScoreLine
                              home={m.myHome!}
                              away={m.myAway!}
                              className="font-[family-name:var(--font-score)] text-base md:text-lg font-bold text-primary"
                            />
                          </div>
                        ) : (
                          <div className="text-end">
                            <LabelCaps as="div" className="mb-0.5">
                              {isHebrew ? "פתיחה" : "Kickoff"}
                            </LabelCaps>
                            <span className="font-[family-name:var(--font-label)] text-xs font-bold tabular-nums">
                              {formatDateTime(m.kickoffAt, locale, {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          </div>
                        )}
                        <Chev className="h-5 w-5 text-outline shrink-0" />
                      </div>
                    </Card>
                  </Link>

                  {visibleBets.length > 0 && (
                    <div className="mt-3 ms-4 ps-3 border-s-2 border-outline-variant flex flex-col gap-3">
                      {visibleBets.map((b) => (
                        <CustomBetCard
                          key={b.cardData.id}
                          locale={locale}
                          bankBalance={bankBalance}
                          editable={b.editable}
                          liveStakeConfig={liveStakeConfig}
                          maxOverdraft={maxOverdraft}
                          lockedFromBetting={lockedFromBetting}
                          bet={b.cardData}
                        />
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {visibleDayBets.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionTitle>
            <span className="inline-flex items-center gap-2">
              <Stamp className="h-5 w-5 text-tertiary-fixed-dim" strokeWidth={1.75} />
              {dayWideTitle}
            </span>
          </SectionTitle>
          <p className="text-sm text-on-surface-variant -mt-1">
            {dayWideHint}
          </p>
          <div className="flex flex-col gap-3">
            {visibleDayBets.map((b) => (
              <CustomBetCard
                key={b.cardData.id}
                locale={locale}
                bankBalance={bankBalance}
                editable={b.editable}
                liveStakeConfig={liveStakeConfig}
                maxOverdraft={maxOverdraft}
                lockedFromBetting={lockedFromBetting}
                bet={b.cardData}
              />
            ))}
          </div>
        </section>
      )}

      {nothingShown && (
        <Card className="p-6 text-center text-on-surface-variant">
          {isFiltering
            ? isHebrew
              ? "אין משחקים או הימורים שתואמים את הסינון."
              : "Nothing matches the current filter."
            : emptyDay}
        </Card>
      )}
    </>
  );
}

function SectionTitle({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <h2 className="font-[family-name:var(--font-display)] text-xl md:text-2xl font-bold text-on-surface">
      {children}
    </h2>
  );
}
