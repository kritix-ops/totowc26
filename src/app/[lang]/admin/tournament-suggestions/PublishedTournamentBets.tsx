"use client";

import { useState } from "react";
import { ChevronDown, RotateCcw, Trophy, Users } from "lucide-react";
import { clsx } from "clsx";
import { Card, Chip, LabelCaps, SectionHeading } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import type { Locale } from "../../dictionaries";
import { GradeForm } from "../bets/[id]/GradeForm";

// The published tournament bets a manager needs to finalize, rendered
// directly on the "Tournament bets" page so settling a decided bet
// (e.g. total red cards once the count is in) no longer means hunting
// through the "Live bets" surface. Each row expands to the SAME GradeForm
// the detail page uses — one grading UI, reused verbatim.
//
// Scope is deliberately narrowed to stage + tournament by the page: group
// bets auto-grade and live on /admin/group-bets, so they are not listed
// here. See _plans/2026-07-06-finalize-tournament-bets-on-tournament-page.md.

type BetStatus = "open" | "locked" | "reversed" | "graded";

export type PublishedTournamentBet = {
  id: string;
  status: BetStatus;
  // Pre-localized on the server so this client island carries no i18n logic.
  question: string;
  scopeLabel: string;
  answerType: "yes_no" | "number" | "multi_choice" | "free_text";
  answerConfig: unknown;
  resolvedValue: unknown;
  payoutSnapshot: number;
  pickCount: number;
  lockAt: string;
};

export function PublishedTournamentBets({
  locale,
  bets,
}: {
  locale: Locale;
  bets: PublishedTournamentBet[];
}) {
  const isHebrew = locale === "he";
  const awaiting = bets.filter((b) => b.status !== "graded").length;

  return (
    <section className="flex flex-col gap-3">
      <SectionHeading as="h2" underline="thin">
        {isHebrew ? "ההימורים שפרסמת" : "Your published bets"}
      </SectionHeading>
      <p className="text-sm text-on-surface-variant">
        {isHebrew
          ? "סיים כאן הימור טורניר שכבר הוכרע — בחר את התוצאה והזוכים מקבלים את הנקודות. אין צורך ללכת לעמוד הימורי הלייב."
          : "Finalize a decided tournament bet right here — set the result and winners get their points. No need to visit the live bets page."}
      </p>

      {bets.length === 0 ? (
        <Card className="p-6 text-center text-on-surface-variant">
          {isHebrew
            ? "עוד לא פרסמת הימורי טורניר. פרסם אחד מהתבניות למטה."
            : "No tournament bets published yet. Publish one from the templates below."}
        </Card>
      ) : (
        <>
          {awaiting > 0 && (
            <p className="text-sm font-bold text-primary">
              {isHebrew
                ? `${awaiting} ממתינים לסיום`
                : `${awaiting} awaiting finalize`}
            </p>
          )}
          <div className="flex flex-col gap-3">
            {bets.map((bet) => (
              <BetRow key={bet.id} locale={locale} bet={bet} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function BetRow({
  locale,
  bet,
}: {
  locale: Locale;
  bet: PublishedTournamentBet;
}) {
  const isHebrew = locale === "he";
  const [open, setOpen] = useState(false);
  const isGraded = bet.status === "graded";
  const lockLabel = formatDateTime(bet.lockAt, locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <Card className="p-4 md:p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex flex-col gap-2 min-w-0 flex-1">
          <h3 className="font-bold text-base md:text-lg text-on-surface !leading-tight">
            {bet.question}
          </h3>
          <div className="flex flex-wrap gap-2 items-center">
            <Chip tone={statusTone(bet.status)}>
              {statusLabel(bet.status, isHebrew)}
            </Chip>
            <Chip tone="secondary">{bet.scopeLabel}</Chip>
            <Chip className="inline-flex items-center gap-1 tabular-nums">
              <Users className="h-3.5 w-3.5" strokeWidth={2} />
              <bdi>{bet.pickCount}</bdi>
            </Chip>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <LabelCaps>{isHebrew ? "נסגר" : "Locks"}</LabelCaps>
          <span className="font-[family-name:var(--font-label)] text-sm font-bold tabular-nums">
            {lockLabel}
          </span>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="press-down self-start inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-full border border-outline bg-surface-container-lowest text-on-surface text-sm font-bold hover:bg-surface-container"
      >
        {isGraded ? (
          <RotateCcw className="h-4 w-4" strokeWidth={2} />
        ) : (
          <Trophy className="h-4 w-4" strokeWidth={2} />
        )}
        {isGraded
          ? isHebrew
            ? "תקן תוצאה"
            : "Fix result"
          : isHebrew
            ? "סיים הימור"
            : "Finalize"}
        <ChevronDown
          className={clsx("h-4 w-4 transition-transform", open && "rotate-180")}
          strokeWidth={2}
        />
      </button>

      {open && (
        <GradeForm
          locale={locale}
          bet={{
            id: bet.id,
            status: bet.status,
            answerType: bet.answerType,
            answerConfig: bet.answerConfig,
            resolvedValue: bet.resolvedValue,
            payoutSnapshot: bet.payoutSnapshot,
          }}
        />
      )}
    </Card>
  );
}

function statusTone(
  s: BetStatus,
): "default" | "primary" | "secondary" | "warning" {
  switch (s) {
    case "open":
      return "primary";
    case "locked":
      return "warning";
    case "reversed":
      return "warning";
    case "graded":
      return "secondary";
  }
}

function statusLabel(s: BetStatus, isHebrew: boolean): string {
  const map: Record<BetStatus, [string, string]> = {
    open: ["פתוח", "Open"],
    locked: ["נסגר", "Locked"],
    reversed: ["הוחזר", "Reversed"],
    graded: ["נמדד", "Graded"],
  };
  return map[s][isHebrew ? 0 : 1];
}
