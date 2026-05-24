"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Stamp,
  Clock,
  AlertCircle,
  Plus,
  Minus,
  ChevronDown,
  Sparkles,
} from "lucide-react";
import { clsx } from "clsx";
import { PillButton, LabelCaps } from "@/components/ui";
import { Flag } from "@/components/Flag";
import type { Dictionary, Locale } from "../../dictionaries";
import { saveBet, type SaveBetResult } from "./actions";

type Pick = "1" | "X" | "2" | null;

export type InitialBet = {
  home: number;
  away: number;
  btts: boolean | null;
  over25: boolean | null;
  htHome: number | null;
  htAway: number | null;
} | null;

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
  const router = useRouter();
  const [home, setHome] = useState(initialBet?.home ?? 0);
  const [away, setAway] = useState(initialBet?.away ?? 0);
  const [btts, setBtts] = useState<boolean | null>(initialBet?.btts ?? null);
  const [over25, setOver25] = useState<boolean | null>(initialBet?.over25 ?? null);
  const [htHome, setHtHome] = useState<number | null>(initialBet?.htHome ?? null);
  const [htAway, setHtAway] = useState<number | null>(initialBet?.htAway ?? null);
  // Advanced section starts open if the user has any extra picks saved.
  const [advancedOpen, setAdvancedOpen] = useState(
    initialBet?.btts !== null ||
      initialBet?.over25 !== null ||
      initialBet?.htHome !== null,
  );

  const [error, setError] = useState<
    Exclude<SaveBetResult, { ok: true }>["error"] | null
  >(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const pick: Pick = home === away ? "X" : home > away ? "1" : "2";
  const clamp = (n: number) => Math.max(0, Math.min(99, n));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await saveBet(match.id, home, away, {
        btts,
        over25,
        htHome,
        htAway,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSaved(true);
      router.refresh();
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
              { p: "1" as Pick, label: dict.matchBet.homeWin },
              { p: "X" as Pick, label: dict.matchBet.draw },
              { p: "2" as Pick, label: dict.matchBet.awayWin },
            ]).map(({ p, label }) => {
              const selected = pick === p;
              return (
                <div
                  key={p}
                  className={clsx(
                    "min-h-[48px] w-full py-3 px-5 rounded-full border text-base flex justify-between items-center",
                    selected
                      ? "border-2 border-primary bg-primary-container text-on-primary-container font-bold shadow-sm"
                      : "border-outline bg-surface-container-lowest text-on-surface-variant",
                  )}
                >
                  <span>{label}</span>
                  <span className="font-[family-name:var(--font-label)] text-sm tracking-[0.05em]">
                    {p}
                  </span>
                </div>
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

      <div className="md:col-span-12">
        <AdvancedSection
          isHebrew={isHebrew}
          open={advancedOpen}
          onToggle={() => setAdvancedOpen((v) => !v)}
          btts={btts}
          setBtts={setBtts}
          over25={over25}
          setOver25={setOver25}
          htHome={htHome}
          htAway={htAway}
          setHtHome={setHtHome}
          setHtAway={setHtAway}
          disabled={!editable || pending}
        />
      </div>

      <div className="md:col-span-12 flex flex-col gap-3 items-stretch md:items-end">
        {error && (
          <p className="inline-flex items-center gap-2 text-sm text-error self-start md:self-end">
            <AlertCircle className="h-4 w-4" strokeWidth={2} />
            {translate(error, isHebrew)}
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
  // A scoreboard digit with ± buttons. Mobile-friendly (no tiny number arrows)
  // and keyboard-accessible (the input still accepts typed numbers).
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

function AdvancedSection({
  isHebrew,
  open,
  onToggle,
  btts,
  setBtts,
  over25,
  setOver25,
  htHome,
  htAway,
  setHtHome,
  setHtAway,
  disabled,
}: {
  isHebrew: boolean;
  open: boolean;
  onToggle: () => void;
  btts: boolean | null;
  setBtts: (v: boolean | null) => void;
  over25: boolean | null;
  setOver25: (v: boolean | null) => void;
  htHome: number | null;
  htAway: number | null;
  setHtHome: (n: number | null) => void;
  setHtAway: (n: number | null) => void;
  disabled?: boolean;
}) {
  const placedCount = [btts !== null, over25 !== null, htHome !== null && htAway !== null]
    .filter(Boolean).length;
  return (
    <div className="bg-[#FBF6EB] border border-outline rounded-xl shadow-[0_8px_24px_rgba(28,20,15,0.08)] overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-5 md:px-6 py-4 flex items-center justify-between gap-3 hover:bg-surface-container-low transition-colors"
        aria-expanded={open}
      >
        <span className="inline-flex items-center gap-2.5">
          <Sparkles className="h-5 w-5 text-tertiary-fixed-dim" strokeWidth={1.75} />
          <span className="font-[family-name:var(--font-display)] text-lg md:text-xl font-bold">
            {isHebrew ? "ניחושים נוספים" : "Extra bets"}
          </span>
          {placedCount > 0 && (
            <span className="font-[family-name:var(--font-label)] text-xs font-bold bg-primary-fixed text-on-primary-fixed-variant px-2 py-0.5 rounded-full">
              <span className="bidi-ltr">{placedCount}</span>
            </span>
          )}
        </span>
        <ChevronDown
          className={clsx("h-5 w-5 transition-transform", open && "rotate-180")}
          strokeWidth={2}
        />
      </button>

      {open && (
        <div className="border-t border-outline-variant p-5 md:p-6 flex flex-col gap-6 md:gap-8">
          <YesNoRow
            title={isHebrew ? "שתי הקבוצות יבקיעו?" : "Both teams to score?"}
            subtitle={isHebrew ? "+2 נק'" : "+2 pts"}
            value={btts}
            onChange={setBtts}
            yes={isHebrew ? "כן" : "Yes"}
            no={isHebrew ? "לא" : "No"}
            disabled={disabled}
          />
          <YesNoRow
            title={isHebrew ? "סך השערים מעל 2.5?" : "Total goals over 2.5?"}
            subtitle={isHebrew ? "+2 נק'" : "+2 pts"}
            value={over25}
            onChange={setOver25}
            yes={isHebrew ? "מעל 2.5" : "Over 2.5"}
            no={isHebrew ? "מתחת 2.5" : "Under 2.5"}
            disabled={disabled}
          />
          <div className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-[family-name:var(--font-display)] text-base md:text-lg font-bold">
                {isHebrew ? "תוצאת מחצית" : "Halftime score"}
              </span>
              <LabelCaps>
                {isHebrew ? "מדויק +5, כיוון +2" : "Exact +5, outcome +2"}
              </LabelCaps>
            </div>
            <div className="flex items-center justify-center gap-3">
              <HtStepper
                value={htHome}
                onChange={setHtHome}
                disabled={disabled}
                isHebrew={isHebrew}
                ariaLabel={isHebrew ? "בית מחצית" : "Home halftime"}
              />
              <span className="text-2xl text-on-surface-variant">:</span>
              <HtStepper
                value={htAway}
                onChange={setHtAway}
                disabled={disabled}
                isHebrew={isHebrew}
                ariaLabel={isHebrew ? "חוץ מחצית" : "Away halftime"}
              />
            </div>
            {(htHome !== null || htAway !== null) && (
              <button
                type="button"
                onClick={() => {
                  setHtHome(null);
                  setHtAway(null);
                }}
                disabled={disabled}
                className="self-center text-xs text-on-surface-variant hover:text-error"
              >
                {isHebrew ? "נקה ניחוש מחצית" : "Clear halftime pick"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function YesNoRow({
  title,
  subtitle,
  value,
  onChange,
  yes,
  no,
  disabled,
}: {
  title: string;
  subtitle: string;
  value: boolean | null;
  onChange: (v: boolean | null) => void;
  yes: string;
  no: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-[family-name:var(--font-display)] text-base md:text-lg font-bold">
          {title}
        </span>
        <LabelCaps>{subtitle}</LabelCaps>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <ChoicePill
          active={value === true}
          onClick={() => onChange(value === true ? null : true)}
          disabled={disabled}
        >
          {yes}
        </ChoicePill>
        <ChoicePill
          active={value === false}
          onClick={() => onChange(value === false ? null : false)}
          disabled={disabled}
        >
          {no}
        </ChoicePill>
      </div>
    </div>
  );
}

function ChoicePill({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        "press-down min-h-[48px] py-3 px-4 rounded-full border text-base font-bold transition-colors",
        active
          ? "border-2 border-primary bg-primary-container text-on-primary-container shadow-sm"
          : "border-outline bg-surface-container-lowest text-on-surface hover:bg-surface-container",
        disabled && "opacity-60 cursor-not-allowed",
      )}
    >
      {children}
    </button>
  );
}

function HtStepper({
  value,
  onChange,
  disabled,
  isHebrew,
  ariaLabel,
}: {
  value: number | null;
  onChange: (n: number | null) => void;
  disabled?: boolean;
  isHebrew: boolean;
  ariaLabel: string;
}) {
  const n = value ?? 0;
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        aria-label={isHebrew ? "פחות" : "Less"}
        onClick={() => onChange(Math.max(0, n - 1))}
        disabled={disabled || n === 0}
        className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-full bg-surface-container-lowest border border-outline-variant text-on-surface hover:bg-surface-container disabled:opacity-40"
      >
        <Minus className="h-4 w-4" strokeWidth={2.5} />
      </button>
      <input
        type="number"
        min={0}
        max={99}
        value={value ?? ""}
        placeholder="—"
        aria-label={ariaLabel}
        onChange={(e) => {
          const raw = e.target.value.trim();
          if (raw === "") {
            onChange(null);
            return;
          }
          const v = parseInt(raw, 10);
          if (isNaN(v)) onChange(null);
          else onChange(Math.max(0, Math.min(99, v)));
        }}
        disabled={disabled}
        className="w-14 md:w-16 h-14 md:h-16 text-center font-[family-name:var(--font-score)] text-2xl md:text-3xl font-bold bg-[#1C140F] border-2 border-outline rounded text-[#FBF6EB] focus:outline-none placeholder:text-[#FBF6EB]/40 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none disabled:opacity-60"
        dir="ltr"
      />
      <button
        type="button"
        aria-label={isHebrew ? "יותר" : "More"}
        onClick={() => onChange(Math.min(99, n + 1))}
        disabled={disabled || n === 99}
        className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-full bg-surface-container-lowest border border-outline-variant text-on-surface hover:bg-surface-container disabled:opacity-40"
      >
        <Plus className="h-4 w-4" strokeWidth={2.5} />
      </button>
    </div>
  );
}

function translate(
  code: Exclude<SaveBetResult, { ok: true }>["error"],
  isHebrew: boolean,
): string {
  const map: Record<string, [string, string]> = {
    unauth: ["יש להתחבר", "Sign in required"],
    locked: ["ההימור נסגר. לא ניתן לערוך עוד.", "Bet is locked. Cannot edit."],
    invalid: ["תוצאה לא תקינה", "Invalid score"],
    db: ["שגיאת שמירה", "Save failed"],
    not_found: ["המשחק לא נמצא", "Match not found"],
  };
  return map[code][isHebrew ? 0 : 1];
}
