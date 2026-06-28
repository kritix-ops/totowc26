"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, Trophy } from "lucide-react";
import { Card, Chip, PillButton } from "@/components/ui";
import { Flag } from "@/components/Flag";
import { usePendingAction } from "@/lib/use-pending-action";
import {
  COMMON_ADMIN_ERRORS,
  translateAdminError,
  type LocalizedTuple,
} from "@/lib/admin/errors";
import type { Locale } from "../../dictionaries";
import { stageLabel } from "@/lib/stage-label";
import { setAdvancingTeam } from "./actions";

const ERROR_MAP: Record<string, LocalizedTuple> = {
  ...COMMON_ADMIN_ERRORS,
  match_not_found: ["המשחק לא נמצא", "Match not found"],
  invalid_status: ["פעולה לא תקפה למשחק הזה", "Action not valid for this match"],
  invalid_reason: ["צריך לכתוב סיבה (לפחות 3 תווים)", "A reason (3+ chars) is required"],
  invalid_resolution: ["הקבוצה שנבחרה לא משחקת במשחק הזה", "The selected team is not in this match"],
};

export type AdvanceMatchRow = {
  id: string;
  homeName: string;
  awayName: string;
  homeCode: string;
  awayCode: string;
  stage: string;
  kickoffLabel: string;
  advancingTeam: string | null;
  advancePickCount: number;
};

// Final knockout match: shows who the grader recorded as advancing and lets a
// full admin correct it. Saving resets that match's "who advances?" picks and
// re-grades them against the chosen team (manual override wins). team = null
// clears the result back to undecided. See setAdvancingTeam in ./actions.
export function AdvanceTeamCard({
  locale,
  match,
}: {
  locale: Locale;
  match: AdvanceMatchRow;
}) {
  const isHebrew = locale === "he";
  const router = useRouter();
  const { pending, run } = usePendingAction();

  const [team, setTeam] = useState<string | null>(match.advancingTeam);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const options: { code: string | null; label: string }[] = [
    { code: match.homeCode, label: match.homeName },
    { code: match.awayCode, label: match.awayName },
    { code: null, label: isHebrew ? "לא הוכרע" : "Undecided" },
  ];

  const onSave = () => {
    setError(null);
    setSuccess(null);
    if (reason.trim().length < 3) {
      setError(isHebrew ? "צריך לכתוב סיבה (לפחות 3 תווים)." : "A reason (3+ chars) is required.");
      return;
    }
    void run(async () => {
      const res = await setAdvancingTeam(match.id, team, reason.trim());
      if (!res.ok) {
        setError(translateAdminError(res.error, ERROR_MAP, isHebrew));
        return;
      }
      setSuccess(
        isHebrew
          ? `עודכן. ${res.regraded} ניחושים נוקדו מחדש.`
          : `Updated. ${res.regraded} picks re-graded.`,
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

      <div className="flex items-center justify-between gap-2 text-xs text-on-surface-variant">
        <span className="inline-flex items-center gap-1">
          <Trophy className="h-3.5 w-3.5" strokeWidth={1.75} />
          {isHebrew ? "מי עולה" : "Who advances"}
        </span>
        <span className="tabular-nums">
          {match.kickoffLabel} · {match.advancePickCount}{" "}
          {isHebrew ? "ניחושים" : "picks"}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {options.map((o) => {
          const selected = team === o.code;
          return (
            <button
              key={o.code ?? "none"}
              type="button"
              onClick={() => setTeam(o.code)}
              aria-pressed={selected}
              className={[
                "press-down min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs font-bold transition-colors min-w-0",
                selected
                  ? "bg-primary text-on-primary border-primary"
                  : "bg-surface-container-lowest text-on-surface border-outline",
              ].join(" ")}
            >
              {o.code && <Flag code={o.code} size={18} />}
              <span className="truncate">{o.label}</span>
            </button>
          );
        })}
      </div>

      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={isHebrew ? "סיבה לתיקון (חובה)" : "Reason for the correction (required)"}
        className="min-h-[48px] w-full px-3 rounded border border-outline bg-surface-container-lowest text-base"
      />

      {error && (
        <p className="text-sm text-error inline-flex items-center gap-1.5">
          <AlertCircle className="h-4 w-4" />
          {error}
        </p>
      )}
      {success && (
        <p className="text-sm text-on-success-container inline-flex items-center gap-1.5">
          <Check className="h-4 w-4" />
          {success}
        </p>
      )}

      <PillButton onClick={onSave} disabled={pending} className="self-start">
        {pending
          ? isHebrew
            ? "שומר…"
            : "Saving…"
          : isHebrew
            ? "שמירה ודירוג מחדש"
            : "Save & re-grade"}
      </PillButton>
    </Card>
  );
}
