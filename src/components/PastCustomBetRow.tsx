import { clsx } from "clsx";
import { Card } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { renderPickAnswer } from "@/lib/bets/format";
import { customBetPointsDisplay } from "@/lib/bets/past-view";
import type { Locale, Dictionary } from "@/app/[lang]/dictionaries";

// Read-only row for the past-tournament/groups/stage bet views. Mirrors
// the data shape returned by getPastTournamentBets / getPastGroupBets
// (which intentionally share columns), so a single component renders
// both surfaces.
//
// What the user sees per row, in this order:
//   - Status badge (Graded / Reversed / Cancelled) + the date it
//     resolved (graded_at, falling back to lock_at when null)
//   - The question, decoded for the active locale
//   - My pick | Actual result two-column grid
//   - The points the user earned, with sign-aware tone

export type PastCustomBetRowData = {
  id: string;
  questionHe: string;
  questionEn: string;
  answerType: "yes_no" | "number" | "multi_choice" | "free_text";
  answerConfig: unknown;
  lockAt: string;
  gradedAt: string | null;
  status: "graded" | "reversed" | "cancelled";
  resolvedValue: unknown | null;
  myAnswer: unknown | null;
  myStakePaid: number | null;
  myPointsEarned: number | null;
  myWasCorrect: boolean | null;
};

export function PastCustomBetRow({
  locale,
  dict,
  bet,
}: {
  locale: Locale;
  dict: Dictionary;
  bet: PastCustomBetRowData;
}) {
  const isHebrew = locale === "he";
  const t = dict.pastBets;
  const question = isHebrew ? bet.questionHe : bet.questionEn;
  const resolvedAt = bet.gradedAt ?? bet.lockAt;
  const hasMyPick = bet.myAnswer !== null;

  const myAnswerText = hasMyPick
    ? renderPickAnswer(bet.answerType, bet.answerConfig, bet.myAnswer, isHebrew)
    : t.noPickInline;
  const resultText =
    bet.status === "cancelled"
      ? t.cancelledBadge
      : bet.resolvedValue !== null
        ? renderPickAnswer(
            bet.answerType,
            bet.answerConfig,
            bet.resolvedValue,
            isHebrew,
          )
        : t.noPickShort;

  const statusBadge =
    bet.status === "graded"
      ? t.gradedBadge
      : bet.status === "reversed"
        ? t.reversedBadge
        : t.cancelledBadge;
  const statusTone =
    bet.status === "graded"
      ? "bg-surface-container-high text-on-surface-variant"
      : bet.status === "reversed"
        ? "bg-tertiary-container text-on-tertiary-container"
        : "bg-surface-container-high text-outline";

  return (
    <Card className="p-4 md:p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <span
          className={clsx(
            "inline-flex items-center gap-1.5 px-2 h-6 rounded-full text-[11px] font-bold",
            statusTone,
          )}
        >
          {statusBadge}
        </span>
        <span className="text-[11px] text-outline tabular-nums">
          {formatDateTime(resolvedAt, locale, {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>

      <p className="font-bold text-sm md:text-base text-on-surface">
        {question}
      </p>

      <div className="grid grid-cols-[1fr_1fr_auto] gap-3 pt-2 border-t border-outline-variant items-center">
        <Cell label={t.myPickLabel}>
          <span
            className={clsx(
              "text-sm md:text-base font-bold truncate",
              hasMyPick ? "text-on-surface" : "text-on-surface-variant",
            )}
            title={myAnswerText}
          >
            {myAnswerText}
          </span>
        </Cell>
        <Cell label={t.resultLabel}>
          <span
            className="text-sm md:text-base font-bold text-on-surface truncate"
            title={resultText}
          >
            {resultText}
          </span>
        </Cell>
        <Cell label={t.pointsLabel}>
          <PointsChip
            points={bet.myPointsEarned}
            hasPick={hasMyPick}
            status={bet.status}
            t={t}
          />
        </Cell>
      </div>
    </Card>
  );
}

function Cell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-1 min-w-0">
      <span className="font-[family-name:var(--font-label)] text-[10px] font-bold tracking-[0.05em] uppercase text-on-surface-variant">
        {label}
      </span>
      <div className="min-w-0 max-w-full">{children}</div>
    </div>
  );
}

function PointsChip({
  points,
  hasPick,
  status,
  t,
}: {
  points: number | null;
  hasPick: boolean;
  status: "graded" | "reversed" | "cancelled";
  t: Dictionary["pastBets"];
}) {
  const display = customBetPointsDisplay({ hasPick, status, points });
  if (display.kind === "none") {
    return (
      <span className="text-on-surface-variant text-sm">{t.noPickShort}</span>
    );
  }
  if (display.kind === "pending") {
    return (
      <span className="text-on-surface-variant text-xs">{t.pendingResult}</span>
    );
  }
  const tone =
    display.tone === "positive"
      ? "bg-success-container text-on-success-container"
      : display.tone === "negative"
        ? "bg-error-container text-on-error-container"
        : "bg-surface-container-high text-on-surface-variant";
  return (
    <span
      className={clsx(
        "inline-flex items-center justify-center px-2.5 h-7 rounded-full font-[family-name:var(--font-score)] text-base font-bold tabular-nums",
        tone,
      )}
    >
      <bdi>
        {display.points > 0 ? "+" : ""}
        {display.points}
      </bdi>
    </span>
  );
}
