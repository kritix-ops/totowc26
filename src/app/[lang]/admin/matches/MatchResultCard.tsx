"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, PencilLine, Trophy } from "lucide-react";
import { Card, Chip, LabelCaps, PillButton } from "@/components/ui";
import { Flag } from "@/components/Flag";
import { usePendingAction } from "@/lib/use-pending-action";
import {
  COMMON_ADMIN_ERRORS,
  translateAdminError,
  type LocalizedTuple,
} from "@/lib/admin/errors";
import type { Locale } from "../../dictionaries";
import { stageLabel } from "@/lib/stage-label";
import { knockoutWinner, type MatchResultInput } from "@/lib/matches/result";
import { setMatchResult } from "./actions";

const ERROR_MAP: Record<string, LocalizedTuple> = {
  ...COMMON_ADMIN_ERRORS,
  match_not_found: ["המשחק לא נמצא", "Match not found"],
  invalid_status: [
    "אי אפשר להזין תוצאה למשחק דחוי/מבוטל — צריך קודם להחזיר אותו",
    "Can't enter a result on a postponed/canceled match — reopen it first",
  ],
  invalid_reason: ["צריך לכתוב סיבה (לפחות 3 תווים)", "A reason (3+ chars) is required"],
  match_not_started: ["המשחק עדיין לא התחיל", "The match hasn't kicked off yet"],
  invalid_score: [
    "תוצאה לא תקינה (0–99, והתוצאה הסופית לא יכולה להיות נמוכה מ-90 הדקות)",
    "Invalid score (0–99, and the final can't be lower than the 90' score)",
  ],
  invalid_penalties: [
    "פרטי הפנדלים לא תקינים (רק בנוקאאוט שוויוני, עם מנצח)",
    "Invalid penalties (knockout only, level after extra time, with a winner)",
  ],
  invalid_advancing_team: [
    "הקבוצה שעולה לא תואמת את התוצאה",
    "The advancing team doesn't match the result",
  ],
};

export type MatchResultRow = {
  id: string;
  homeName: string;
  awayName: string;
  homeCode: string;
  awayCode: string;
  stage: string;
  status: "scheduled" | "live" | "final";
  kickoffLabel: string;
  manualResult: boolean;
  guessCount: number;
  advancePickCount: number;
  // Existing scores, prefilled for a correction. Null before any result.
  regHome: number | null;
  regAway: number | null;
  finalHome: number | null;
  finalAway: number | null;
  wentToPenalties: boolean | null;
  penHome: number | null;
  penAway: number | null;
};

