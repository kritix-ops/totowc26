"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, AlertCircle, Minus, Plus } from "lucide-react";
import { clsx } from "clsx";
import { Card } from "@/components/ui";
import { Flag } from "@/components/Flag";
import type { Locale } from "../dictionaries";
import { formatDateTime } from "@/lib/format";
import { saveBet, type SaveBetResult } from "./[matchId]/actions";

// One match row on the quick-fill /bets page. Self-contained: pre-fills
// from the existing pick if any, runs the same saveBet server action
// the per-match form uses, and shows inline feedback (saving / saved /
// error) without leaving the page.
//
// The row stays editable until 5 min before kickoff (or whatever
// bet_lock_minutes is). Past that we render a disabled state with the
// last-saved score; the saveBet action would reject anyway.

export type QuickPickRowData = {
  id: string;
  homeCode: string;
  homeNameHe: string;
  homeNameEn: string;
  awayCode: string;
  awayNameHe: string;
  awayNameEn: string;
  kickoffAt: string;
  stage: string;
  matchDate: string;
  myHomeScore: number | null;
  myAwayScore: number | null;
};

export function QuickPickRow({
  locale,
  match,
  lockMinutes,
  canEdit,
}: {
  locale: Locale;
  match: QuickPickRowData;
  lockMinutes: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const isHebrew = locale === "he";
  const hadPick = match.myHomeScore !== null && match.myAwayScore !== null;

  const [home, setHome] = useState<number>(match.myHomeScore ?? 0);
  const [away, setAway] = useState<number>(match.myAwayScore ?? 0);
  const [saved, setSaved] = useState<boolean>(hadPick);
  const [dirty, setDirty] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Hide the "Saved" affirm after a few seconds so a long list isn't
  // littered with green ticks. Returns to the "Save" CTA so the user
  // can re-save (e.g. they noticed a typo).
  useEffect(() => {
    if (!saved || dirty) return;
    const t = setTimeout(() => setSaved(false), 2500);
    return () => clearTimeout(t);
  }, [saved, dirty]);

  const homeName = isHebrew ? match.homeNameHe : match.homeNameEn;
  const awayName = isHebrew ? match.awayNameHe : match.awayNameEn;

  // Reading the clock during render breaks the pure-render rule and
  // would freeze the locked state to mount time. Read it in an effect
  // and re-check every 30s so the row disables itself as kickoff
  // approaches without a manual refresh.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);
  const locked =
    now !== null &&
    new Date(match.kickoffAt).getTime() - lockMinutes * 60_000 <= now;
  const disabled = !canEdit || locked;

  const onBump = (side: "home" | "away", delta: 1 | -1) => {
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

  const pickDirection: "1" | "X" | "2" =
    home === away ? "X" : home > away ? "1" : "2";

  return (
    <Card
      className={clsx(
        "p-3 md:p-4 flex items-center gap-3 transition-colors",
        disabled && "opacity-70",
      )}
    >
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <Flag code={match.homeCode} size={28} />
        <span className="text-xs md:text-sm font-bold truncate">{homeName}</span>
      </div>

      <div className="flex items-center gap-1 shrink-0 tabular-nums bidi-ltr">
        <Stepper
          value={home}
          onBump={(d) => onBump("home", d)}
          disabled={disabled}
          ariaLabel={isHebrew ? "שערי בית" : "Home score"}
        />
        <span className="font-[family-name:var(--font-score)] text-base md:text-lg font-bold w-6 text-center text-on-surface-variant">
          {pickDirection}
        </span>
        <Stepper
          value={away}
          onBump={(d) => onBump("away", d)}
          disabled={disabled}
          ariaLabel={isHebrew ? "שערי חוץ" : "Away score"}
        />
      </div>

      <div className="flex items-center gap-2 flex-1 min-w-0 justify-end">
        <span className="text-xs md:text-sm font-bold truncate text-end">
          {awayName}
        </span>
        <Flag code={match.awayCode} size={28} />
      </div>

      <div className="flex flex-col items-end gap-1 shrink-0">
        <span className="text-[10px] text-on-surface-variant tabular-nums">
          {formatDateTime(match.kickoffAt, locale, {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
        <button
          type="button"
          onClick={submit}
          disabled={disabled || pending || !dirty}
          className={clsx(
            "press-down min-h-[40px] px-3 inline-flex items-center justify-center gap-1.5 rounded-full text-xs font-bold",
            saved && !dirty
              ? "bg-secondary-container text-on-secondary-container border border-secondary-fixed"
              : dirty
                ? "bg-primary text-on-primary"
                : "bg-surface-container-low text-on-surface-variant border border-outline-variant",
            (disabled || pending || !dirty) && "cursor-not-allowed",
          )}
          aria-label={isHebrew ? "שמור הימור" : "Save bet"}
        >
          {pending ? (
            isHebrew ? "שומר..." : "Saving..."
          ) : saved && !dirty ? (
            <>
              <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
              {isHebrew ? "נשמר" : "Saved"}
            </>
          ) : (
            <span>{isHebrew ? "שמור" : "Save"}</span>
          )}
        </button>
        {error && (
          <span className="inline-flex items-center gap-1 text-[10px] text-error">
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
    <div className="inline-flex items-center gap-0.5 bg-surface-container-lowest border border-outline rounded-md px-1">
      <button
        type="button"
        onClick={() => onBump(-1)}
        disabled={disabled}
        aria-label={`${ariaLabel} −`}
        className="h-9 w-7 inline-flex items-center justify-center text-on-surface hover:text-primary disabled:opacity-50"
      >
        <Minus className="h-3.5 w-3.5" strokeWidth={2.5} />
      </button>
      <span className="font-[family-name:var(--font-score)] text-base md:text-lg font-bold w-5 text-center">
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
