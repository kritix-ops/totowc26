"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, Lock } from "lucide-react";
import { clsx } from "clsx";
import { Card, PillButton, SectionHeading } from "@/components/ui";
import {
  HIDEABLE_PAGE_KEYS,
  HIDEABLE_PAGE_LABELS,
  NEVER_HIDEABLE,
  type HideablePageKey,
} from "@/lib/page-visibility-catalog";
import type { Locale } from "../../dictionaries";
import { saveHiddenPages } from "./actions";

export function PageVisibilityForm({
  locale,
  initialHidden,
}: {
  locale: Locale;
  initialHidden: string[];
}) {
  const isHebrew = locale === "he";
  const router = useRouter();
  const initialSet = useMemo(() => new Set(initialHidden), [initialHidden]);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(initialSet));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty = useMemo(() => {
    if (hidden.size !== initialSet.size) return true;
    for (const k of hidden) if (!initialSet.has(k)) return true;
    return false;
  }, [hidden, initialSet]);

  function toggle(key: HideablePageKey) {
    setError(null);
    setSaved(false);
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function onSave() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await saveHiddenPages(Array.from(hidden));
      if (!res.ok) {
        setError(res.error);
      } else {
        setSaved(true);
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-5 md:p-6 flex flex-col gap-4">
        <SectionHeading underline="thin" as="h2">
          {isHebrew ? "עמודים פעילים" : "Active pages"}
        </SectionHeading>
        <p className="text-sm text-on-surface-variant">
          {isHebrew
            ? "כיבוי המתג מסתיר את העמוד מהניווט ומונע גישה דרך כתובת ישירה."
            : "Toggling a page off hides it from navigation and blocks direct URL access."}
        </p>
        <ul className="flex flex-col divide-y divide-outline-variant border border-outline-variant rounded-lg">
          {HIDEABLE_PAGE_KEYS.map((key) => {
            const isOn = !hidden.has(key);
            const meta = HIDEABLE_PAGE_LABELS[key];
            return (
              <li
                key={key}
                className="px-3 py-3 md:px-4 md:py-4 flex items-center gap-3"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm text-on-surface">
                    {isHebrew ? meta.he : meta.en}
                    <span className="text-on-surface-variant font-normal ms-2 tabular-nums text-xs">
                      {meta.pathSegment}
                    </span>
                  </p>
                  <p className="text-[11px] text-on-surface-variant">
                    {isHebrew ? meta.hintHe : meta.hintEn}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isOn}
                  onClick={() => toggle(key)}
                  className={clsx(
                    "min-h-[44px] min-w-[88px] px-3 inline-flex items-center justify-center gap-2 rounded-lg border text-xs font-bold transition-colors",
                    isOn
                      ? "bg-primary text-on-primary border-primary"
                      : "bg-surface-container-lowest text-on-surface-variant border-outline",
                  )}
                >
                  <span
                    className={clsx(
                      "inline-block w-9 h-5 rounded-full relative transition-colors shrink-0",
                      isOn ? "bg-on-primary/30" : "bg-outline-variant",
                    )}
                    aria-hidden
                  >
                    <span
                      className={clsx(
                        "absolute top-0.5 w-4 h-4 rounded-full bg-surface-container-lowest transition-all",
                        isOn
                          ? isHebrew
                            ? "left-0.5"
                            : "right-0.5"
                          : isHebrew
                            ? "right-0.5"
                            : "left-0.5",
                      )}
                    />
                  </span>
                  <span>
                    {isOn ? (isHebrew ? "פעיל" : "On") : isHebrew ? "מוסתר" : "Hidden"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-h-[24px]">
            {error && (
              <p className="inline-flex items-center gap-1.5 text-sm text-error">
                <AlertCircle className="h-4 w-4" strokeWidth={2} />
                {translateError(error, isHebrew)}
              </p>
            )}
            {saved && !error && (
              <p className="inline-flex items-center gap-1.5 text-sm text-secondary">
                <Check className="h-4 w-4" strokeWidth={2.5} />
                {isHebrew ? "ההגדרות נשמרו" : "Settings saved"}
              </p>
            )}
          </div>
          <PillButton
            type="button"
            disabled={pending || !dirty}
            onClick={onSave}
            className={clsx(
              "px-8 py-3",
              (pending || !dirty) && "opacity-60 cursor-not-allowed",
            )}
          >
            {pending
              ? isHebrew
                ? "שומר..."
                : "Saving..."
              : isHebrew
                ? "שמור"
                : "Save"}
          </PillButton>
        </div>
      </Card>

      <Card className="p-5 md:p-6 flex flex-col gap-3 bg-surface-container-lowest border-outline-variant">
        <SectionHeading underline="thin" as="h2">
          {isHebrew ? "מערכת — לא ניתן להסתיר" : "System — not hideable"}
        </SectionHeading>
        <p className="text-sm text-on-surface-variant">
          {isHebrew
            ? "העמודים האלו תמיד פעילים — נדרשים לתפעול הבסיסי של המערכת."
            : "These pages are always available — required for the system to function."}
        </p>
        <ul className="flex flex-col gap-2">
          {NEVER_HIDEABLE.map((item) => (
            <li
              key={item.key}
              className="flex items-start gap-3 text-sm text-on-surface-variant"
            >
              <Lock className="h-4 w-4 mt-0.5 shrink-0" strokeWidth={2} />
              <div className="flex-1">
                <span className="font-bold text-on-surface">
                  {isHebrew ? item.he : item.en}
                </span>
                <span className="block text-[11px]">
                  {isHebrew ? item.whyHe : item.whyEn}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function translateError(code: string, isHebrew: boolean): string {
  const map: Record<string, [string, string]> = {
    invalid: [
      "ערכים לא תקינים. אחד המפתחות אינו ברשימת העמודים שמותר להסתיר.",
      "Invalid value. One of the keys isn't in the hideable catalog.",
    ],
    unauth: ["יש להתחבר", "Sign in required"],
    forbidden: ["אין הרשאות אדמין", "Admin role required"],
    db: ["שגיאת שמירה", "Save failed"],
  };
  return (map[code] ?? map.db)[isHebrew ? 0 : 1];
}
