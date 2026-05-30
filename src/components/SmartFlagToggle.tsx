"use client";

import { useState } from "react";
import { clsx } from "clsx";
import type { LucideIcon } from "lucide-react";
import { setSmartFlag } from "@/app/[lang]/profile/smart-hub-actions";
import { usePendingAction } from "@/lib/use-pending-action";

// Compact pure-flag toggle for the three Smart-Reminders flags. Unlike
// PushOptInToggle (which has to dance with browser permission + the
// PushManager subscription), these only flip a DB column - so the UI
// is a thin optimistic switch plus a hint line.
//
// See _plans/2026-05-30-smart-reminders.md §3.5.

type Props = {
  flag: "smart_hub_enabled" | "push_lock_reminders" | "push_duel_received";
  initial: boolean;
  label: string;
  hint: string;
  icon?: LucideIcon;
  isHebrew: boolean;
  // When false, the toggle is shown but disabled and shows a "blocked"
  // hint. Used to grey out the per-trigger push flags when the user
  // has the global push opt-in off.
  disabled?: boolean;
  disabledHint?: string;
};

export function SmartFlagToggle({
  flag,
  initial,
  label,
  hint,
  icon: Icon,
  isHebrew,
  disabled = false,
  disabledHint,
}: Props) {
  const [value, setValue] = useState(initial);
  const { pending, run } = usePendingAction();

  function toggle() {
    if (disabled || pending) return;
    const next = !value;
    // Optimistic flip so the switch feels instant. Roll back on
    // server failure.
    setValue(next);
    void run(async () => {
      const r = await setSmartFlag(flag, next);
      if (!r.ok) {
        setValue(!next);
        console.warn("[smart flag toggle failed]", { flag, error: r.error });
      }
    });
  }

  return (
    <div className="flex flex-col gap-2 px-5 py-4 border-b border-outline-variant min-h-[56px] last:border-0">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 font-bold text-on-surface">
          {Icon && (
            <Icon
              className={clsx(
                "h-4 w-4 shrink-0",
                value && !disabled ? "text-primary" : "text-on-surface-variant",
              )}
              strokeWidth={2}
              aria-hidden
            />
          )}
          {label}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={value}
          aria-label={label}
          disabled={disabled || pending}
          onClick={toggle}
          className={clsx(
            "min-h-[44px] min-w-[88px] px-3 inline-flex items-center justify-center gap-2 rounded-lg border text-xs font-bold transition-colors",
            value
              ? "bg-primary text-on-primary border-primary"
              : "bg-surface-container-lowest text-on-surface-variant border-outline",
            (disabled || pending) && "opacity-60 cursor-not-allowed",
          )}
        >
          <span
            className={clsx(
              "inline-block w-9 h-5 rounded-full relative transition-colors shrink-0",
              value ? "bg-on-primary/30" : "bg-outline-variant",
            )}
            aria-hidden
          >
            <span
              className={clsx(
                "absolute top-0.5 w-4 h-4 rounded-full bg-surface-container-lowest transition-all",
                // Start-side anchored knob keeps the visual feedback
                // correct in both LTR and RTL.
                value ? "end-0.5" : "start-0.5",
              )}
            />
          </span>
          <span>
            {value ? (isHebrew ? "פעיל" : "On") : (isHebrew ? "כבוי" : "Off")}
          </span>
        </button>
      </div>
      <p className="text-[11px] text-on-surface-variant">
        {disabled && disabledHint ? disabledHint : hint}
      </p>
    </div>
  );
}
