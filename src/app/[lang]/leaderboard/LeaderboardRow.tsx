"use client";

import { useState } from "react";
import { ChevronDown, Flame, Trophy, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { clsx } from "clsx";
import { LabelCaps } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { summarizeLeaderboardEvents } from "@/lib/leaderboard-breakdown";
import type { Locale } from "@/app/[lang]/dictionaries";
import type { LeaderboardEvent } from "@/db/queries";

// One leaderboard row — collapsed by default, expands on tap into an
// accordion that explains how the user's current total came to be. The
// row passes the events array straight through; we compute previous
// total + today/last delta on the client (cheap, fully derived data).
//
// The accordion lists each contributing event newest-first: question
// label, optional detail line (e.g. "pick 1-0 · result 1-1"), and a
// signed +/- delta with a tone that matches gain/loss/neutral.

export function LeaderboardRow({
  locale,
  rank,
  displayName,
  youLabel,
  isYou,
  points,
  betCount,
  prizeIls,
  events,
  top3,
  pointsLabel,
}: {
  locale: Locale;
  rank: number;
  displayName: string;
  youLabel: string;
  isYou: boolean;
  points: number;
  betCount: number;
  prizeIls: number;
  events: LeaderboardEvent[];
  top3: boolean;
  pointsLabel: string;
}) {
  const isHebrew = locale === "he";
  const [open, setOpen] = useState(false);

  // Split events into "today" and "earlier" buckets (Asia/Jerusalem).
  // "today" drives the top headline; "earlier" populates the rest of
  // the list. If nothing happened today, the headline falls back to
  // "since last activity" and shows the most recent slice instead.
  const {
    earlierEvents,
    headlineDelta,
    headlineIsToday,
    headlineEvents,
    previousPoints,
  } = summarizeLeaderboardEvents(events, points, new Date());

  return (
    <li
      className={clsx(
        "rounded-lg border transition-colors",
        isYou
          ? "border-primary bg-primary-fixed sticky top-14 md:top-16 z-10 shadow-md"
          : "border-outline-variant bg-surface-container-lowest",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={`lb-acc-${rank}-${displayName}`}
        className="w-full flex items-center gap-3 md:gap-4 p-3 md:p-4 text-start press-down"
      >
        <span className="font-[family-name:var(--font-display)] text-xl md:text-2xl leading-none font-bold text-on-surface w-7 md:w-8 text-center bidi-ltr">
          {rank}
        </span>
        <div
          className={clsx(
            "w-10 h-10 md:w-12 md:h-12 rounded-full bg-surface-variant flex items-center justify-center text-base md:text-lg font-bold text-on-surface shrink-0",
            top3 && "ring-2 ring-tertiary-fixed-dim",
          )}
          aria-hidden
        >
          {displayName.charAt(0)}
        </div>
        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
          <span className="text-sm md:text-base font-bold text-on-surface truncate">
            {isYou ? youLabel : displayName}
          </span>
          {betCount > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-on-surface-variant">
              <Flame className="h-3 w-3" strokeWidth={2} />
              <span className="bidi-ltr">{betCount}</span>{" "}
              <span>{isHebrew ? "הימורים" : "bets"}</span>
            </span>
          )}
        </div>
        <div className="text-end shrink-0 flex flex-col items-end gap-0.5">
          <span className="font-[family-name:var(--font-display)] text-xl md:text-2xl leading-none font-bold text-surface-tint">
            <span className="bidi-ltr">{points}</span>
          </span>
          <LabelCaps as="div">{pointsLabel}</LabelCaps>
          {prizeIls > 0 && rank <= 3 && (
            <span
              className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-tertiary-fixed text-on-tertiary-fixed-variant text-[11px] font-bold tabular-nums"
              aria-label={
                isHebrew
                  ? `פרס למקום ${rank}: ${prizeIls} ש"ח`
                  : `Prize for rank ${rank}: ${prizeIls} ILS`
              }
            >
              <Trophy className="h-3 w-3" strokeWidth={2} />
              <bdi>
                {prizeIls.toLocaleString()} {isHebrew ? "ש\"ח" : "ILS"}
              </bdi>
            </span>
          )}
        </div>
        <ChevronDown
          className={clsx(
            "h-5 w-5 text-outline shrink-0 transition-transform",
            open && "rotate-180",
          )}
          strokeWidth={2}
          aria-hidden
        />
      </button>

      {open && (
        <div
          id={`lb-acc-${rank}-${displayName}`}
          className="border-t border-outline-variant px-3 md:px-4 py-3 md:py-4 flex flex-col gap-3"
        >
          <SummaryStrip
            previousPoints={previousPoints}
            currentPoints={points}
            delta={headlineDelta}
            isToday={headlineIsToday}
            hasActivity={events.length > 0}
            isHebrew={isHebrew}
          />

          {events.length === 0 ? (
            <p className="text-sm text-on-surface-variant">
              {isHebrew
                ? "אין עדיין אירועי ניקוד — כל ההימורים עוד פתוחים."
                : "No graded events yet — bets are still open."}
            </p>
          ) : (
            <EventsList
              locale={locale}
              isHebrew={isHebrew}
              headlineLabel={
                headlineIsToday
                  ? isHebrew
                    ? "היום"
                    : "Today"
                  : isHebrew
                    ? "פעם אחרונה"
                    : "Most recent"
              }
              earlierLabel={isHebrew ? "קודם" : "Earlier"}
              headlineEvents={headlineEvents}
              earlierEvents={earlierEvents}
              headlineIsToday={headlineIsToday}
            />
          )}
        </div>
      )}
    </li>
  );
}

function SummaryStrip({
  previousPoints,
  currentPoints,
  delta,
  isToday,
  hasActivity,
  isHebrew,
}: {
  previousPoints: number;
  currentPoints: number;
  delta: number;
  isToday: boolean;
  hasActivity: boolean;
  isHebrew: boolean;
}) {
  const TrendIcon =
    delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;
  const tone =
    delta > 0
      ? "text-on-secondary-container bg-secondary-container"
      : delta < 0
        ? "text-on-error-container bg-error-container"
        : "text-on-surface bg-surface-container";
  const deltaLabel =
    delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : "0";
  const sinceLabel = isToday
    ? isHebrew
      ? "לפני היום"
      : "Before today"
    : isHebrew
      ? "לפני האחרון"
      : "Before latest";
  return (
    <div className="grid grid-cols-3 gap-2 items-stretch">
      <Stat
        label={sinceLabel}
        value={hasActivity ? String(previousPoints) : "—"}
      />
      <Stat
        label={isHebrew ? (isToday ? "השינוי היום" : "השינוי האחרון") : isToday ? "Change today" : "Latest change"}
        value={deltaLabel}
        tone={tone}
        icon={<TrendIcon className="h-4 w-4" strokeWidth={2} aria-hidden />}
      />
      <Stat
        label={isHebrew ? "כעת" : "Now"}
        value={String(currentPoints)}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: string;
  tone?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div
      className={clsx(
        "flex flex-col items-center justify-center gap-1 rounded-xl py-2 px-1",
        tone ?? "bg-surface-container",
      )}
    >
      <LabelCaps as="div">{label}</LabelCaps>
      <span className="inline-flex items-center gap-1 font-[family-name:var(--font-display)] text-lg md:text-xl leading-none font-bold tabular-nums">
        {icon}
        <span className="bidi-ltr">{value}</span>
      </span>
    </div>
  );
}

function EventsList({
  locale,
  isHebrew,
  headlineLabel,
  earlierLabel,
  headlineEvents,
  earlierEvents,
  headlineIsToday,
}: {
  locale: Locale;
  isHebrew: boolean;
  headlineLabel: string;
  earlierLabel: string;
  headlineEvents: LeaderboardEvent[];
  earlierEvents: LeaderboardEvent[];
  headlineIsToday: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <EventGroup
        locale={locale}
        isHebrew={isHebrew}
        label={headlineLabel}
        events={headlineEvents}
        showRelativeDate={!headlineIsToday}
      />
      {earlierEvents.length > 0 && (
        <EventGroup
          locale={locale}
          isHebrew={isHebrew}
          label={earlierLabel}
          events={earlierEvents}
          showRelativeDate={true}
        />
      )}
    </div>
  );
}

function EventGroup({
  locale,
  isHebrew,
  label,
  events,
  showRelativeDate,
}: {
  locale: Locale;
  isHebrew: boolean;
  label: string;
  events: LeaderboardEvent[];
  showRelativeDate: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <LabelCaps>{label}</LabelCaps>
      <ul className="flex flex-col gap-1.5">
        {events.map((e, i) => (
          <EventRow
            key={`${e.kind}-${e.eventAt}-${i}`}
            locale={locale}
            isHebrew={isHebrew}
            event={e}
            showRelativeDate={showRelativeDate}
          />
        ))}
      </ul>
    </div>
  );
}

function EventRow({
  locale,
  isHebrew,
  event,
  showRelativeDate,
}: {
  locale: Locale;
  isHebrew: boolean;
  event: LeaderboardEvent;
  showRelativeDate: boolean;
}) {
  const title = isHebrew ? event.titleHe : event.titleEn;
  const detail = isHebrew ? event.detailHe : event.detailEn;
  const kindLabel = kindToLabel(event.kind, isHebrew);
  const tone =
    event.delta > 0
      ? "bg-secondary-container text-on-secondary-container border-secondary-fixed"
      : event.delta < 0
        ? "bg-error-container text-on-error-container border-error"
        : "bg-surface-container text-on-surface border-outline-variant";
  const deltaLabel =
    event.delta > 0
      ? `+${event.delta}`
      : event.delta < 0
        ? `${event.delta}`
        : "0";
  const when = formatDateTime(event.eventAt, locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <li className="flex items-start gap-2 p-2 rounded-lg bg-surface-container-lowest border border-outline-variant">
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] font-bold tracking-[0.05em] uppercase text-on-surface-variant px-1.5 py-0.5 rounded-full bg-surface-container">
            {kindLabel}
          </span>
          {showRelativeDate && (
            <span className="text-xs text-on-surface-variant tabular-nums">
              {when}
            </span>
          )}
        </div>
        <span className="text-sm font-bold text-on-surface break-words">
          {title}
        </span>
        {detail && (
          <span className="text-xs text-on-surface-variant break-words">
            {detail}
          </span>
        )}
      </div>
      <span
        className={clsx(
          "shrink-0 inline-flex items-center justify-center min-w-[44px] px-2 py-1 rounded-full text-sm font-bold tabular-nums border",
          tone,
        )}
        aria-label={
          isHebrew
            ? `שינוי של ${deltaLabel} נקודות`
            : `${deltaLabel} points`
        }
      >
        <span className="bidi-ltr">{deltaLabel}</span>
      </span>
    </li>
  );
}

function kindToLabel(kind: LeaderboardEvent["kind"], isHebrew: boolean): string {
  switch (kind) {
    case "match":      return isHebrew ? "משחק" : "Match";
    case "live":       return isHebrew ? "לייב" : "Live";
    case "tournament": return isHebrew ? "טורניר" : "Tournament";
    case "duel":       return isHebrew ? "דו-קרב" : "Duel";
    case "adjustment": return isHebrew ? "התאמה" : "Adjustment";
  }
}
