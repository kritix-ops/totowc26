import Link from "next/link";
import { clsx } from "clsx";
import {
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  Radio,
  Sparkles,
} from "lucide-react";
import { Card, Chip, LabelCaps, ScoreLine, SectionHeading } from "@/components/ui";
import { Flag } from "@/components/Flag";
import { formatDateTime } from "@/lib/format";
import { localePath } from "@/lib/paths";
import { renderPickAnswer } from "@/lib/bets/format";
import { getTodayBetsSummary } from "@/db/queries";
import type {
  TodayBetsBet,
  TodayBetsFixture,
  TodayBetsSummary,
} from "@/db/queries";
import type { Locale } from "@/app/[lang]/dictionaries";
import type { getDictionary } from "@/app/[lang]/dictionaries";

// Dashboard "Your bets today" section. Sits between SmartHub and
// UpcomingSection. Shows every bet the caller has on today's slate
// — match-score predictions + match-scope live bets + day-scope live
// bets — plus a running points total. Rolls forward to the next
// fixture date when today is dark, so the section stays useful between
// matchdays. The Async wrapper owns the round-trip so page.tsx mirrors
// the SmartHubAsync pattern; the internal TodayBetsView is purely
// presentational so future preview/dev paths can mock the data.
//
// Returns null when summary is null (no future fixtures — tournament
// is over) so the whole section collapses to nothing instead of
// leaving an empty heading on the page.

type AsyncProps = {
  locale: Locale;
  dict: Awaited<ReturnType<typeof getDictionary>>;
  userId: string;
};

export async function TodaysBetsSectionAsync({
  locale,
  dict,
  userId,
}: AsyncProps) {
  const summary = await getTodayBetsSummary(userId);
  if (!summary) return null;
  return <TodayBetsView locale={locale} dict={dict} summary={summary} />;
}

