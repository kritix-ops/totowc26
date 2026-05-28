"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock, Eye, EyeOff, AlertCircle, CheckCircle2 } from "lucide-react";
import { clsx } from "clsx";
import type { Locale } from "../dictionaries";
import { PillButton, LabelCaps } from "@/components/ui";
import { setPasswordAction, type SetPasswordResult } from "./actions";

export function SetPasswordForm({ locale }: { locale: Locale }) {
  const isHebrew = locale === "he";
  const router = useRouter();
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<
    Exclude<SetPasswordResult, { ok: true }>["error"] | null
  >(null);
  const [pending, startTransition] = useTransition();

  const submit = (formData: FormData) => {
    setError(null);
    startTransition(async () => {
      const res = await setPasswordAction(locale, formData);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.replace(res.redirectTo);
      router.refresh();
    });
  };

  return (
    <form
      action={submit}
      className="bg-[#FBF6EB] p-5 md:p-6 rounded-lg border border-outline shadow-[0_8px_24px_rgba(28,20,15,0.08)] flex flex-col gap-5"
    >
      <label className="flex flex-col gap-2">
        <LabelCaps>{isHebrew ? "סיסמה חדשה" : "New password"}</LabelCaps>
        <FieldWrap isHebrew={isHebrew} icon={<Lock className="h-5 w-5 text-outline" strokeWidth={1.5} />}>
          <input
            type={showPw ? "text" : "password"}
            name="password"
            required
            minLength={12}
            autoComplete="new-password"
            dir="ltr"
            placeholder={
              isHebrew
                ? "לפחות 12 תווים, אותיות וספרות"
                : "At least 12 characters, letters and numbers"
            }
            className={clsx(
              "w-full h-12 bg-transparent border-0 focus:outline-none text-[16px] text-on-surface placeholder:text-outline-variant",
              isHebrew ? "text-right pr-9 pl-10" : "text-left pl-9 pr-10",
            )}
          />
          <button
            type="button"
            onClick={() => setShowPw((v) => !v)}
            aria-label={showPw ? (isHebrew ? "הסתר" : "Hide") : (isHebrew ? "הצג" : "Show")}
            className={clsx(
              "absolute top-1/2 -translate-y-1/2 min-w-[44px] min-h-[44px] flex items-center justify-center text-outline hover:text-on-surface",
              isHebrew ? "left-0" : "right-0",
            )}
          >
            {showPw ? <EyeOff className="h-5 w-5" strokeWidth={1.5} /> : <Eye className="h-5 w-5" strokeWidth={1.5} />}
          </button>
        </FieldWrap>
      </label>

      <label className="flex flex-col gap-2">
        <LabelCaps>{isHebrew ? "אישור סיסמה" : "Confirm password"}</LabelCaps>
        <FieldWrap isHebrew={isHebrew} icon={<CheckCircle2 className="h-5 w-5 text-outline" strokeWidth={1.5} />}>
          <input
            type={showPw ? "text" : "password"}
            name="confirm"
            required
            minLength={12}
            autoComplete="new-password"
            dir="ltr"
            placeholder={isHebrew ? "הקלד שוב" : "Type it again"}
            className={clsx(
              "w-full h-12 bg-transparent border-0 focus:outline-none text-[16px] text-on-surface placeholder:text-outline-variant",
              isHebrew ? "text-right pr-9" : "text-left pl-9",
            )}
          />
        </FieldWrap>
      </label>

      {error && (
        <p className="inline-flex items-start gap-2 text-sm text-error">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" strokeWidth={2} />
          <span>{translate(error, isHebrew)}</span>
        </p>
      )}

      <PillButton
        type="submit"
        disabled={pending}
        className={clsx("w-full py-4 text-base", pending && "opacity-70 cursor-wait")}
      >
        {pending ? (isHebrew ? "שומר..." : "Saving...") : (isHebrew ? "שמור והמשך" : "Save and continue")}
      </PillButton>
    </form>
  );
}

function FieldWrap({
  isHebrew,
  icon,
  children,
}: {
  isHebrew: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="relative border-b border-outline focus-within:border-primary transition-colors">
      <span
        className={clsx(
          "absolute top-1/2 -translate-y-1/2 pointer-events-none",
          isHebrew ? "right-1" : "left-1",
        )}
      >
        {icon}
      </span>
      {children}
    </div>
  );
}

function translate(
  code: Exclude<SetPasswordResult, { ok: true }>["error"],
  isHebrew: boolean,
): string {
  const map: Record<string, [string, string]> = {
    weak: [
      "הסיסמה חייבת לכלול לפחות 12 תווים, אותיות וספרות",
      "Password must be 12+ characters with letters and numbers",
    ],
    mismatch: ["הסיסמאות לא תואמות", "Passwords do not match"],
    unauth: [
      "פג תוקף ההזמנה. בקש מהמנהל לשלוח קישור חדש",
      "Invite expired. Ask the organizer to re-send the link",
    ],
    unknown: ["שגיאה לא צפויה", "Something went wrong"],
  };
  return map[code][isHebrew ? 0 : 1];
}
