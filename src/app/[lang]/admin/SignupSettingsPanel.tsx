"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, AlertCircle, UserPlus } from "lucide-react";
import { clsx } from "clsx";
import type { Locale } from "../dictionaries";
import { Card, LabelCaps, SectionHeading } from "@/components/ui";
import {
  setPublicSignupOpen,
  type SetPublicSignupOpenResult,
} from "./signup-settings-actions";

// Admin-only switch that controls whether the public /signup form
// accepts new requests. When off, the page renders a friendly closed
// notice and the link from /login is hidden. Useful once the
// tournament starts and the admin no longer wants new players in.
export function PublicSignupSettingsPanel({
  locale,
  current,
}: {
  locale: Locale;
  current: boolean;
}) {
  const isHebrew = locale === "he";
  const router = useRouter();
  const [open, setOpen] = useState(current);
  const [error, setError] = useState<
    Exclude<SetPublicSignupOpenResult, { ok: true }>["error"] | null
  >(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const toggle = (next: boolean) => {
    if (next === open) return;
    setError(null);
    setSaved(false);
    // Optimistic - flip the visual state immediately so the switch feels
    // instant; if the server rejects, we revert.
    setOpen(next);
    startTransition(async () => {
      const res = await setPublicSignupOpen(next);
      if (!res.ok) {
        setOpen(!next);
        setError(res.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  };

  return (
    <Card className="p-5 md:p-6 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <SectionHeading as="h2" underline="thin">
            <span className="inline-flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-primary" strokeWidth={1.75} />
              {isHebrew ? "הרשמה ציבורית" : "Public signup"}
            </span>
          </SectionHeading>
          <p className="text-sm text-on-surface-variant leading-6">
            {isHebrew
              ? "כשהמתג פתוח, כל מי שמגיע לעמוד הכניסה רואה לינק 'להגיש בקשה' ויכול לשלוח את פרטיו לאישור. כשסגור, רק אדמין יכול להזמין שחקנים חדשים דרך מסך המשתתפים."
              : "When on, anyone visiting the login page sees a 'Request to join' link and can submit their details for approval. When off, only admins can invite new players via the Players screen."}
          </p>
        </div>

        <Toggle
          isHebrew={isHebrew}
          checked={open}
          disabled={pending}
          onChange={toggle}
        />
      </div>

      <div className="flex items-center gap-2 p-3 rounded-lg bg-surface-container-low border border-outline-variant">
        <span
          className={clsx(
            "w-2.5 h-2.5 rounded-full shrink-0",
            open ? "bg-secondary" : "bg-outline",
          )}
          aria-hidden
        />
        <LabelCaps>
          {isHebrew
            ? open
              ? "פתוח - מקבל בקשות"
              : "סגור - בקשות לא מתקבלות"
            : open
              ? "Open - accepting requests"
              : "Closed - requests blocked"}
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
      aria-label={isHebrew ? "הרשמה ציבורית" : "Public signup"}
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
          // RTL flips left/right - knob travel direction stays "from off
          // (start) to on (end)" semantically regardless of locale.
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
  code: Exclude<SetPublicSignupOpenResult, { ok: true }>["error"],
  isHebrew: boolean,
): string {
  const map: Record<string, [string, string]> = {
    unauth: ["יש להתחבר", "Sign in required"],
    forbidden: ["אין הרשאה", "Not allowed"],
    db: ["שגיאת שמירה", "Save failed"],
  };
  return map[code][isHebrew ? 0 : 1];
}
