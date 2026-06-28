"use client";

import { useEffect, useCallback, useRef, useState } from "react";
import { Minus, Plus, Dices } from "lucide-react";
import { clsx } from "clsx";
import { Card } from "@/components/ui";
import { Flag } from "@/components/Flag";
import { SaveStatus, type SaveState } from "@/components/SaveStatus";
import type { Dictionary, Locale } from "../dictionaries";
import { formatDateTime } from "@/lib/format";
import { usePendingAction } from "@/lib/use-pending-action";
import { useAutosave } from "@/lib/use-autosave";
import { toast } from "@/lib/toast";
import { withTimeout, SAVE_TIMEOUT_MS } from "@/lib/with-timeout";
import { stageLabel, isKnockoutStage } from "@/lib/stage-label";
import { suggestMatchScore } from "./random-actions";
import type { SaveBetResult } from "./[matchId]/actions";

// One match row on the quick-picks /bets page. Self-contained: pre-fills
// from the existing pick if any and AUTO-SAVES — there is no Save button.
// Changing a score (stepper or "Surprise me") schedules a debounced,
// single-flight save through the same /api/bets/save Route Handler; the
// inline <SaveStatus /> shows saving / saved / error+retry, and failures
// also raise a loud toast in case the row has scrolled out of view.
//
// Layout is responsive by hand instead of via a single flex row.
// On mobile we stack:
//   1. Header (flags + names + kickoff time)
//   2. Scoreboard (home stepper, direction, away stepper)
//   3. Save status (replaces the old full-width Save button)
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
  groupId: string | null;
  matchDate: string;
  myHomeScore: number | null;
  myAwayScore: number | null;
  // The team this user picked to advance (knockout matches only). Null = no pick.
  myAdvanceTeam: string | null;
};

