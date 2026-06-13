"use client";

import { useState } from "react";
import { Check, AlertCircle, CalendarClock } from "lucide-react";
import { clsx } from "clsx";
import type { Locale } from "../dictionaries";
import { Card, LabelCaps, SectionHeading } from "@/components/ui";
import { usePendingAction } from "@/lib/use-pending-action";
import {
  setLiveShowUpcoming,
  type SetLiveShowUpcomingResult,
} from "./live-show-upcoming-actions";

// Admin-only switch for the "upcoming matches of the active matchday"
// feed on /[lang]/live. When off, the live scoreboard still shows games
// currently in play and finals from the last 90 minutes; only the
// scheduled rows (with the kickoff countdown) are hidden.
export function LiveShowUpcomingSettingsPanel({
  locale,
  current,
}: {
  locale: Locale;
  current: boolean;
}) {
  const isHebrew = locale === "he";
  const [enabled, setEnabled] = useState(current);
  const [error, setError] = useState<
    Exclude<SetLiveShowUpcomingResult, { ok: true }>["error"] | null
  >(null);
  const [saved, setSaved] = useState(false);
  const { pending, run } = usePendingAction();

  const toggle = (next: boolean) => {
    if (next === enabled || pending) return;
    setError(null);
    setSaved(false);
    setEnabled(next);
    void run(async () => {
      const res = await setLiveShowUpcoming(next);
      if (!res.ok) {
        setEnabled(!next);
        setError(res.error);
        return;
      }
      setSaved(true);
    });
  };

  return (
    <Card className="p-5 md:p-6 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <SectionHeading as="h2" underline="thin">
            <span className="inline-flex items-center gap-2">
              <CalendarClock className="h-5 w-5 text-primary" strokeWidth={1.75} />
              {isHebrew
                ? "משחקים קרובים בתוצאות חיות"
                : "Upcoming matches on live scoreboard"}
            </span>
          </SectionHeading>
          <p className="text-sm text-on-surface-variant leading-6">
            {isHebrew
              ? "כשהמתג דלוק, דף תוצאות חיות מציג גם את המשחקים הקרובים של יום המשחק הפעיל עם ספירה לאחור. כיבוי משאיר רק משחקים חיים ותוצאות מ-90 הדקות האחרונות."
              : "When on, the live scoreboard also lists the active matchday's upcoming fixtures with a kickoff countdown. Turning it off keeps only in-play games and the last 90 minutes of finals."}
          </p>
        </div>

        <Toggle
          isHebrew={isHebrew}
          checked={enabled}
          disabled={pending}
          onChange={toggle}
        />
      </div>

      <div className="flex items-center gap-2 p-3 rounded-lg bg-surface-container-low border border-outline-variant">
        <span
          className={clsx(
            "w-2.5 h-2.5 rounded-full shrink-0",
            enabled ? "bg-secondary" : "bg-outline",
          )}
          aria-hidden
        />
        <LabelCaps>
          {isHebrew
            ? enabled
              ? "מוצגים על המסך"
              : "מוסתרים"
            : enabled
              ? "Shown on scoreboard"
              : "Hidden"}
        </LabelCaps>
      </div>

      {error && (
        <p className="inline-flex items-center gap-2 text-sm text-error">
          <AlertCircle className="h-4 w-4" strokeWidth={2} />
          {translate(error, isHebrew)}
        </p>
      )}
      {saved && !error && (
        <p className="inline-flex items-center gap-2 text-sm text-secondary">
          <Check className="h-4 w-4" strokeWidth={2.5} />
          {isHebrew ? "נשמר" : "Saved"}
        </p>
      )}
    </Card>
  );
}

function Toggle({
  isHebrew,
  checked,
  disabled,
  onChange,
}: {
  isHebrew: boolean;
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={isHebrew ? "משחקים קרובים" : "Upcoming matches"}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        "press-down relative inline-flex shrink-0 items-center w-14 h-8 rounded-full transition-colors min-h-[44px] min-w-[44px] focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2",
        checked ? "bg-secondary" : "bg-outline-variant",
        disabled && "opacity-60 cursor-not-allowed",
      )}
    >
      <span
        aria-hidden
        className={clsx(
          "inline-block w-6 h-6 bg-surface rounded-full shadow transition-transform",
          isHebrew
            ? checked
              ? "-translate-x-1"
              : "-translate-x-7"
            : checked
              ? "translate-x-7"
              : "translate-x-1",
        )}
      />
    </button>
  );
}

function translate(
  code: Exclude<SetLiveShowUpcomingResult, { ok: true }>["error"],
  isHebrew: boolean,
): string {
  const map: Record<string, [string, string]> = {
    unauth: ["יש להתחבר", "Sign in required"],
    forbidden: ["אין הרשאה", "Not allowed"],
    db: ["שגיאת שמירה", "Save failed"],
  };
  return map[code][isHebrew ? 0 : 1];
}
