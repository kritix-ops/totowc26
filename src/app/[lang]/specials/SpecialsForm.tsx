"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, AlertCircle, X } from "lucide-react";
import { clsx } from "clsx";
import { PillButton } from "@/components/ui";
import type { Locale } from "../dictionaries";
import { saveSpecial, type SaveSpecialResult } from "./actions";

type Slot = "top_scorer" | "final_penalties";

export function SpecialsForm({
  slot,
  initialValue,
  options,
  locale,
}: {
  slot: Slot;
  initialValue: string;
  options?: string[];
  locale: Locale;
}) {
  const isHebrew = locale === "he";
  const router = useRouter();
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<
    Exclude<SaveSpecialResult, { ok: true }>["error"] | null
  >(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const listId = useId();

  const submit = (next?: string) => {
    setError(null);
    setSaved(false);
    const val = next ?? value;
    startTransition(async () => {
      const res = await saveSpecial(slot, val);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  };

  if (slot === "final_penalties") {
    return (
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          {[
            { v: "yes", label: isHebrew ? "כן" : "Yes" },
            { v: "no", label: isHebrew ? "לא" : "No" },
          ].map((opt) => {
            const active = value === opt.v;
            return (
              <button
                key={opt.v}
                type="button"
                onClick={() => {
                  setValue(opt.v);
                  submit(opt.v);
                }}
                disabled={pending}
                className={clsx(
                  "press-down min-h-[48px] py-3 px-4 rounded-full border text-base font-bold transition-colors",
                  active
                    ? "border-2 border-primary bg-primary-container text-on-primary-container shadow-sm"
                    : "border-outline bg-surface-container-lowest text-on-surface hover:bg-surface-container",
                  pending && "opacity-60",
                )}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        <FeedbackRow error={error} saved={saved} isHebrew={isHebrew} />
      </div>
    );
  }

  // Top scorer: text input with optional <datalist> autocomplete.
  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          list={options && options.length > 0 ? listId : undefined}
          placeholder={isHebrew ? "שם השחקן" : "Player name"}
          className="w-full h-12 px-4 rounded-full bg-surface-container-lowest border border-outline focus:border-primary focus:outline-none text-base text-on-surface placeholder:text-outline-variant"
        />
        {options && options.length > 0 && (
          <datalist id={listId}>
            {options.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        )}
        {value && (
          <button
            type="button"
            onClick={() => {
              setValue("");
              submit("");
            }}
            aria-label={isHebrew ? "נקה" : "Clear"}
            className={clsx(
              "absolute top-1/2 -translate-y-1/2 min-w-[40px] min-h-[40px] flex items-center justify-center text-on-surface-variant hover:text-error",
              isHebrew ? "left-1" : "right-1",
            )}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="flex items-center justify-between gap-3">
        <FeedbackRow error={error} saved={saved} isHebrew={isHebrew} />
        <PillButton
          type="button"
          onClick={() => submit()}
          disabled={pending || !value.trim()}
          className="text-sm px-6 py-2.5"
        >
          {pending
            ? isHebrew ? "שומר..." : "Saving..."
            : isHebrew ? "שמור" : "Save"}
        </PillButton>
      </div>
      {options && options.length > 0 && (
        <p className="text-xs text-on-surface-variant">
          {isHebrew
            ? `יש ${options.length} מועמדים בטופ הבוקעים העדכני. הקלד שם או בחר מהרשימה.`
            : `${options.length} candidates from the current top-scorers list. Type or pick.`}
        </p>
      )}
    </div>
  );
}

function FeedbackRow({
  error,
  saved,
  isHebrew,
}: {
  error: Exclude<SaveSpecialResult, { ok: true }>["error"] | null;
  saved: boolean;
  isHebrew: boolean;
}) {
  if (error) {
    return (
      <p className="inline-flex items-center gap-1.5 text-sm text-error">
        <AlertCircle className="h-4 w-4" strokeWidth={2} />
        {translate(error, isHebrew)}
      </p>
    );
  }
  if (saved) {
    return (
      <p className="inline-flex items-center gap-1.5 text-sm text-secondary">
        <Check className="h-4 w-4" strokeWidth={2.5} />
        {isHebrew ? "נשמר" : "Saved"}
      </p>
    );
  }
  return <span />;
}

function translate(
  code: Exclude<SaveSpecialResult, { ok: true }>["error"],
  isHebrew: boolean,
): string {
  const map: Record<string, [string, string]> = {
    unauth: ["יש להתחבר", "Sign in required"],
    invalid: ["בחירה לא תקינה", "Invalid value"],
    db: ["שגיאת שמירה", "Save failed"],
  };
  return map[code][isHebrew ? 0 : 1];
}
