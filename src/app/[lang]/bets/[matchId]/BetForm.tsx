"use client";

import { useState, useTransition } from "react";
import { Check, Stamp, Clock, AlertCircle, Plus, Minus } from "lucide-react";
import { clsx } from "clsx";
import { PillButton } from "@/components/ui";
import { Flag } from "@/components/Flag";
import type { Dictionary, Locale } from "../../dictionaries";
import { saveBet, type SaveBetResult } from "./actions";

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
}) {
  const isHebrew = locale === "he";
  const [home, setHome] = useState(initialBet?.home ?? 0);
  const [away, setAway] = useState(initialBet?.away ?? 0);
  const [error, setError] = useState<
    Exclude<SaveBetResult, { ok: true }>["error"] | null
  >(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

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

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await saveBet(match.id, home, away);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSaved(true);
      // saveBet revalidates this page, the bets list, and the dashboard
      // — Next.js will swap in the new RSC payload automatically.
      // A separate router.refresh() would just extend the transition's
      // pending state and keep "שומר…" visible an extra round trip.
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

        <div className="bg-[#FBF6EB] border border-outline rounded-xl p-5 md:p-6 shadow-[0_8px_24px_rgba(28,20,15,0.08)] flex flex-col gap-3">
          <p className="inline-flex items-center gap-3 text-base text-on-surface-variant">
            <Stamp className="h-5 w-5 text-outline shrink-0" strokeWidth={1.5} />
            {match.homeCode} {isHebrew ? "מארח" : "host"} {match.awayCode}
          </p>
          <p className="inline-flex items-center gap-3 text-base text-on-surface-variant border-t border-outline-variant pt-3">
            <Clock className="h-5 w-5 text-outline shrink-0" strokeWidth={1.5} />
            {isHebrew ? "סגירת הימור 5 דק' לפני שריקה" : "Bet locks 5 min before kickoff"}
          </p>
        </div>
      </aside>

      <div className="md:col-span-12 flex flex-col gap-3 items-stretch md:items-end">
        {error && (
          <p className="inline-flex items-center gap-2 text-sm text-error self-start md:self-end">
            <AlertCircle className="h-4 w-4" strokeWidth={2} />
            {translate(error, dict)}
          </p>
        )}
        {saved && !error && (
          <p className="inline-flex items-center gap-2 text-sm text-secondary self-start md:self-end">
            <Check className="h-4 w-4" strokeWidth={2.5} />
            {isHebrew ? "ההימור נשמר" : "Bet saved"}
          </p>
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
          {pending
            ? isHebrew ? "שומר..." : "Saving..."
            : dict.matchBet.saveBet}
        </PillButton>
      </div>
    </form>
  );
}

function ScoreStepper({
  value,
  onChange,
  disabled,
  isHebrew,
}: {
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
  isHebrew: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        aria-label={isHebrew ? "פחות" : "Less"}
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
          className="w-14 md:w-20 h-16 md:h-24 bg-transparent text-center font-[family-name:var(--font-score)] text-[28px] md:text-[40px] leading-none tracking-[0.1em] font-bold text-[#FBF6EB] focus:outline-none border-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none disabled:opacity-60"
          dir="ltr"
        />
      </div>
      <button
        type="button"
        aria-label={isHebrew ? "יותר" : "More"}
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
  code: Exclude<SaveBetResult, { ok: true }>["error"],
  dict: Dictionary,
): string {
  const map = dict.errors.matchBet as Record<string, string>;
  return map[code] ?? map.fallback;
}

