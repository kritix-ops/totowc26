"use client";

import { useState } from "react";
import {
  AlertCircle,
  Check,
  Clock,
  Minus,
  Plus,
  Stamp,
  Trash2,
  X,
} from "lucide-react";
import { clsx } from "clsx";
import { PillButton } from "@/components/ui";
import { Flag } from "@/components/Flag";
import { PickScenarios } from "@/components/PickScenarios";
import type { Dictionary, Locale } from "../../dictionaries";
import { usePendingAction } from "@/lib/use-pending-action";
import { cancelBet } from "./actions";
import type { CancelBetResult, SaveBetResult } from "./actions";

// 1/X/2 score predictor for a single match. The "extra bets" (BTTS / Over
// 2.5 / halftime) used to live here behind an "Advanced" section; those
// concepts moved out into the admin-authored custom-bets system on
// /play/[date], so this form is now just the scoreboard.

type Pick = "1" | "X" | "2" | null;

export type InitialBet = { home: number; away: number } | null;

export function BetForm({
  locale,
  dict,
  match,
  initialBet,
  editable,
  bankBalance,
  scoring,
}: {
  locale: Locale;
  dict: Dictionary;
  match: {
    id: string;
    homeCode: string;
    homeName: string;
    awayCode: string;
    awayName: string;
  };
  initialBet: InitialBet;
  editable: boolean;
  // Bank + scoring knobs come from settings; passed down so the
  // scenarios panel can preview the outcome on the user's bank
  // without an extra round-trip.
  bankBalance: number;
  scoring: {
    exact: number;
    outcome: number;
    stake: number;
    riskEnabled: boolean;
    penalty: number;
  };
}) {
  const isHebrew = locale === "he";
  const [home, setHome] = useState(initialBet?.home ?? 0);
  const [away, setAway] = useState(initialBet?.away ?? 0);
  // `hasPick` mirrors initialBet at render time and flips locally when
  // the user cancels — needed so the cancel button hides itself after a
  // successful clear without waiting for a server-driven prop swap.
  const [hasPick, setHasPick] = useState<boolean>(initialBet !== null);
  const [error, setError] = useState<
    | Exclude<SaveBetResult, { ok: true }>["error"]
    | Exclude<CancelBetResult, { ok: true }>["error"]
    | null
  >(null);
  const [saved, setSaved] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const { pending, run } = usePendingAction();

  const pick: Pick = home === away ? "X" : home > away ? "1" : "2";
  const clamp = (n: number) => Math.max(0, Math.min(99, n));

  // Click on a 1/X/2 pill: if it already matches the current direction we
  // leave the user's exact score untouched (so 3-1 stays 3-1 when they tap
  // "1" again). Direction change snaps to a canonical default score the
  // user can then nudge with the steppers.
  const onPickClick = (p: Exclude<Pick, null>) => {
    if (!editable || pending) return;
    if (pick === p) return;
    if (p === "1") {
      setHome(1);
      setAway(0);
    } else if (p === "X") {
      setHome(1);
      setAway(1);
    } else {
      setHome(0);
      setAway(1);
    }
    console.info("[bet pick click]", { matchId: match.id, pick: p });
  };

  const onCancel = () => {
    if (!editable || pending || !hasPick) return;
    setError(null);
    setSaved(false);
    setCancelled(false);
    void run(async () => {
      const res: CancelBetResult = await cancelBet(match.id).catch((err) => {
        console.error("[match-bet form cancel]", err);
        return { ok: false, error: "db" } as CancelBetResult;
      });
      if (!res.ok) {
        setError(res.error);
        setConfirmingCancel(false);
        return;
      }
      console.info("[bet cancel click]", { matchId: match.id });
      setHasPick(false);
      // Reset the scoreboard to the canonical "no pick yet" 0-0 so the
      // user sees a fresh board to fill again if they want to re-pick
      // before the deadline.
      setHome(0);
      setAway(0);
      setConfirmingCancel(false);
      setCancelled(true);
    });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setCancelled(false);
    // POST through /api/bets/save (parallel via fetch) — same reason
    // as QuickPickRow/DashboardPickCard: Next dispatches Server
    // Functions one at a time per browser tab, which caused queued
    // rapid saves to lose picks on /bets. Single-form saves here are
    // not under that pressure but using the same transport keeps the
    // surface uniform and removes one server-action call site.
    void run(async () => {
      let res: SaveBetResult;
      try {
        const r = await fetch("/api/bets/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ matchId: match.id, home, away }),
        });
        res = (await r.json()) as SaveBetResult;
      } catch (err) {
        console.error("[match-bet form save fetch]", err);
        setError("db");
        return;
      }
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSaved(true);
      setHasPick(true);
    });
  };

  return (
    <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-6">
      <div className="md:col-span-8 relative overflow-hidden bg-[#FBF6EB] border border-outline rounded-xl p-5 md:p-12 shadow-[0_8px_24px_rgba(28,20,15,0.08)] flex flex-col items-center justify-center min-h-[320px] md:min-h-[400px]">
        <div
          aria-hidden
          className="absolute inset-0 opacity-5 pointer-events-none"
          style={{
            backgroundImage: "radial-gradient(#8c716b 1px, transparent 1px)",
            backgroundSize: "20px 20px",
          }}
        />
        <div className="relative z-10 w-full grid grid-cols-[1fr_auto_1fr] items-center gap-3 md:gap-6">
          <div className="flex flex-col items-center gap-3 md:gap-6">
            <Flag code={match.homeCode} size={96} rounded="md" className="md:!w-[128px] md:!h-[128px]" />
            <span className="font-[family-name:var(--font-display)] text-base md:text-2xl leading-tight font-bold text-on-surface text-center">
              {match.homeName}
            </span>
            <ScoreStepper
              value={home}
              onChange={(n) => setHome(clamp(n))}
              disabled={!editable || pending}
              isHebrew={isHebrew}
              ariaLabel={`${match.homeName} ${isHebrew ? "שערים" : "goals"}`}
            />
          </div>
          <div className="flex items-center justify-center">
            <span className="font-[family-name:var(--font-display)] text-3xl md:text-[48px] leading-none font-bold text-outline-variant opacity-60">
              X
            </span>
          </div>
          <div className="flex flex-col items-center gap-3 md:gap-6">
            <Flag code={match.awayCode} size={96} rounded="md" className="md:!w-[128px] md:!h-[128px]" />
            <span className="font-[family-name:var(--font-display)] text-base md:text-2xl leading-tight font-bold text-on-surface text-center">
              {match.awayName}
            </span>
            <ScoreStepper
              value={away}
              onChange={(n) => setAway(clamp(n))}
              disabled={!editable || pending}
              isHebrew={isHebrew}
              ariaLabel={`${match.awayName} ${isHebrew ? "שערים" : "goals"}`}
            />
          </div>
        </div>
      </div>

      <aside className="md:col-span-4 flex flex-col gap-4 md:gap-6">
        <div className="bg-[#FBF6EB] border border-outline rounded-xl p-5 md:p-6 shadow-[0_8px_24px_rgba(28,20,15,0.08)] flex flex-col gap-4 flex-grow">
          <h3 className="font-[family-name:var(--font-display)] text-xl md:text-2xl leading-tight font-bold text-on-surface text-center">
            {dict.matchBet.title}
          </h3>
          <div className="flex flex-col gap-3">
            {([
              { p: "1" as const, label: dict.matchBet.homeWin },
              { p: "X" as const, label: dict.matchBet.draw },
              { p: "2" as const, label: dict.matchBet.awayWin },
            ]).map(({ p, label }) => {
              const selected = pick === p;
              const disabled = !editable || pending;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => onPickClick(p)}
                  disabled={disabled}
                  aria-pressed={selected}
                  className={clsx(
                    "press-down min-h-[48px] w-full py-3 px-5 rounded-full border text-base flex justify-between items-center transition-colors",
                    selected
                      ? "border-2 border-primary bg-primary-container text-on-primary-container font-bold shadow-sm"
                      : "border-outline bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container",
                    disabled && "opacity-60 cursor-not-allowed",
                  )}
                >
                  <span>{label}</span>
                  <span className="font-[family-name:var(--font-label)] text-sm tracking-[0.05em]">
                    {p}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="text-sm text-on-surface-variant text-center">
            {dict.matchBet.scoring}
          </p>
        </div>

        <PickScenarios
          locale={locale}
          currentBalance={bankBalance}
          stake={scoring.stake}
          scenarios={[
            {
              label: isHebrew ? "פגיעה מדויקת" : "Exact score",
              delta: scoring.exact,
              tone: "positive",
            },
            {
              label: isHebrew ? "כיוון נכון" : "Direction",
              delta: scoring.outcome,
              tone: "positive",
            },
            {
              label: isHebrew ? "טעות" : "Wrong",
              delta: scoring.riskEnabled ? -scoring.penalty : 0,
              tone: scoring.riskEnabled ? "negative" : "neutral",
            },
          ]}
        />

        <div className="bg-[#FBF6EB] border border-outline rounded-xl p-5 md:p-6 shadow-[0_8px_24px_rgba(28,20,15,0.08)] flex flex-col gap-3">
          <p className="inline-flex items-center gap-3 text-base text-on-surface-variant">
            <Stamp className="h-5 w-5 text-outline shrink-0" strokeWidth={1.5} />
            {match.homeCode} {isHebrew ? "מארח" : "host"} {match.awayCode}
          </p>
          <p className="inline-flex items-center gap-3 text-base text-on-surface-variant border-t border-outline-variant pt-3">
            <Clock className="h-5 w-5 text-outline shrink-0" strokeWidth={1.5} />
            {isHebrew ? "סגירת הימור 5 דק' לפני שריקה" : "Bet locks 5 min before kickoff"}
          </p>
          {/* Discoverability hint: tell the user the save is reversible
              until the deadline. The cancel button itself only appears
              when there is a pick to remove (you can't cancel an empty
              form), so without this line the save-first decision looks
              final. */}
          {editable && (
            <p className="text-sm text-on-surface-variant/80 -mt-1">
              {isHebrew
                ? "ניתן לשנות או לבטל את הניחוש עד הסגירה"
                : "You can change or cancel your pick until close"}
            </p>
          )}
        </div>
      </aside>

      <div className="md:col-span-12 flex flex-col gap-3 items-stretch md:items-end">
        {error && (
          <p className="inline-flex items-center gap-2 text-sm text-error self-start md:self-end">
            <AlertCircle className="h-4 w-4" strokeWidth={2} />
            {translate(error, dict, isHebrew)}
          </p>
        )}
        {saved && !error && (
          <p className="inline-flex items-center gap-2 text-sm text-secondary self-start md:self-end">
            <Check className="h-4 w-4" strokeWidth={2.5} />
            {isHebrew ? "ההימור נשמר" : "Bet saved"}
          </p>
        )}
        {cancelled && !error && (
          <p className="inline-flex items-center gap-2 text-sm text-secondary self-start md:self-end">
            <Check className="h-4 w-4" strokeWidth={2.5} />
            {isHebrew ? "ההימור בוטל" : "Bet cancelled"}
          </p>
        )}
        <div className="flex flex-col-reverse md:flex-row md:items-center md:justify-end gap-3">
          {/* Cancel pick — visible only when a pick is currently saved
              and the bet is still editable. Two-step confirm to keep a
              misclick from destroying the user's prediction. */}
          {hasPick && editable && !confirmingCancel && (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setSaved(false);
                setCancelled(false);
                setConfirmingCancel(true);
              }}
              disabled={pending}
              className={clsx(
                "press-down inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-full text-sm font-bold transition-colors",
                "bg-surface-container-lowest text-error border border-error/40",
                "hover:bg-error-container hover:border-error",
                "disabled:opacity-50 disabled:cursor-not-allowed",
              )}
              aria-label={isHebrew ? "בטל ניחוש" : "Cancel pick"}
            >
              <Trash2 className="h-4 w-4" strokeWidth={2} />
              {isHebrew ? "בטל ניחוש" : "Cancel pick"}
            </button>
          )}
          {hasPick && editable && confirmingCancel && (
            <div
              role="group"
              aria-label={isHebrew ? "אישור ביטול" : "Confirm cancel"}
              className="inline-flex items-center gap-2 rounded-full bg-error-container/40 border border-error/40 ps-3 pe-1 py-1"
            >
              <span className="text-xs font-bold text-error">
                {isHebrew ? "בטוח?" : "Sure?"}
              </span>
              <button
                type="button"
                onClick={onCancel}
                disabled={pending}
                className={clsx(
                  "press-down inline-flex items-center justify-center gap-1 min-h-9 px-3 rounded-full text-xs font-bold transition-colors",
                  "bg-error text-on-error hover:bg-error/90",
                  "disabled:opacity-60 disabled:cursor-not-allowed",
                )}
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                {pending
                  ? isHebrew ? "מבטל…" : "Cancelling…"
                  : isHebrew ? "כן, בטל" : "Yes, cancel"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingCancel(false)}
                disabled={pending}
                className={clsx(
                  "press-down inline-flex items-center justify-center gap-1 min-h-9 px-3 rounded-full text-xs font-bold transition-colors",
                  "bg-surface-container-lowest text-on-surface border border-outline hover:bg-surface-container",
                  "disabled:opacity-60 disabled:cursor-not-allowed",
                )}
              >
                <X className="h-3.5 w-3.5" strokeWidth={2} />
                {isHebrew ? "השאר" : "Keep"}
              </button>
            </div>
          )}
          <PillButton
            type="submit"
            disabled={!editable || pending}
            className={clsx(
              "w-full md:w-auto px-10 md:px-12 py-4 text-base shadow-[0_8px_24px_rgba(28,20,15,0.15)]",
              (!editable || pending) && "opacity-60 cursor-not-allowed",
            )}
          >
            <Check className="h-5 w-5" strokeWidth={2.5} />
            {pending && !confirmingCancel
              ? isHebrew ? "שומר..." : "Saving..."
              : dict.matchBet.saveBet}
          </PillButton>
        </div>
      </div>
    </form>
  );
}

