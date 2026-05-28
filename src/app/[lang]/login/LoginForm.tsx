"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail, Lock, Eye, EyeOff, AlertCircle } from "lucide-react";
import { clsx } from "clsx";
import type { Dictionary, Locale } from "../dictionaries";
import { PillButton, LabelCaps } from "@/components/ui";
import { signIn, type AuthErrorCode } from "./actions";

export function LoginForm({
  locale,
  dict: _dict,
}: {
  locale: Locale;
  dict: Dictionary;
}) {
  const isHebrew = locale === "he";
  const router = useRouter();
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<AuthErrorCode | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (formData: FormData) => {
    setError(null);
    startTransition(async () => {
      const res = await signIn(locale, formData);
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
        <LabelCaps>{isHebrew ? "מייל" : "Email"}</LabelCaps>
        <FieldWrap isHebrew={isHebrew} icon={<Mail className="h-5 w-5 text-outline" strokeWidth={1.5} />}>
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            dir="ltr"
            inputMode="email"
            placeholder="you@example.com"
            className={clsx(
              "w-full h-12 bg-transparent border-0 focus:outline-none text-[16px] text-on-surface placeholder:text-outline-variant",
              isHebrew ? "text-right pr-9" : "text-left pl-9",
            )}
          />
        </FieldWrap>
      </label>

      <label className="flex flex-col gap-2">
        <LabelCaps>{isHebrew ? "סיסמה" : "Password"}</LabelCaps>
        <FieldWrap isHebrew={isHebrew} icon={<Lock className="h-5 w-5 text-outline" strokeWidth={1.5} />}>
          <input
            type={showPw ? "text" : "password"}
            name="password"
            required
            autoComplete="current-password"
            dir="ltr"
            placeholder="••••••••"
            className={clsx(
              "w-full h-12 bg-transparent border-0 focus:outline-none text-[16px] text-on-surface placeholder:text-outline-variant",
              isHebrew ? "text-right pr-9 pl-10" : "text-left pl-9 pr-10",
            )}
          />
          <button
            type="button"
            onClick={() => setShowPw((v) => !v)}
            aria-label={showPw ? (isHebrew ? "הסתר סיסמה" : "Hide password") : (isHebrew ? "הצג סיסמה" : "Show password")}
            className={clsx(
              "absolute top-1/2 -translate-y-1/2 min-w-[44px] min-h-[44px] flex items-center justify-center text-outline hover:text-on-surface",
              isHebrew ? "left-0" : "right-0",
            )}
          >
            {showPw ? <EyeOff className="h-5 w-5" strokeWidth={1.5} /> : <Eye className="h-5 w-5" strokeWidth={1.5} />}
          </button>
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
        {pending ? (isHebrew ? "טוען..." : "Loading...") : (isHebrew ? "התחבר" : "Sign in")}
      </PillButton>

      <p className="text-xs text-on-surface-variant text-center leading-5">
        {isHebrew
          ? "טוטו חברים. אם אין לך עדיין חשבון, אפשר להגיש בקשה ומנהל הקבוצה יאשר."
          : "Friends only pool. If you do not have an account yet, request to join and the organizer will approve."}
      </p>
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

function translate(code: AuthErrorCode, isHebrew: boolean): string {
  const map: Record<AuthErrorCode, [string, string]> = {
    invalid_email: ["כתובת מייל לא תקינה", "Invalid email"],
    weak_password: [
      "הסיסמה חייבת לכלול לפחות 12 תווים, אותיות וספרות",
      "Password must be 12+ characters with letters and numbers",
    ],
    invalid_credentials: [
      "מייל או סיסמה שגויים. אם זו ההתחברות הראשונה שלך, השתמש בקישור ההזמנה",
      "Wrong email or password. First time? Use your invite link",
    ],
    email_taken: ["המייל כבר רשום", "This email is already registered"],
    rate_limit: ["יותר מדי ניסיונות. נסה בעוד דקה", "Too many attempts. Try again in a minute"],
    email_not_confirmed: ["יש לאשר את המייל", "Email confirmation required"],
    unknown: ["שגיאה לא צפויה", "Something went wrong"],
  };
  return map[code][isHebrew ? 0 : 1];
}
