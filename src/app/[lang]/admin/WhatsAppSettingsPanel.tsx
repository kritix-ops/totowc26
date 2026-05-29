"use client";

import { useState } from "react";
import {
  ExternalLink,
  Check,
  AlertCircle,
  Trash2,
  Save,
  Link2,
  EyeOff,
} from "lucide-react";
import { clsx } from "clsx";
import type { Locale } from "../dictionaries";
import { Card, LabelCaps, SectionHeading } from "@/components/ui";
import { usePendingAction } from "@/lib/use-pending-action";
import {
  setWhatsAppGroupUrl,
  type SetWhatsAppGroupUrlResult,
} from "./whatsapp-actions";

// Admin editor for the pool's WhatsApp group invite. Unlike the Paybox
// editor there is no hard-coded fallback - clearing the field hides the
// card on the profile page entirely, which is the right behavior if
// the admin rotates the group invite and doesn't have a new URL yet.
export function WhatsAppSettingsPanel({
  locale,
  current,
}: {
  locale: Locale;
  current: string | null;
}) {
  const isHebrew = locale === "he";
  const [value, setValue] = useState(current ?? "");
  const [error, setError] = useState<
    Exclude<SetWhatsAppGroupUrlResult, { ok: true }>["error"] | null
  >(null);
  const [saved, setSaved] = useState(false);
  const { pending, run } = usePendingAction();

  const dirty = (value.trim() || null) !== (current ?? null);
  const effective = value.trim();
  const hidden = !effective;

  const submit = (next: string) => {
    setError(null);
    setSaved(false);
    // usePendingAction clears the button on the action response, not on
    // setWhatsAppGroupUrl's revalidation re-render.
    void run(async () => {
      const res = await setWhatsAppGroupUrl(next);
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
            {isHebrew ? "קישור קבוצת וואטסאפ" : "WhatsApp group link"}
          </SectionHeading>
          <p className="text-sm text-on-surface-variant">
            {isHebrew
              ? "מופיע על עמוד הפרופיל של כל שחקן. שינוי כאן מתעדכן מיד אצל כולם - בלי פריסה. נקה את השדה כדי להסתיר את הכרטיס."
              : "Shows up on every player's profile page. Edit and save here - takes effect immediately without a redeploy. Clear the field to hide the card."}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <LabelCaps>URL</LabelCaps>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="url"
            inputMode="url"
            dir="ltr"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="https://chat.whatsapp.com/..."
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
        {hidden ? (
          <EyeOff
            className="h-4 w-4 mt-0.5 text-on-surface-variant shrink-0"
            strokeWidth={2}
          />
        ) : (
          <Link2
            className="h-4 w-4 mt-0.5 text-on-surface-variant shrink-0"
            strokeWidth={2}
          />
        )}
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <LabelCaps>
            {hidden
              ? isHebrew ? "הכרטיס מוסתר" : "Card hidden"
              : isHebrew ? "קישור פעיל כעת" : "Currently active"}
          </LabelCaps>
          {hidden ? (
            <span className="text-sm text-on-surface-variant">
              {isHebrew
                ? "הזן קישור כדי שהמשתתפים יראו את כרטיס ההזמנה."
                : "Fill in a URL to show the invite card to players."}
            </span>
          ) : (
            <a
              href={effective}
              target="_blank"
              rel="noopener noreferrer"
              dir="ltr"
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline truncate"
            >
              <span className="truncate">{effective}</span>
              <ExternalLink
                className="h-3.5 w-3.5 shrink-0"
                strokeWidth={2}
              />
            </a>
          )}
        </div>
        {!hidden && (
          <button
            type="button"
            onClick={handleClear}
            disabled={pending}
            aria-label={isHebrew ? "הסתר כרטיס" : "Hide card"}
            className={clsx(
              "press-down inline-flex items-center justify-center gap-1.5 min-h-[36px] px-3 rounded-full bg-surface text-on-surface-variant border border-outline-variant text-xs font-bold hover:bg-surface-container transition-colors shrink-0",
              pending && "opacity-60 cursor-not-allowed",
            )}
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
            {isHebrew ? "נקה" : "Clear"}
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
  code: Exclude<SetWhatsAppGroupUrlResult, { ok: true }>["error"],
  isHebrew: boolean,
): string {
  const map: Record<string, [string, string]> = {
    unauth: ["יש להתחבר", "Sign in required"],
    forbidden: ["אין הרשאה", "Not allowed"],
    invalid: [
      "קישור לא תקין. חייב להיות מ-chat.whatsapp.com ולהתחיל ב-https://",
      "Invalid URL. Must be a chat.whatsapp.com link starting with https://",
    ],
    db: ["שגיאת שמירה", "Save failed"],
  };
  return map[code][isHebrew ? 0 : 1];
}
