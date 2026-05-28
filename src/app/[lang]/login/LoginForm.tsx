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
  dict,
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
        <LabelCaps>{dict.forms.login.emailLabel}</LabelCaps>
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
        <LabelCaps>{dict.forms.login.passwordLabel}</LabelCaps>
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
            aria-label={showPw ? dict.forms.login.hidePassword : dict.forms.login.showPassword}
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
          <span>{translate(error, dict)}</span>
        </p>
      )}

      <PillButton
        type="submit"
        disabled={pending}
        className={clsx("w-full py-4 text-base", pending && "opacity-70 cursor-wait")}
      >
        {pending ? dict.forms.login.pendingLabel : dict.forms.login.submitCta}
      </PillButton>

      <p className="text-xs text-on-surface-variant text-center leading-5">
        {dict.forms.login.footerHint}
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

function translate(code: AuthErrorCode, dict: Dictionary): string {
  return dict.errors.auth[code] ?? dict.errors.auth.unknown;
}
