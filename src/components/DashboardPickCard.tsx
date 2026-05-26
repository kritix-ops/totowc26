"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CalendarClock, Check, Minus, Plus } from "lucide-react";
import { clsx } from "clsx";
import { Card, Chip, LabelCaps } from "@/components/ui";
import { Flag } from "@/components/Flag";
import type { Locale } from "@/app/[lang]/dictionaries";
import { saveBet, type SaveBetResult } from "@/app/[lang]/bets/[matchId]/actions";

// Vertical pick card for the dashboard "Your upcoming matches" section.
// Behaves like a single QuickPickRow but laid out top to bottom so it
// fits the dashboard grid. Same inline save flow: the user does not
// have to leave the home screen to fill match predictions.

export type DashboardPickCardData = {
  id: string;
  homeCode: string;
  homeNameHe: string;
  homeNameEn: string;
  awayCode: string;
  awayNameHe: string;
  awayNameEn: string;
  kickoffAt: string;
  status: "scheduled" | "live" | "final";
  myHome: number | null;
  myAway: number | null;
};

export function DashboardPickCard({
  locale,
  match,
  countdownLabel,
  canEdit,
  lockMinutes,
}: {
  locale: Locale;
  match: DashboardPickCardData;
  countdownLabel: string;
  canEdit: boolean;
  lockMinutes: number;
}) {
  const router = useRouter();
  const isHebrew = locale === "he";
  const hadPick = match.myHome !== null && match.myAway !== null;

  const [home, setHome] = useState<number>(match.myHome ?? 0);
  const [away, setAway] = useState<number>(match.myAway ?? 0);
  const [saved, setSaved] = useState<boolean>(hadPick);
  const [dirty, setDirty] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!saved || dirty) return;
    const t = setTimeout(() => setSaved(false), 2500);
    return () => clearTimeout(t);
  }, [saved, dirty]);

  // Read the clock in an effect so the locked state updates without a
  // page refresh as kickoff approaches.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);
  const locked =
    match.status !== "scheduled" ||
    (now !== null &&
      new Date(match.kickoffAt).getTime() - lockMinutes * 60_000 <= now);
  const disabled = !canEdit || locked;

  const homeName = isHebrew ? match.homeNameHe : match.homeNameEn;
  const awayName = isHebrew ? match.awayNameHe : match.awayNameEn;

  const bump = (side: "home" | "away", delta: 1 | -1) => {
    if (disabled) return;
    setDirty(true);
    setSaved(false);
    if (side === "home") setHome((v) => Math.max(0, Math.min(99, v + delta)));
    else setAway((v) => Math.max(0, Math.min(99, v + delta)));
  };

  const submit = () => {
    if (disabled || pending || !dirty) return;
    setError(null);
    startTransition(async () => {
      const res: SaveBetResult = await saveBet(match.id, home, away);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSaved(true);
      setDirty(false);
      router.refresh();
    });
  };

  return (
    <Card className="p-5 md:p-6 flex flex-col gap-4 min-h-[200px]">
      <div className="flex items-center justify-between gap-2">
        <Chip tone={hadPick && !dirty ? "secondary" : "default"}>
          <CalendarClock className="h-3.5 w-3.5" strokeWidth={1.75} />
          <span className="text-xs font-bold">{countdownLabel}</span>
        </Chip>
        {saved && !dirty && hadPick && (
          <LabelCaps className="text-secondary inline-flex items-center gap-1">
            <Check className="h-3 w-3" strokeWidth={2.5} />
            {isHebrew ? "נשמר" : "Saved"}
          </LabelCaps>
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col items-center gap-1 flex-1 min-w-0">
          <Flag code={match.homeCode} size={36} />
          <span className="text-xs font-bold text-on-surface text-center truncate max-w-full">
            {homeName}
          </span>
          <Stepper
            value={home}
            onBump={(d) => bump("home", d)}
            disabled={disabled}
            ariaLabel={isHebrew ? "שערי בית" : "Home score"}
          />
        </div>
        <span className="font-[family-name:var(--font-display)] text-base text-on-surface-variant px-1 shrink-0">
          VS
        </span>
        <div className="flex flex-col items-center gap-1 flex-1 min-w-0">
          <Flag code={match.awayCode} size={36} />
          <span className="text-xs font-bold text-on-surface text-center truncate max-w-full">
            {awayName}
          </span>
          <Stepper
            value={away}
            onBump={(d) => bump("away", d)}
            disabled={disabled}
            ariaLabel={isHebrew ? "שערי חוץ" : "Away score"}
          />
        </div>
      </div>

      <div className="mt-auto pt-3 border-t border-outline-variant flex flex-col gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={disabled || pending || !dirty}
          className={clsx(
            "press-down min-h-[44px] px-4 inline-flex items-center justify-center gap-1.5 rounded-full text-sm font-bold",
            saved && !dirty
              ? "bg-secondary-container text-on-secondary-container border border-secondary-fixed"
              : dirty
                ? "bg-primary text-on-primary"
                : "bg-surface-container-low text-on-surface-variant border border-outline-variant",
            (disabled || pending || !dirty) && "cursor-not-allowed",
          )}
        >
          {pending ? (
            isHebrew ? "שומר..." : "Saving..."
          ) : saved && !dirty ? (
            <>
              <Check className="h-4 w-4" strokeWidth={2.5} />
              {isHebrew ? "נשמר" : "Saved"}
            </>
          ) : disabled ? (
            isHebrew ? "ננעל" : "Locked"
          ) : (
            <span>{isHebrew ? "שמור הימור" : "Save bet"}</span>
          )}
        </button>
        {error && (
          <span className="inline-flex items-center gap-1 text-[11px] text-error self-center">
            <AlertCircle className="h-3 w-3" strokeWidth={2} />
            {translateError(error, isHebrew)}
          </span>
        )}
      </div>
    </Card>
  );
}

function Stepper({
  value,
  onBump,
  disabled,
  ariaLabel,
}: {
  value: number;
  onBump: (delta: 1 | -1) => void;
  disabled: boolean;
  ariaLabel: string;
}) {
  return (
    <div className="inline-flex items-center gap-0.5 bg-surface-container-lowest border border-outline rounded-md px-1 mt-1">
      <button
        type="button"
        onClick={() => onBump(-1)}
        disabled={disabled}
        aria-label={`${ariaLabel} -`}
        className="h-9 w-7 inline-flex items-center justify-center text-on-surface hover:text-primary disabled:opacity-50"
      >
        <Minus className="h-3.5 w-3.5" strokeWidth={2.5} />
      </button>
      <span className="font-[family-name:var(--font-score)] text-base font-bold w-6 text-center tabular-nums">
        {value}
      </span>
      <button
        type="button"
        onClick={() => onBump(1)}
        disabled={disabled}
        aria-label={`${ariaLabel} +`}
        className="h-9 w-7 inline-flex items-center justify-center text-on-surface hover:text-primary disabled:opacity-50"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
      </button>
    </div>
  );
}

function translateError(code: string, isHebrew: boolean): string {
  const map: Record<string, [string, string]> = {
    unauth: ["יש להתחבר", "Sign in required"],
    not_paid: [
      "התשלום שלך לא אושר עדיין",
      "Your entry payment is not approved yet",
    ],
    locked: ["המשחק נעול", "Match is locked"],
    invalid: ["ערכים לא תקינים", "Invalid values"],
    not_found: ["המשחק לא נמצא", "Match not found"],
    db: ["שגיאת שמירה", "Save failed"],
  };
  return (map[code] ?? map.db)[isHebrew ? 0 : 1];
}