function ScoreStepper({
  value,
  onChange,
  disabled,
  isHebrew,
  ariaLabel,
}: {
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
  isHebrew: boolean;
  ariaLabel: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        aria-label={`${ariaLabel} ${isHebrew ? "פחות" : "less"}`}
        onClick={() => onChange(Math.max(0, value - 1))}
        disabled={disabled || value === 0}
        className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full bg-surface-container-lowest border border-outline text-on-surface hover:bg-surface-container disabled:opacity-40"
      >
        <Minus className="h-5 w-5" strokeWidth={2.5} />
      </button>
      <div className="bg-[#1C140F] border-2 border-outline rounded p-2 shadow-inner">
        <input
          type="number"
          min={0}
          max={99}
          value={value}
          onChange={(e) => {
            const v = parseInt(e.target.value || "0", 10);
            onChange(isNaN(v) ? 0 : v);
          }}
          disabled={disabled}
          aria-label={ariaLabel}
          className="w-14 md:w-20 h-16 md:h-24 bg-transparent text-center font-[family-name:var(--font-score)] text-[28px] md:text-[40px] leading-none tracking-[0.1em] font-bold text-[#FBF6EB] focus:outline-none border-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none disabled:opacity-60"
          dir="ltr"
        />
      </div>
      <button
        type="button"
        aria-label={`${ariaLabel} ${isHebrew ? "יותר" : "more"}`}
        onClick={() => onChange(Math.min(99, value + 1))}
        disabled={disabled || value === 99}
        className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full bg-surface-container-lowest border border-outline text-on-surface hover:bg-surface-container disabled:opacity-40"
      >
        <Plus className="h-5 w-5" strokeWidth={2.5} />
      </button>
    </div>
  );
}

function translate(
  code:
    | Exclude<SaveBetResult, { ok: true }>["error"]
    | Exclude<CancelBetResult, { ok: true }>["error"],
  dict: Dictionary,
  isHebrew: boolean,
): string {
  // Cancel-only outcome: the row vanished between render and click
  // (e.g. another tab already cancelled it). Not part of the dictionary
  // map since the legacy save path can never hit it.
  if (code === "nothing_to_cancel") {
    return isHebrew ? "אין הימור לבטל" : "No bet to cancel";
  }
  const map = dict.errors.matchBet as Record<string, string>;
  return map[code] ?? map.fallback;
}

