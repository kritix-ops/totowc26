import { clsx } from "clsx";
import { Card, ScoreLine } from "@/components/ui";
import { Flag } from "@/components/Flag";
import { formatDateTime } from "@/lib/format";
import {
  matchPickPointsDisplay,
  matchPickOutcome,
} from "@/lib/bets/past-view";
import { stageLabel, isKnockoutStage } from "@/lib/stage-label";
import type { Locale, Dictionary } from "@/app/[lang]/dictionaries";
import type { PastMatchPickRow as PastMatchPickRowData } from "@/db/queries";

// Read-only row for the /bets?view=past list. One card per match that
// has already kicked off (live or final). Shows the match teams, the
// caller's pick (or "—" when they didn't pick), the actual score (or
// "Awaiting result" while live without a score yet), the points they
// earned, and the kickoff date. No edit affordances — the user can't
// change a pick once the match has started.

export function PastMatchPickRow({
  locale,
  dict,
  match,
}: {
  locale: Locale;
  dict: Dictionary;
  match: PastMatchPickRowData;
}) {
  const isHebrew = locale === "he";
  const t = dict.pastBets;
  const homeName = isHebrew ? match.homeNameHe : match.homeNameEn;
  const awayName = isHebrew ? match.awayNameHe : match.awayNameEn;
  const hasMyPick =
    match.myHomeScore !== null && match.myAwayScore !== null;
  const hasActualScore =
    match.homeScore !== null && match.awayScore !== null;
  const isKnockout = isKnockoutStage(match.stage);
  // The 1/X/2 grade is judged on the 90-minute score. When a knockout went past
  // 90' the final scoreboard differs from that, so spell out the basis to keep
  // an "exact" badge from looking wrong next to a 2-1 AET scoreline.
  const regDiffers =
    match.regHomeScore !== null &&
    match.regAwayScore !== null &&
    (match.regHomeScore !== match.homeScore ||
      match.regAwayScore !== match.awayScore);
  const teamName = (code: string | null) =>
    code === match.homeCode ? homeName : code === match.awayCode ? awayName : null;
  const statusBadge =
    match.status === "final" ? t.finalBadge : t.liveBadge;
  const statusTone =
    match.status === "final"
      ? "bg-surface-container-high text-on-surface-variant"
      : "bg-primary-container text-on-primary-container";

  return (
    <Card className="p-4 md:p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className={clsx(
              "inline-flex items-center gap-1.5 px-2 h-6 rounded-full text-[11px] font-bold tabular-nums",
              statusTone,
            )}
          >
            {statusBadge}
          </span>
          <span className="inline-flex items-center px-2 h-6 rounded-full text-[11px] font-bold bg-secondary-container text-on-secondary-container truncate">
            {stageLabel(match.stage, match.groupId, isHebrew ? "he" : "en")}
          </span>
        </div>
        <span className="text-[11px] text-outline tabular-nums">
          {formatDateTime(match.kickoffAt, locale, {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>

      {/* The scoreboard IS the result — home flag/name, the actual final
          score (or "Awaiting result" while live), away flag/name. We
          deliberately don't repeat the score in a separate cell below. */}
      <div className="flex items-center justify-between gap-2 min-w-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Flag code={match.homeCode} size={28} />
          <span className="font-bold text-sm md:text-base text-on-surface truncate">
            {homeName}
          </span>
        </div>
        <div className="text-center shrink-0 px-2">
          {hasActualScore ? (
            <ScoreLine
              home={match.homeScore!}
              away={match.awayScore!}
              className="font-[family-name:var(--font-score)] text-xl md:text-2xl font-bold text-on-surface"
            />
          ) : (
            <span className="text-xs text-on-surface-variant">
              {t.pendingResult}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 min-w-0 flex-1 justify-end">
          <span className="font-bold text-sm md:text-base text-on-surface truncate text-end">
            {awayName}
          </span>
          <Flag code={match.awayCode} size={28} />
        </div>
      </div>

      {/* The score guess is graded on 90 minutes — when a knockout went past
          90' the scoreboard above differs, so name the basis explicitly. */}
      {regDiffers && (
        <p className="text-center text-[10px] text-on-surface-variant -mt-1">
          {isHebrew
            ? `ניחוש התוצאה נספר לפי 90 דקות: ${match.regHomeScore}–${match.regAwayScore}`
            : `Score judged on 90 min: ${match.regHomeScore}–${match.regAwayScore}`}
        </p>
      )}

      {/* Footer: the user's own pick and what it earned. Two roomy cells
          rather than three narrow ones — the result lives in the
          scoreboard above. */}
      <div className="grid grid-cols-2 gap-3 pt-2 border-t border-outline-variant">
        <Cell label={t.myPickLabel}>
          {hasMyPick ? (
            <ScoreLine
              home={match.myHomeScore!}
              away={match.myAwayScore!}
              className="font-[family-name:var(--font-score)] text-base md:text-lg font-bold text-on-surface"
            />
          ) : (
            <span className="text-on-surface-variant text-sm">
              {t.noPickInline}
            </span>
          )}
        </Cell>
        <Cell label={t.pointsLabel}>
          <PointsChip
            points={match.myPointsEarned}
            wasExact={match.myWasExact}
            wasCorrectOutcome={match.myWasCorrectOutcome}
            hasPick={hasMyPick}
            t={t}
          />
        </Cell>
      </div>

      {/* Knockout-only "who advances?" result: the user's pick, whether it was
          right, and (once decided) who actually went through. */}
      {isKnockout && (
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-outline-variant">
          <span className="font-[family-name:var(--font-label)] text-[10px] font-bold tracking-[0.05em] uppercase text-on-surface-variant">
            {isHebrew ? "מי עולה" : "Who advances"}
          </span>
          <div className="flex items-center gap-2 min-w-0">
            {match.myAdvanceTeam ? (
              <span className="inline-flex items-center gap-1.5 text-sm font-bold text-on-surface min-w-0">
                <Flag code={match.myAdvanceTeam} size={18} />
                <span className="truncate">{teamName(match.myAdvanceTeam)}</span>
              </span>
            ) : (
              <span className="text-on-surface-variant text-sm">
                {t.noPickInline}
              </span>
            )}
            {match.myAdvancePoints !== null && match.myAdvanceTeam && (
              <span
                className={clsx(
                  "inline-flex items-center justify-center px-2 h-6 rounded-full font-[family-name:var(--font-score)] text-sm font-bold tabular-nums shrink-0",
                  match.myAdvanceWasCorrect
                    ? "bg-success-container text-on-success-container"
                    : "bg-surface-container-high text-on-surface-variant",
                )}
              >
                <bdi>
                  {match.myAdvancePoints > 0 ? "+" : ""}
                  {match.myAdvancePoints}
                </bdi>
              </span>
            )}
          </div>
        </div>
      )}
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
    <div className="flex flex-col items-center gap-1 min-w-0">
      <span className="font-[family-name:var(--font-label)] text-[10px] font-bold tracking-[0.05em] uppercase text-on-surface-variant">
        {label}
      </span>
      <div className="flex items-center justify-center">{children}</div>
    </div>
  );
}

function PointsChip({
  points,
  wasExact,
  wasCorrectOutcome,
  hasPick,
  t,
}: {
  points: number | null;
  wasExact: boolean | null;
  wasCorrectOutcome: boolean | null;
  hasPick: boolean;
  t: Dictionary["pastBets"];
}) {
  const display = matchPickPointsDisplay({ hasPick, points });
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
  const outcome = matchPickOutcome({ wasExact, wasCorrectOutcome });
  const subtitle =
    outcome === "exact"
      ? t.exactBonus
      : outcome === "direction"
        ? t.directionBonus
        : t.wrongPick;
  return (
    <div className="flex flex-col items-center gap-0.5">
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
      <span className="text-[10px] text-on-surface-variant text-center">
        {subtitle}
      </span>
    </div>
  );
}
