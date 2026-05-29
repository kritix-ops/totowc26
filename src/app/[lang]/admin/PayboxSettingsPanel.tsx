"use client";

import { useState } from "react";
import {
  ExternalLink,
  Check,
  AlertCircle,
  RotateCcw,
  Save,
  Link2,
} from "lucide-react";
import { clsx } from "clsx";
import type { Locale } from "../dictionaries";
import { Card, LabelCaps, SectionHeading } from "@/components/ui";
import { usePendingAction } from "@/lib/use-pending-action";
import { setPayboxUrl, type SetPayboxUrlResult } from "./paybox-actions";

// Admin-only editor for the Paybox group link. The value is the single
// source of truth that the /pay and onboarding screens render. Clearing
// the field reverts to the hard-coded marketing-page fallback, so the
// button is never dead even if the admin deletes the override.
export function PayboxSettingsPanel({
  locale,
  current,
  fallback,
}: {
  locale: Locale;
  current: string | null;
  fallback: string;
}) {
  const isHebrew = locale === "he";
  const [value, setValue] = useState(current ?? "");
  const [error, setError] = useState<
    Exclude<SetPayboxUrlResult, { ok: true }>["error"] | null
  >(null);
  const [saved, setSaved] = useState(false);
  const { pending, run } = usePendingAction();

  const dirty = (value.trim() || null) !== (current ?? null);
  const effective = value.trim() || fallback;
  const usingFallback = !value.trim();

  const submit = (next: string) => {
    setError(null);
    setSaved(false);
    // usePendingAction clears the button on the action response, not on
    // setPayboxUrl's revalidation re-render — so saving twice in a row
    // never leaves the button stuck on "שומר…".
    void run(async () => {
      const res = await setPayboxUrl(next);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSaved(true);
    });
  };

  const handleSave = () => submit(value);
  const handleClear = () => {
    setValue("");
    submit("");
  };

  return (
    <Card className="p-5 md:p-6 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex flex-col gap-1 min-w-0">
          <SectionHeading as="h2" underline="thin">
            {isHebrew ? "קישור קבוצת Paybox" : "Paybox group link"}
          </SectionHeading>
          <p className="text-sm text-on-surface-variant">
            {isHebrew
              ? "הקישור שמופיע בכפתור 'פתח את קבוצת Paybox' אצל כל המשתתפים. שנה כאן ושמור - אין צורך לפרוס מחדש."
              : "The URL behind the 'Open Paybox group' button for every player. Edit and save here - no redeploy needed."}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <LabelCaps>{isHebrew ? "URL" : "URL"}</LabelCaps>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="url"
            inputMode="url"
            dir="ltr"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="https://payboxapp.com/r/..."
            className="flex-1 h-12 px-4 rounded-lg bg-surface-container-lowest border border-outline focus:border-primary focus:outline-none text-base text-on-surface placeholder:text-outline-variant text-left"
          />
          <button
            type="button"
            onClick={handleSave}
            disabled={pending || !dirty}
            className={clsx(
              "press-down inline-flex items-center justify-center gap-2 min-h-[48px] px-5 rounded-lg bg-primary text-on-primary font-[family-name:var(--font-label)] text-[13px] font-bold tracking-[0.05em] hover:bg-surface-tint transition-colors",
              (pending || !dirty) && "opacity-60 cursor-not-allowed",
            )}
          >
            <Save className="h-4 w-4" strokeWidth={2.5} />
            {pending ? (isHebrew ? "שומר..." : "Saving...") : isHebrew ? "שמור" : "Save"}
          </button>
        </div>
      </div>

      <div className="flex items-start gap-3 p-3 rounded-lg bg-surface-container-low border border-outline-variant">
        <Link2 className="h-4 w-4 mt-0.5 text-on-surface-variant shrink-0" strokeWidth={2} />
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <LabelCaps>
            {isHebrew ? "קישור פעיל כעת" : "Currently active"}
            {usingFallback && (
              <span className="ml-2 normal-case font-bold tracking-normal text-tertiary">
                ({isHebrew ? "ברירת מחדל" : "fallback"})
              </span>
            )}
          </LabelCaps>
          <a
            href={effective}
            target="_blank"
            rel="noopener noreferrer"
            dir="ltr"
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline truncate"
          >
            <span className="truncate">{effective}</span>
            <ExternalLink className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          </a>
        </div>
        {!usingFallback && (
          <button
            type="button"
            onClick={handleClear}
            disabled={pending}
            aria-label={isHebrew ? "אפס לברירת מחדל" : "Reset to default"}
            className={clsx(
              "press-down inline-flex items-center justify-center gap-1.5 min-h-[36px] px-3 rounded-full bg-surface text-on-surface-variant border border-outline-variant text-xs font-bold hover:bg-surface-container transition-colors shrink-0",
              pending && "opacity-60 cursor-not-allowed",
            )}
          >
            <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} />
            {isHebrew ? "אפס" : "Reset"}
          </button>
        )}
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

function translate(
  code: Exclude<SetPayboxUrlResult, { ok: true }>["error"],
  isHebrew: boolean,
): string {
  const map: Record<string, [string, string]> = {
    unauth: ["יש להתחבר", "Sign in required"],
    forbidden: ["אין הרשאה", "Not allowed"],
    invalid: [
      "קישור לא תקין. חייב להתחיל ב-https://",
      "Invalid URL. Must start with https://",
    ],
    db: ["שגיאת שמירה", "Save failed"],
  };
  return map[code][isHebrew ? 0 : 1];
}