// Manual result entry for one match: type in the 90' score (and, for a
// knockout, the final incl. extra time + a penalty shootout), mark the match
// final, and re-grade. Used when the API sync is delayed or wrong. Saving flags
// the match manual_result so a later sync can't overwrite it. "Who advances?"
// is derived from the scoreline the admin enters and shown for transparency;
// fine corrections still live in the "who advances" card below. See
// setMatchResult in ./actions.
export function MatchResultCard({
  locale,
  match,
}: {
  locale: Locale;
  match: MatchResultRow;
}) {
  const isHebrew = locale === "he";
  const isKnockout = match.stage !== "group";
  const router = useRouter();
  const { pending, run } = usePendingAction();

  const [regHome, setRegHome] = useState(numStr(match.regHome));
  const [regAway, setRegAway] = useState(numStr(match.regAway));
  const [finalHome, setFinalHome] = useState(numStr(match.finalHome));
  const [finalAway, setFinalAway] = useState(numStr(match.finalAway));
  const [penHome, setPenHome] = useState(numStr(match.penHome));
  const [penAway, setPenAway] = useState(numStr(match.penAway));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isCorrection = match.status === "final";

  // For a group match the final equals the 90' score, so we only show one row
  // and mirror it. For a knockout the admin enters both.
  const effFinalHome = isKnockout ? finalHome : regHome;
  const effFinalAway = isKnockout ? finalAway : regAway;

  const fh = toInt(effFinalHome);
  const fa = toInt(effFinalAway);
  const level = fh !== null && fa !== null && fh === fa;
  // A knockout level after extra time is, by definition, decided on penalties —
  // so we show the shootout inputs whenever that's the case (no separate toggle).
  const showPenalties = isKnockout && level;

  // Who advances, derived live from what the admin has typed so far. Null when
  // it can't be determined yet (level with no valid shootout).
  const derivedInput: MatchResultInput = {
    regHome: toInt(regHome) ?? 0,
    regAway: toInt(regAway) ?? 0,
    finalHome: fh ?? 0,
    finalAway: fa ?? 0,
    wentToPenalties: showPenalties,
    penHome: showPenalties ? toInt(penHome) : null,
    penAway: showPenalties ? toInt(penAway) : null,
    advancingTeam: null,
  };
  const winner =
    isKnockout && fh !== null && fa !== null
      ? knockoutWinner(derivedInput, {
          homeTeam: match.homeCode,
          awayTeam: match.awayCode,
        })
      : null;
  const winnerName =
    winner === match.homeCode
      ? match.homeName
      : winner === match.awayCode
        ? match.awayName
        : null;

  const onSave = () => {
    setError(null);
    setSuccess(null);

    const rh = toInt(regHome);
    const ra = toInt(regAway);
    if (rh === null || ra === null) {
      setError(isHebrew ? "צריך למלא תוצאת 90 דקות." : "Enter the 90-minute score.");
      return;
    }
    const efh = isKnockout ? toInt(finalHome) : rh;
    const efa = isKnockout ? toInt(finalAway) : ra;
    if (efh === null || efa === null) {
      setError(isHebrew ? "צריך למלא תוצאה סופית." : "Enter the final score.");
      return;
    }
    const usePen = isKnockout && efh === efa;
    if (usePen && (toInt(penHome) === null || toInt(penAway) === null)) {
      setError(
        isHebrew
          ? "המשחק שוויוני — צריך תוצאת פנדלים כדי לקבוע מי עולה."
          : "The match is level — enter the penalty score to decide who advances.",
      );
      return;
    }
    if (reason.trim().length < 3) {
      setError(isHebrew ? "צריך לכתוב סיבה (לפחות 3 תווים)." : "A reason (3+ chars) is required.");
      return;
    }

    const base = {
      regHome: rh,
      regAway: ra,
      finalHome: efh,
      finalAway: efa,
      wentToPenalties: usePen,
      penHome: usePen ? toInt(penHome) : null,
      penAway: usePen ? toInt(penAway) : null,
    };
    const input: MatchResultInput = {
      ...base,
      advancingTeam: isKnockout
        ? knockoutWinner(
            { ...base, advancingTeam: null },
            { homeTeam: match.homeCode, awayTeam: match.awayCode },
          )
        : null,
    };

    void run(async () => {
      const res = await setMatchResult(match.id, input, reason.trim());
      if (!res.ok) {
        setError(translateAdminError(res.error, ERROR_MAP, isHebrew));
        return;
      }
      setSuccess(
        isHebrew
          ? `התוצאה נשמרה. ${res.scored1x2} ניחושי תוצאה, ${res.scoredAdvance} "מי עולה", ${res.scoredLive} לייבים נוקדו.`
          : `Result saved. Graded ${res.scored1x2} score picks, ${res.scoredAdvance} advance picks, ${res.scoredLive} live bets.`,
      );
      setReason("");
      router.refresh();
    });
  };

  return (
    <Card className="p-4 md:p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Flag code={match.homeCode} size={22} />
          <span className="font-bold text-sm truncate">{match.homeName}</span>
          <span className="text-on-surface-variant text-xs">vs</span>
          <span className="font-bold text-sm truncate">{match.awayName}</span>
          <Flag code={match.awayCode} size={22} />
        </div>
        <Chip className="shrink-0">
          {stageLabel(match.stage, null, isHebrew ? "he" : "en")}
        </Chip>
      </div>

      <div className="flex items-center justify-between gap-2 text-xs text-on-surface-variant flex-wrap">
        <span className="inline-flex items-center gap-1">
          <PencilLine className="h-3.5 w-3.5" strokeWidth={1.75} />
          {isCorrection
            ? isHebrew
              ? "תיקון תוצאה"
              : "Correct result"
            : isHebrew
              ? "הזנת תוצאה ידנית"
              : "Manual result entry"}
        </span>
        <span className="tabular-nums inline-flex items-center gap-1.5">
          {match.kickoffLabel} · {match.guessCount} {isHebrew ? "ניחושים" : "picks"}
          {match.manualResult && (
            <Chip className="shrink-0">{isHebrew ? "ידני" : "manual"}</Chip>
          )}
        </span>
      </div>

      {/* 90-minute score (for a group match this IS the result) */}
      <ScoreRow
        label={
          isKnockout
            ? isHebrew
              ? "תוצאה אחרי 90 דקות"
              : "Score after 90'"
            : isHebrew
              ? "תוצאה"
              : "Result"
        }
        homeName={match.homeName}
        awayName={match.awayName}
        home={regHome}
        away={regAway}
        onHome={setRegHome}
        onAway={setRegAway}
      />

      {isKnockout && (
        <>
          <ScoreRow
            label={isHebrew ? "תוצאה סופית (כולל הארכה)" : "Final score (incl. extra time)"}
            homeName={match.homeName}
            awayName={match.awayName}
            home={finalHome}
            away={finalAway}
            onHome={setFinalHome}
            onAway={setFinalAway}
          />

          {showPenalties && (
            <div className="flex flex-col gap-2 rounded-lg border border-outline-variant p-3 bg-surface-container-lowest">
              <p className="text-xs text-on-surface-variant">
                {isHebrew
                  ? "תיקו אחרי הארכה — הזן את תוצאת הפנדלים כדי לקבוע מי עולה."
                  : "Level after extra time — enter the shootout score to decide who advances."}
              </p>
              <ScoreRow
                label={isHebrew ? "פנדלים" : "Penalties"}
                homeName={match.homeName}
                awayName={match.awayName}
                home={penHome}
                away={penAway}
                onHome={setPenHome}
                onAway={setPenAway}
              />
            </div>
          )}
        </>
      )}

      {/* Derived "who advances" (knockout only), for transparency */}
      {isKnockout && (
        <div className="flex items-center gap-2 text-sm">
          <Trophy className="h-4 w-4 text-primary" strokeWidth={1.75} />
          <span className="text-on-surface-variant">
            {isHebrew ? "עולה:" : "Advances:"}
          </span>
          {winnerName ? (
            <span className="inline-flex items-center gap-1.5 font-bold">
              <Flag code={winner!} size={18} />
              {winnerName}
            </span>
          ) : (
            <span className="text-on-surface-variant">
              {isHebrew ? "עדיין לא הוכרע" : "not decided yet"}
            </span>
          )}
        </div>
      )}

      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={
          isHebrew ? "סיבה (למשל: ה-API מתעכב)" : "Reason (e.g. API is delayed)"
        }
        dir={isHebrew ? "rtl" : "ltr"}
        className="min-h-[48px] w-full px-3 rounded border border-outline bg-surface-container-lowest text-base"
      />

      {error && (
        <p className="text-sm text-error inline-flex items-center gap-1.5">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </p>
      )}
      {success && (
        <p className="text-sm text-on-success-container inline-flex items-center gap-1.5">
          <Check className="h-4 w-4 shrink-0" />
          {success}
        </p>
      )}

      <PillButton onClick={onSave} disabled={pending} className="self-start">
        {pending
          ? isHebrew
            ? "שומר…"
            : "Saving…"
          : isHebrew
            ? "שמירה ודירוג"
            : "Save & grade"}
      </PillButton>
    </Card>
  );
}