export function QuickPickRow({
  locale,
  dict,
  match,
  lockMinutes,
  canEdit,
  advancePoints,
}: {
  locale: Locale;
  dict: Dictionary;
  match: QuickPickRowData;
  lockMinutes: number;
  canEdit: boolean;
  advancePoints: number;
}) {
  const isHebrew = locale === "he";
  const hadPick = match.myHomeScore !== null && match.myAwayScore !== null;
  const isKnockout = isKnockoutStage(match.stage);

  const [home, setHome] = useState<number>(match.myHomeScore ?? 0);
  const [away, setAway] = useState<number>(match.myAwayScore ?? 0);
  // "Surprise me" runs a separate server fetch (not the autosave write), so
  // it keeps its own in-flight guard to prevent a double re-roll.
  const { pending: suggesting, run: runSuggest } = usePendingAction();

  // Holds the home/away the user just successfully saved. Stays set until
  // the next prop refresh arrives carrying those same values — at which
  // point the server has caught up and the prop-sync below can run again.
  // Without it, a save's own revalidatePath race could repaint the user's
  // fresh pick back to a stale 0:0 (the 2026-06-04 "מחק לי תוצאות 0-0" report).
  const justSavedRef = useRef<{ home: number; away: number } | null>(null);

  // Undo support: committedScoreRef holds the score currently on the server;
  // undoScore is the value before the last save, surfaced as an inline "undo"
  // on the saved state. Null when there's nothing to revert to (a brand-new
  // first pick — a match pick can't be cleared back to "no pick").
  const committedScoreRef = useRef<{ home: number; away: number } | null>(
    hadPick ? { home: match.myHomeScore!, away: match.myAwayScore! } : null,
  );
  const [undoScore, setUndoScore] = useState<{
    home: number;
    away: number;
  } | null>(null);

  // "Who advances?" pick (knockout matches only). Optimistic local state: the
  // tap paints immediately and reverts on a failed save. No prop-sync effect —
  // a fresh navigation re-mounts with the server value, and skipping it avoids
  // the post-save flicker the score row has to guard against.
  const [advanceTeam, setAdvanceTeam] = useState<string | null>(
    match.myAdvanceTeam,
  );
  const { pending: savingAdvance, run: runAdvance } = usePendingAction();

  // Persist one scoreline through the /api/bets/save Route Handler (parallel
  // via fetch — Server Functions dispatch one-at-a-time per tab and queued
  // behind each other's revalidation, the 2026-06-04 lost-pick incident).
  // Returns true on success; on any failure it raises a localized toast and
  // returns false so the autosave hook flips to its error + retry state. The
  // write is an idempotent upsert, so a retry after a false-timeout can
  // never double-write.
  const doSave = useCallback(
    async (score: { home: number; away: number }): Promise<boolean> => {
      const { home: h, away: a } = score;
      // Bound the wait so a hung pooler can't strand the row on "saving".
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), SAVE_TIMEOUT_MS);
      let res: SaveBetResult;
      try {
        const r = await fetch("/api/bets/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ matchId: match.id, home: h, away: a }),
          signal: controller.signal,
        });
        if (!r.ok) {
          const bodyText = await r.text().catch(() => "<unreadable>");
          console.error("[match-bet save http]", {
            matchId: match.id,
            status: r.status,
            statusText: r.statusText,
            body: bodyText.slice(0, 400),
          });
          toast.error(translateError("db", dict));
          return false;
        }
        res = (await r.json()) as SaveBetResult;
      } catch (err) {
        // Our abort (timeout) or a transport failure — the pick is unsaved.
        console.error("[match-bet save fetch]", { matchId: match.id, err });
        toast.error(translateError("db", dict));
        return false;
      } finally {
        clearTimeout(timeoutId);
      }
      if (!res.ok) {
        console.error("[match-bet save error code]", {
          matchId: match.id,
          home: h,
          away: a,
          error: res.error,
        });
        toast.error(translateError(res.error, dict));
        return false;
      }
      // Stamp what we wrote BEFORE the prop-sync effect can run so it sees
      // the guard and won't paint stale props over the value we just saved.
      justSavedRef.current = { home: h, away: a };
      // Advance the undo target to the score that was committed before this
      // save, then record the new committed score.
      setUndoScore(committedScoreRef.current);
      committedScoreRef.current = { home: h, away: a };
      return true;
    },
    [match.id, dict],
  );

  const { status, schedule, retry } = useAutosave<{ home: number; away: number }>(
    { save: doSave },
  );

  // Sync the local steppers from the server when fresh props arrive (e.g. a
  // "Surprise me" elsewhere or a deadline auto-fill). Guarded so it never
  // clobbers an in-flight edit: while a save is pending ("saving") or has
  // failed ("error") the local value is the source of truth. justSavedRef
  // additionally blocks a save's own props race from repainting 0:0.
  useEffect(() => {
    if (status === "saving" || status === "error") return;
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
  }, [match.myHomeScore, match.myAwayScore, status]);

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

  // A pre-existing pick reads as "saved" on load even though no save has run
  // this session (status is still "idle"); once the user edits, the live
  // autosave status takes over.
  const displayState: SaveState =
    status === "idle" && hadPick ? "saved" : status;
  const committed = hadPick || status === "saved";
  // "Surprise me" is an entry-point affordance: offer it only until a pick
  // exists, then the steppers are how the user adjusts.
  const showSurprise = !disabled && !committed;

  const onBump = (side: "home" | "away", delta: 1 | -1) => {
    if (disabled) return;
    const nextHome = side === "home" ? clampScore(home + delta) : home;
    const nextAway = side === "away" ? clampScore(away + delta) : away;
    // Tapping past the 0–99 floor/ceiling is a no-op; don't schedule a
    // redundant save.
    if (nextHome === home && nextAway === away) return;
    setHome(nextHome);
    setAway(nextAway);
    schedule({ home: nextHome, away: nextAway });
  };

  // Per-match "Surprise me": ask the server for a realistic scoreline, paint
  // it into the steppers, and schedule the autosave. The user can re-tap
  // (re-roll) or adjust with the steppers before it sticks. The suggestion
  // fetch has its own in-flight guard (runSuggest) separate from the save.
  const onSurprise = () => {
    if (disabled || suggesting) return;
    void runSuggest(async () => {
      const res = await withTimeout(
        suggestMatchScore(match.id),
        SAVE_TIMEOUT_MS,
      ).catch(() => null);
      if (!res) {
        toast.error(translateError("db", dict));
        return;
      }
      if (!res.ok) {
        toast.error(
          translateError(res.error === "not_paid" ? "not_paid" : "db", dict),
        );
        return;
      }
      setHome(res.home);
      setAway(res.away);
      schedule({ home: res.home, away: res.away });
    });
  };

  // Revert to the previously committed score and re-save it. Only offered
  // when there is a prior score to go back to (undoScore != null).
  const onUndoScore = () => {
    if (disabled || !undoScore) return;
    setHome(undoScore.home);
    setAway(undoScore.away);
    schedule(undoScore);
  };

  const pickDirection: "1" | "X" | "2" =
    home === away ? "X" : home > away ? "1" : "2";

  // Toggle the advancing-team pick: tapping the selected team clears it.
  // Saves through the parallel /api/bets/advance route (not a server action,
  // same lost-pick rationale as the score save).
  const onPickAdvance = (team: string) => {
    if (disabled || savingAdvance) return;
    const next = advanceTeam === team ? null : team;
    const prev = advanceTeam;
    setAdvanceTeam(next);
    void runAdvance(async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), SAVE_TIMEOUT_MS);
      try {
        const r = await fetch("/api/bets/advance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ matchId: match.id, team: next }),
          signal: controller.signal,
        });
        const res = (await r.json().catch(() => null)) as SaveBetResult | null;
        if (!r.ok || !res || !res.ok) {
          setAdvanceTeam(prev);
          console.error("[advance-bet save]", {
            matchId: match.id,
            status: r.status,
            error: res && !res.ok ? res.error : "http",
          });
          toast.error(
            translateError(res && !res.ok ? res.error : "db", dict),
          );
        }
      } catch (err) {
        setAdvanceTeam(prev);
        console.error("[advance-bet save fetch]", { matchId: match.id, err });
        toast.error(translateError("db", dict));
      } finally {
        clearTimeout(timeoutId);
      }
    });
  };

  return (
    <Card
      className={clsx(
        "p-3 md:p-4 flex flex-col gap-3 md:gap-2 transition-colors",
        disabled && "opacity-70",
      )}
    >
      {/* Stage chip — which round this fixture belongs to. Shown on every
          card so the list reads clearly once knockouts unlock. */}
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-secondary-container text-on-secondary-container text-[11px] font-bold">
          {stageLabel(match.stage, match.groupId, isHebrew ? "he" : "en")}
        </span>
      </div>

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

        <div className="flex items-center gap-2 flex-1 md:flex-none justify-end min-h-[44px]">
          {showSurprise && (
            <button
              type="button"
              onClick={onSurprise}
              disabled={suggesting}
              aria-label={isHebrew ? "תפתיע אותי" : "Surprise me"}
              title={isHebrew ? "תפתיע אותי" : "Surprise me"}
              className={clsx(
                "press-down h-11 w-11 inline-flex items-center justify-center rounded-full shrink-0",
                "bg-tertiary-fixed text-on-tertiary-fixed-variant border border-tertiary-fixed-dim",
                suggesting && "opacity-60 cursor-wait",
              )}
            >
              <Dices className="h-5 w-5" strokeWidth={1.75} />
            </button>
          )}

          {/* Auto-save status replaces the old Save button: the row saves
              itself on every change, so this just reports saving / saved /
              error (with an inline retry, since there's no button to re-tap). */}
          <SaveStatus
            state={displayState}
            locale={locale}
            onRetry={retry}
            onUndo={undoScore ? onUndoScore : undefined}
            className="justify-end"
          />
        </div>
      </div>

      {/* Knockout-only: the "who advances?" (מי עולה?) pick + the note that the
          score guess above is judged on 90 minutes (extra time lives in live
          bets). Two finger-sized team buttons; tapping the selected one clears. */}
      {isKnockout && (
        <div className="flex flex-col gap-2 border-t border-outline-variant pt-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-on-surface inline-flex items-center gap-1.5">
              {isHebrew ? "מי עולה?" : "Who advances?"}
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-success-container text-on-success-container text-[10px] font-bold tabular-nums">
                +{advancePoints}
              </span>
            </span>
            <span className="text-[10px] text-on-surface-variant">
              {isHebrew ? "כולל הארכות ופנדלים" : "incl. extra time & penalties"}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[
              { code: match.homeCode, name: homeName },
              { code: match.awayCode, name: awayName },
            ].map((t) => {
              const selected = advanceTeam === t.code;
              return (
                <button
                  key={t.code}
                  type="button"
                  onClick={() => onPickAdvance(t.code)}
                  disabled={disabled || savingAdvance}
                  aria-pressed={selected}
                  aria-label={
                    isHebrew ? `${t.name} עולה` : `${t.name} advances`
                  }
                  className={clsx(
                    "press-down min-h-[44px] inline-flex items-center justify-center gap-2 rounded-lg border px-2 py-1.5 text-sm font-bold transition-colors min-w-0",
                    selected
                      ? "bg-primary text-on-primary border-primary"
                      : "bg-surface-container-lowest text-on-surface border-outline",
                    (disabled || savingAdvance) && "opacity-60",
                  )}
                >
                  <Flag code={t.code} size={20} />
                  <span className="truncate">{t.name}</span>
                </button>
              );
            })}
          </div>
          <p className="text-[10px] text-on-surface-variant">
            {isHebrew
              ? "ניחוש התוצאה למעלה נספר לפי 90 דקות בלבד."
              : "The score guess above is judged on 90 minutes only."}
          </p>
        </div>
      )}
    </Card>
  );
}

// Goals are clamped to a sane 0–99 range — the same bound the steppers
// enforced inline before the value moved through the autosave scheduler.
function clampScore(v: number): number {
  return Math.max(0, Math.min(99, v));
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
