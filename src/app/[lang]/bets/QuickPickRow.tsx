"use client";

import { useEffect, useRef, useState } from "react";
import { Check, AlertCircle, Minus, Plus } from "lucide-react";
import { clsx } from "clsx";
import { Card } from "@/components/ui";
import { Flag } from "@/components/Flag";
import type { Dictionary, Locale } from "../dictionaries";
import { formatDateTime } from "@/lib/format";
import { usePendingAction } from "@/lib/use-pending-action";
import type { SaveBetResult } from "./[matchId]/actions";

// One match row on the quick-picks /bets page. Self-contained: pre-
// fills from the existing pick if any, runs the same saveBet server
// action the per-match form uses, and shows inline feedback (saving /
// saved / error) without leaving the page.
//
// Layout is responsive by hand instead of via a single flex row.
// On mobile we stack:
//   1. Header (flags + names + kickoff time)
//   2. Scoreboard (home stepper, direction, away stepper)
//   3. Save button (full width)
// On md+ we collapse back to a single row so the desktop list stays
// dense. The earlier single-row layout was the right call for a wide
// viewport but fell apart at 360px because the flag + steppers + save
// button all competed for the same horizontal budget.

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
  dict,
  match,
  lockMinutes,
  canEdit,
}: {
  locale: Locale;
  dict: Dictionary;
  match: QuickPickRowData;
  lockMinutes: number;
  canEdit: boolean;
}) {
  const isHebrew = locale === "he";
  const hadPick = match.myHomeScore !== null && match.myAwayScore !== null;

  const [home, setHome] = useState<number>(match.myHomeScore ?? 0);
  const [away, setAway] = useState<number>(match.myAwayScore ?? 0);
  const [saved, setSaved] = useState<boolean>(hadPick);
  const [dirty, setDirty] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const { pending, run } = usePendingAction();

  // Holds the home/away the user just successfully saved. Stays set
  // until the next prop refresh arrives carrying those same values —
  // at which point the server has caught up and we can let the normal
  // prop sync run again. Why this exists: the /api/bets/save fetch
  // does not trigger an automatic client refresh the way the old
  // server action did, so when `dirty` flips to false on save the
  // useEffect below would otherwise pull match.myHomeScore (still the
  // pre-save value, often null) and flash the stepper back to 0:0
  // even though the DB now holds the right pick — the 2026-06-04
  // "מחק לי תוצאות 0-0" report.
  const justSavedRef = useRef<{ home: number; away: number } | null>(null);

  // Sync the local stepper state from the server when fresh props arrive
  // (e.g. after the "Surprise me" action + router.refresh()). useState
  // only seeds on first mount, so without this the stepper would still
  // show 0:0 even though the DB now holds 2:1.
  // Guarded by `dirty`: if the user is mid-edit we don't clobber their
  // in-flight input. Also guarded by justSavedRef so a save's own props
  // race can't repaint our own write as 0:0.
  useEffect(() => {
    if (dirty) return;
    if (justSavedRef.current) {
      const j = justSavedRef.current;
      if (match.myHomeScore === j.home && match.myAwayScore === j.away) {
        // Server caught up — drop the guard, fall through to the sync.
        justSavedRef.current = null;
      } else {
        // Stale props (revalidatePath hasn't reached this client yet).
        // Keep showing what the user actually saved.
        return;
      }
    }
    setHome(match.myHomeScore ?? 0);
    setAway(match.myAwayScore ?? 0);
    if (match.myHomeScore !== null && match.myAwayScore !== null) {
      setSaved(true);
    }
  }, [match.myHomeScore, match.myAwayScore, dirty]);

  // No auto-clear: a saved bet stays saved. The earlier 2.5s/6s
  // timeout flipped the button back to "שמור" while the bet was
  // still persistently in the DB, which the QA agent caught and which
  // a user would read as "my save was undone". The button now stays
  // on the "נשמר" state until the user edits the score (onBump sets
  // saved=false + dirty=true, which is the correct transition - they
  // are about to overwrite their pick).

  const homeName = isHebrew ? match.homeNameHe : match.homeNameEn;
  const awayName = isHebrew ? match.awayNameHe : match.awayNameEn;

  // Read the clock in an effect so the locked state re-checks every
  // 30 seconds without forcing the user to refresh. Reading Date.now
  // during render would freeze the value to mount time.
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
    // POST through a Route Handler (parallel via fetch) instead of the
    // saveBet server action — Next dispatches Server Functions ONE AT
    // A TIME per browser tab, so rapid-fire row saves queued behind
    // each other's revalidatePath and lost picks when the user
    // navigated away (2026-06-04 incident). usePendingAction still
    // gates re-entrant clicks and clears the button in `finally`.
    void run(async () => {
      let res: SaveBetResult;
      try {
        const r = await fetch("/api/bets/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ matchId: match.id, home, away }),
        });
        // Surface the raw response on non-2xx so the next debug pass
        // (incl. the QA agent rerun) sees status + body text and can
        // tell a 500 HTML error apart from a server-returned db code.
        if (!r.ok) {
          const bodyText = await r.text().catch(() => "<unreadable>");
          console.error("[match-bet save http]", {
            matchId: match.id,
            status: r.status,
            statusText: r.statusText,
            body: bodyText.slice(0, 400),
          });
          setError("db");
          return;
        }
        res = (await r.json()) as SaveBetResult;
      } catch (err) {
        console.error("[match-bet save fetch]", { matchId: match.id, err });
        setError("db");
        return;
      }
      if (!res.ok) {
        console.error("[match-bet save error code]", {
          matchId: match.id,
          home,
          away,
          error: res.error,
        });
        setError(res.error);
        return;
      }
      // Stamp what we wrote BEFORE flipping dirty, so the post-save
      // useEffect sees the guard and does not paint stale props over
      // the value the user just saved.
      justSavedRef.current = { home, away };
      setSaved(true);
      setDirty(false);
    });
  };

  const pickDirection: "1" | "X" | "2" =
    home === away ? "X" : home > away ? "1" : "2";

  return (
    <Card
      className={clsx(
        "p-3 md:p-4 flex flex-col gap-3 md:gap-2 transition-colors",
        disabled && "opacity-70",
      )}
    >
      {/* Top row: flags + names + kickoff. On md+ this row stays a
          flex container; on mobile it splits into a fixture header. */}
      <div className="flex items-center gap-2 md:gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Flag code={match.homeCode} size={28} />
          <span className="text-sm font-bold truncate">{homeName}</span>
        </div>
        <span className="text-on-surface-variant text-xs font-bold px-1">vs</span>
        <div className="flex items-center gap-2 flex-1 min-w-0 justify-end">
          <span className="text-sm font-bold truncate text-end">
            {awayName}
          </span>
          <Flag code={match.awayCode} size={28} />
        </div>
        <span className="hidden md:inline text-[10px] text-on-surface-variant tabular-nums ms-2 shrink-0">
          {formatDateTime(match.kickoffAt, locale, {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>

      <div className="md:hidden text-[10px] text-on-surface-variant tabular-nums">
        {formatDateTime(match.kickoffAt, locale, {
          weekday: "short",
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </div>

      {/* Scoreboard + save button row. On mobile it occupies the
          whole width; on md+ it sits inside the same logical row. */}
      <div className="flex items-center justify-between gap-3 flex-wrap md:flex-nowrap">
        {/* No bidi-ltr here. The team header above flows with the
            document direction (home on the right in Hebrew), so the
            stepper row must follow the same flow — otherwise the home
            stepper sits under the away team name, and tapping "Mexico's
            stepper" (the right one in Hebrew) actually records the away
            score. */}
        <div className="flex items-center gap-2 tabular-nums">
          <Stepper
            value={home}
            onBump={(d) => onBump("home", d)}
            disabled={disabled}
            ariaLabel={isHebrew ? "שערי בית" : "Home score"}
          />
          <span className="font-[family-name:var(--font-score)] text-base font-bold w-6 text-center text-on-surface-variant">
            {pickDirection}
          </span>
          <Stepper
            value={away}
            onBump={(d) => onBump("away", d)}
            disabled={disabled}
            ariaLabel={isHebrew ? "שערי חוץ" : "Away score"}
          />
        </div>

        <button
          type="button"
          onClick={submit}
          disabled={disabled || pending || !dirty}
          className={clsx(
            "press-down min-h-[44px] px-5 inline-flex items-center justify-center gap-1.5 rounded-full text-sm font-bold flex-1 md:flex-none md:min-w-[120px]",
            saved && !dirty
              ? "bg-secondary-container text-on-secondary-container border border-secondary-fixed"
              : dirty
                ? "bg-primary text-on-primary"
                : "bg-surface-container-low text-on-surface-variant border border-outline-variant",
            (disabled || pending || !dirty) && "cursor-not-allowed",
          )}
          aria-label={
            pending
              ? isHebrew
                ? "שומר הימור"
                : "Saving bet"
              : saved && !dirty
                ? isHebrew
                  ? "הימור נשמר"
                  : "Bet saved"
                : isHebrew
                  ? "שמור הימור"
                  : "Save bet"
          }
          aria-live="polite"
        >
          {pending ? (
            isHebrew ? "שומר..." : "Saving..."
          ) : saved && !dirty ? (
            <>
              <Check className="h-4 w-4" strokeWidth={2.5} />
              {isHebrew ? "נשמר" : "Saved"}
            </>
          ) : (
            <span>{isHebrew ? "שמור" : "Save"}</span>
          )}
        </button>
      </div>

      {error && (
        <span className="inline-flex items-center gap-1 text-[11px] text-error">
          <AlertCircle className="h-3 w-3" strokeWidth={2} />
          {translateError(error, dict)}
        </span>
      )}
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
    <div className="inline-flex items-center bg-surface-container-lowest border border-outline rounded-lg">
      <button
        type="button"
        onClick={() => onBump(-1)}
        disabled={disabled}
        aria-label={`${ariaLabel} -`}
        className="h-11 w-11 inline-flex items-center justify-center text-on-surface hover:text-primary disabled:opacity-50"
      >
        <Minus className="h-4 w-4" strokeWidth={2.5} />
      </button>
      <span className="font-[family-name:var(--font-score)] text-lg md:text-xl font-bold w-7 text-center">
        {value}
      </span>
      <button
        type="button"
        onClick={() => onBump(1)}
        disabled={disabled}
        aria-label={`${ariaLabel} +`}
        className="h-11 w-11 inline-flex items-center justify-center text-on-surface hover:text-primary disabled:opacity-50"
      >
        <Plus className="h-4 w-4" strokeWidth={2.5} />
      </button>
    </div>
  );
}

function translateError(code: string, dict: Dictionary): string {
  const map = dict.errors.quickPick as Record<string, string>;
  return map[code] ?? map.db;
}
