"use client";

import { useState } from "react";
import { Check, AlertCircle, Eye } from "lucide-react";
import { clsx } from "clsx";
import type { Locale } from "../dictionaries";
import { Card, LabelCaps, SectionHeading } from "@/components/ui";
import { usePendingAction } from "@/lib/use-pending-action";
import {
  setDashboardDigestEnabled,
  type SetDashboardDigestEnabledResult,
} from "./dashboard-digest-actions";

// Admin-only switch for the "What the pool picked today" widget on the
// home dashboard. Turning the switch off does not affect /transparency
// itself - that has its own page-visibility gate. This only mutes the
// dashboard card.
export function DashboardDigestSettingsPanel({
  locale,
  current,
}: {
  locale: Locale;
  current: boolean;
}) {
  const isHebrew = locale === "he";
  const [enabled, setEnabled] = useState(current);
  const [error, setError] = useState<
    Exclude<SetDashboardDigestEnabledResult, { ok: true }>["error"] | null
  >(null);
  const [saved, setSaved] = useState(false);
  const { pending, run } = usePendingAction();

  const toggle = (next: boolean) => {
    if (next === enabled || pending) return;
    setError(null);
    setSaved(false);
    setEnabled(next);
    void run(async () => {
      const res = await setDashboardDigestEnabled(next);
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
              <Eye className="h-5 w-5 text-primary" strokeWidth={1.75} />
              {isHebrew ? "סיכום קהילה בדשבורד" : "Pool digest on dashboard"}
            </span>
          </SectionHeading>
          <p className="text-sm text-on-surface-variant leading-6">
            {isHebrew
              ? "כשהמתג דלוק, הדשבורד הראשי מציג כרטיס עם הימורי היום של כל הקהילה וקישור לעמוד השקיפות. כיבוי משתיק רק את הכרטיס - עמוד השקיפות עצמו ממשיך לעבוד."
              : "When on, the home dashboard shows a card with today's pool picks and a link to the transparency page. Turning it off mutes only the card - /transparency itself stays available."}
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
              ? "מוצג בדשבורד"
              : "מושתק"
            : enabled
              ? "Shown on dashboard"
              : "Muted"}
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
      aria-label={isHebrew ? "סיכום קהילה" : "Pool digest"}
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
  code: Exclude<SetDashboardDigestEnabledResult, { ok: true }>["error"],
  isHebrew: boolean,
): string {
  const map: Record<string, [string, string]> = {
    unauth: ["יש להתחבר", "Sign in required"],
    forbidden: ["אין הרשאה", "Not allowed"],
    db: ["שגיאת שמירה", "Save failed"],
  };
  return map[code][isHebrew ? 0 : 1];
}