function TodayBetsView({
  locale,
  dict,
  summary,
}: {
  locale: Locale;
  dict: Awaited<ReturnType<typeof getDictionary>>;
  summary: TodayBetsSummary;
}) {
  const isHebrew = locale === "he";
  const { fixtures, bets, totals, date, isToday } = summary;

  // Group match-scope bets under their fixture so the user sees
  // "score prediction + live bets" together rather than scattered.
  const matchBetsByFixture = new Map<string, TodayBetsBet[]>();
  const dayBets: TodayBetsBet[] = [];
  for (const b of bets) {
    if (b.scope === "day") {
      dayBets.push(b);
    } else if (b.matchId) {
      const arr = matchBetsByFixture.get(b.matchId) ?? [];
      arr.push(b);
      matchBetsByFixture.set(b.matchId, arr);
    }
  }

  // Section title — "today" when the active date is actually today,
  // otherwise the explicit weekday + date so "rolled forward" never
  // feels like a bug.
  const dayLabel = formatDateTime(`${date}T12:00:00Z`, locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const title = isToday
    ? dict.dashboard.todaysBetsTitle
    : isHebrew
      ? `ההימורים שלך ל${dayLabel}`
      : `Your bets for ${dayLabel}`;

  const viewAllHref = localePath(locale, `bets/live/${date}`);
  const hasAnything = fixtures.length > 0 || bets.length > 0;

  return (
    <section
      aria-labelledby="todays-bets-heading"
      className="flex flex-col gap-4 md:gap-6"
    >
      <div className="flex items-end justify-between gap-3">
        <SectionHeading as="h3">
          <span
            id="todays-bets-heading"
            className="inline-flex items-center gap-2"
          >
            <CalendarDays
              className="h-5 w-5 text-tertiary-fixed-dim"
              strokeWidth={1.75}
              aria-hidden
            />
            {title}
          </span>
        </SectionHeading>
        {hasAnything && (
          <Link
            href={viewAllHref}
            className="font-[family-name:var(--font-label)] text-[12px] font-bold tracking-[0.05em] text-primary hover:underline inline-flex items-center gap-1 min-h-[44px]"
          >
            {dict.dashboard.viewAll}
            <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2} />
          </Link>
        )}
      </div>

      {!hasAnything ? (
        <Card className="p-6 text-center text-on-surface-variant">
          {isHebrew
            ? "אין משחקים מתוכננים ליום זה. נחזור לכאן ברגע שיתפרסם הלו״ז."
            : "No matches scheduled for this day yet. We'll be back when the schedule lands."}
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          <SummaryCard
            locale={locale}
            dict={dict}
            dayLabel={dayLabel}
            isToday={isToday}
            totals={totals}
            fixtureCount={fixtures.length}
          />

          {fixtures.length > 0 && (
            <Card className="p-0 overflow-hidden">
              <ul className="flex flex-col">
                {fixtures.map((m, i) => (
                  <li
                    key={m.id}
                    className={i > 0 ? "border-t border-outline-variant" : ""}
                  >
                    <FixtureRow
                      locale={locale}
                      dict={dict}
                      fixture={m}
                      matchBets={matchBetsByFixture.get(m.id) ?? []}
                    />
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {dayBets.length > 0 && (
            <DayBetsList locale={locale} dict={dict} bets={dayBets} />
          )}
        </div>
      )}
    </section>
  );
}

function SummaryCard({
  locale,
  dict,
  dayLabel,
  isToday,
  totals,
  fixtureCount,
}: {
  locale: Locale;
  dict: Awaited<ReturnType<typeof getDictionary>>;
  dayLabel: string;
  isToday: boolean;
  totals: TodayBetsSummary["totals"];
  fixtureCount: number;
}) {
  const isHebrew = locale === "he";
  const placedCount = totals.matchBetCount + totals.customBetCount;
  const points = totals.totalPoints;
  const pointsTone =
    points > 0 ? "text-secondary" : points < 0 ? "text-error" : "text-on-surface-variant";
  return (
    <Card className="p-4 md:p-5 bg-surface-container-low">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex flex-col gap-1">
          <LabelCaps>
            {isToday
              ? isHebrew ? "היום" : "Today"
              : isHebrew ? "התאריך הבא" : "Next match day"}
          </LabelCaps>
          <span className="font-[family-name:var(--font-display)] text-lg md:text-xl font-bold text-on-surface">
            {dayLabel}
          </span>
        </div>
        <Sparkles
          className="h-5 w-5 text-tertiary-fixed-dim shrink-0 mt-1"
          strokeWidth={1.75}
          aria-hidden
        />
      </div>
      <div className="grid grid-cols-3 gap-2 md:gap-3">
        <SummaryTile
          label={isHebrew ? "משחקים" : "Matches"}
          value={String(fixtureCount)}
        />
        <SummaryTile
          label={dict.dashboard.todaysBetsPlaced}
          value={String(placedCount)}
        />
        <SummaryTile
          label={dict.dashboard.todaysBetsPoints}
          value={
            <span className={pointsTone}>
              <span className="bidi-ltr">
                {points > 0 ? `+${points}` : points}
              </span>
            </span>
          }
        />
      </div>
    </Card>
  );
}

function SummaryTile({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="bg-surface-container-lowest border border-outline-variant rounded-md px-2 md:px-3 py-2 md:py-3 text-center min-h-[64px] flex flex-col justify-center gap-1">
      <LabelCaps
        as="div"
        className="text-[10px] md:text-[11px] leading-tight min-h-[1.2em]"
      >
        {label}
      </LabelCaps>
      <div className="font-[family-name:var(--font-display)] text-[22px] md:text-[28px] leading-none font-bold text-on-surface tabular-nums">
        {value}
      </div>
    </div>
  );
}

function FixtureRow({
  locale,
  dict,
  fixture,
  matchBets,
}: {
  locale: Locale;
  dict: Awaited<ReturnType<typeof getDictionary>>;
  fixture: TodayBetsFixture;
  matchBets: TodayBetsBet[];
}) {
  const isHebrew = locale === "he";
  const homeName = isHebrew ? fixture.homeNameHe : fixture.homeNameEn;
  const awayName = isHebrew ? fixture.awayNameHe : fixture.awayNameEn;
  const hasPick = fixture.myHome !== null && fixture.myAway !== null;
  const isFinal = fixture.status === "final";
  const isLive = fixture.status === "live";
  const points = fixture.myPoints ?? 0;
  const exact = fixture.myExact === true;

  return (
    <Link
      href={localePath(locale, `bets/${fixture.id}`)}
      className="press-down block hover:bg-surface-container transition-colors"
    >
      <div className="p-3 md:p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2 md:gap-3">
          {/* Teams + flags - flex-1 so the right side has a stable home */}
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Flag code={fixture.homeCode} size={26} />
            <span className="text-sm md:text-base font-bold truncate">
              {homeName}
            </span>
            <span className="text-on-surface-variant text-xs px-0.5 shrink-0">
              {isHebrew ? "נגד" : "vs"}
            </span>
            <span className="text-sm md:text-base font-bold truncate">
              {awayName}
            </span>
            <Flag code={fixture.awayCode} size={26} />
          </div>

          {/* Status / pick / points */}
          <div className="flex flex-col items-end gap-1 shrink-0 text-end">
            <FixtureStatusBadge
              status={fixture.status}
              kickoffAt={fixture.kickoffAt}
              locale={locale}
              isHebrew={isHebrew}
            />
            {(isLive || isFinal) && fixture.homeScore !== null && fixture.awayScore !== null && (
              <ScoreLine
                home={fixture.homeScore}
                away={fixture.awayScore}
                className="font-[family-name:var(--font-score)] text-base md:text-lg leading-none font-bold text-on-surface tracking-[0.08em]"
              />
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-outline-variant pt-3">
          <div className="flex items-center gap-2 min-w-0">
            <LabelCaps className="shrink-0">{dict.dashboard.yourBet}</LabelCaps>
            {hasPick ? (
              <ScoreLine
                home={fixture.myHome!}
                away={fixture.myAway!}
                className="font-[family-name:var(--font-score)] text-base md:text-lg leading-none font-bold text-primary tracking-[0.08em]"
              />
            ) : (
              <span className="text-sm font-bold text-tertiary-fixed-dim">
                {isHebrew ? "הזן ניחוש" : "Pick a score"}
              </span>
            )}
          </div>

          {isFinal && hasPick && (
            <Chip tone={exact ? "secondary" : points > 0 ? "primary" : "default"}>
              {exact && (
                <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
              )}
              <span className="bidi-ltr">
                {points > 0 ? `+${points}` : points} {dict.common.points}
              </span>
            </Chip>
          )}

          {isFinal && !hasPick && (
            <span className="inline-flex items-center gap-1 text-xs text-on-surface-variant">
              <CircleAlert className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
              {isHebrew ? "לא ניחשת" : "No pick"}
            </span>
          )}
        </div>

        {matchBets.length > 0 && (
          <div className="border-t border-outline-variant pt-3 flex flex-col gap-2">
            <LabelCaps>
              {isHebrew
                ? `הימורי לייב למשחק (${matchBets.length})`
                : `Live bets on this match (${matchBets.length})`}
            </LabelCaps>
            <ul className="flex flex-col gap-1.5">
              {matchBets.map((b) => (
                <li key={b.id}>
                  <CompactBetRow locale={locale} dict={dict} bet={b} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Link>
  );
}

function FixtureStatusBadge({
  status,
  kickoffAt,
  locale,
  isHebrew,
}: {
  status: TodayBetsFixture["status"];
  kickoffAt: string;
  locale: Locale;
  isHebrew: boolean;
}) {
  if (status === "live") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.05em] text-error">
        <Radio className="h-3 w-3 animate-pulse" strokeWidth={2} aria-hidden />
        {isHebrew ? "חי" : "Live"}
      </span>
    );
  }
  if (status === "final") {
    return (
      <LabelCaps className="text-on-surface-variant">
        {isHebrew ? "הסתיים" : "Final"}
      </LabelCaps>
    );
  }
  return (
    <span className="font-[family-name:var(--font-label)] text-[11px] font-bold tabular-nums text-on-surface-variant">
      {formatDateTime(kickoffAt, locale, {
        hour: "2-digit",
        minute: "2-digit",
      })}
    </span>
  );
}

function DayBetsList({
  locale,
  dict,
  bets,
}: {
  locale: Locale;
  dict: Awaited<ReturnType<typeof getDictionary>>;
  bets: TodayBetsBet[];
}) {
  const isHebrew = locale === "he";
  return (
    <Card className="p-0 overflow-hidden">
      <div className="p-3 md:p-4 border-b border-outline-variant flex items-center gap-2">
        <Sparkles
          className="h-4 w-4 text-tertiary-fixed-dim"
          strokeWidth={1.75}
          aria-hidden
        />
        <LabelCaps as="div">
          {isHebrew ? "הימורי לייב יומיים" : "Day-wide live bets"}
        </LabelCaps>
      </div>
      <ul className="flex flex-col">
        {bets.map((b, i) => (
          <li
            key={b.id}
            className={clsx(
              "p-3 md:p-4",
              i > 0 && "border-t border-outline-variant",
            )}
          >
            <CompactBetRow locale={locale} dict={dict} bet={b} fullWidth />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function CompactBetRow({
  locale,
  dict,
  bet,
  fullWidth,
}: {
  locale: Locale;
  dict: Awaited<ReturnType<typeof getDictionary>>;
  bet: TodayBetsBet;
  fullWidth?: boolean;
}) {
  const isHebrew = locale === "he";
  const question = isHebrew ? bet.questionHe : bet.questionEn;
  const hasPick = bet.myAnswer !== null;
  const pickLabel = hasPick
    ? renderPickAnswer(bet.answerType, bet.answerConfig, bet.myAnswer, isHebrew)
    : isHebrew ? "לא הימרת" : "No pick";

  const points = bet.myPointsEarned;
  const settled = bet.status === "graded" || bet.status === "reversed";
  const won = settled && (points ?? 0) > 0;

  return (
    <div
      className={clsx(
        "flex items-start justify-between gap-3",
        fullWidth && "w-full",
      )}
    >
      <div className="flex flex-col gap-1 min-w-0 flex-1">
        <p className="text-sm font-bold text-on-surface leading-snug line-clamp-2">
          {question}
        </p>
        <div className="flex items-center gap-2 text-xs">
          <span
            className={clsx(
              "font-bold truncate",
              hasPick ? "text-primary" : "text-on-surface-variant",
            )}
          >
            {pickLabel}
          </span>
          {hasPick && bet.myStakePaid !== null && bet.myStakePaid > 0 && (
            <>
              <span aria-hidden className="text-on-surface-variant">·</span>
              <span className="text-on-surface-variant whitespace-nowrap">
                {isHebrew
                  ? `סיכון ${bet.myStakePaid} נק'`
                  : `Risked ${bet.myStakePaid}`}
              </span>
            </>
          )}
        </div>
      </div>
      {settled ? (
        <Chip tone={won ? "secondary" : "default"}>
          {won && (
            <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          )}
          <span className="bidi-ltr">
            {(points ?? 0) > 0 ? `+${points}` : points ?? 0}{" "}
            {dict.common.points}
          </span>
        </Chip>
      ) : (
        <BetStatusBadge status={bet.status} isHebrew={isHebrew} />
      )}
    </div>
  );
}

function BetStatusBadge({
  status,
  isHebrew,
}: {
  status: TodayBetsBet["status"];
  isHebrew: boolean;
}) {
  if (status === "open") {
    return (
      <Chip tone="primary">
        {isHebrew ? "פתוח" : "Open"}
      </Chip>
    );
  }
  if (status === "locked") {
    return (
      <Chip tone="warning">
        {isHebrew ? "נעול" : "Locked"}
      </Chip>
    );
  }
  return null;
}

export function TodaysBetsSectionSkeleton() {
  return (
    <section className="flex flex-col gap-4 md:gap-6" aria-hidden>
      <div className="flex justify-between items-end">
        <div className="h-7 w-40 rounded animate-pulse bg-surface-container-high" />
        <div className="h-4 w-20 rounded animate-pulse bg-surface-container-high" />
      </div>
      <div className="flex flex-col gap-4">
        <div className="h-28 rounded-lg animate-pulse bg-surface-container-high border border-outline-variant" />
        <div className="h-40 rounded-lg animate-pulse bg-surface-container-high border border-outline-variant" />
      </div>
    </section>
  );
}