// One home:away score input pair. inputMode numeric + 48px height + 16px font
// keeps mobile keyboards numeric and avoids iOS zoom-on-focus.
function ScoreRow({
  label,
  homeName,
  awayName,
  home,
  away,
  onHome,
  onAway,
}: {
  label: string;
  homeName: string;
  awayName: string;
  home: string;
  away: string;
  onHome: (v: string) => void;
  onAway: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <LabelCaps>{label}</LabelCaps>
      <div className="flex items-end gap-3">
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-xs text-on-surface-variant truncate">{homeName}</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={99}
            value={home}
            onChange={(e) => onHome(e.target.value)}
            className="w-20 min-h-[48px] px-3 rounded border border-outline bg-surface-container-lowest text-base text-center"
          />
        </div>
        <span className="pb-3 text-on-surface-variant">:</span>
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-xs text-on-surface-variant truncate">{awayName}</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={99}
            value={away}
            onChange={(e) => onAway(e.target.value)}
            className="w-20 min-h-[48px] px-3 rounded border border-outline bg-surface-container-lowest text-base text-center"
          />
        </div>
      </div>
    </div>
  );
}

// "" for a null score so the input starts empty, else the number as text.
function numStr(n: number | null): string {
  return n === null || n === undefined ? "" : String(n);
}

// Parse a score input to an integer, or null when blank / not a valid number.
function toInt(s: string): number | null {
  if (s.trim() === "") return null;
  const n = Number(s);
  return Number.isInteger(n) ? n : null;
}
