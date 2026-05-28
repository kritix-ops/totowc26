"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Mail, Lock, Eye, EyeOff, AlertCircle } from "lucide-react";
import { clsx } from "clsx";
import type { Dictionary, Locale } from "../dictionaries";
import { PillButton, LabelCaps } from "@/components/ui";
import { signIn, signInWithGoogle, type AuthErrorCode } from "./actions";

export function LoginForm({
  locale,
  dict,
}: {
  locale: Locale;
  dict: Dictionary;
}) {
  const isHebrew = locale === "he";
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<AuthErrorCode | null>(null);
  const [pending, startTransition] = useTransition();
  const [googlePending, startGoogleTransition] = useTransition();

  // /auth/callback redirects back to /login?error=<code> when a sign-in
  // attempt fails (expired link, unapproved Google account, etc). Surface
  // that to the user instead of dropping them into a blank form.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const code = searchParams.get("error");
    if (code === "invalid_link") setError("invite_expired");
    else if (code === "not_approved") setError("not_approved");
    else if (code === "oauth_failed") setError("oauth_failed");
  }, [searchParams]);
  /* eslint-enable react-hooks/set-state-in-effect */

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

  const onGoogle = () => {
    setError(null);
    startGoogleTransition(async () => {
      const res = await signInWithGoogle(locale);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      window.location.assign(res.redirectTo);
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
        disabled={pending || googlePending}
        className={clsx("w-full py-4 text-base", pending && "opacity-70 cursor-wait")}
      >
        {pending ? dict.forms.login.pendingLabel : dict.forms.login.submitCta}
      </PillButton>

      <div className="relative my-1">
        <div className="absolute inset-0 flex items-center" aria-hidden>
          <div className="w-full border-t border-outline-variant" />
        </div>
        <div className="relative flex justify-center">
          <span className="bg-[#FBF6EB] px-3 text-xs text-on-surface-variant uppercase tracking-wider">
            {isHebrew ? "או" : "or"}
          </span>
        </div>
      </div>

      <button
        type="button"
        onClick={onGoogle}
        disabled={pending || googlePending}
        className={clsx(
          "press-down min-h-[48px] w-full flex items-center justify-center gap-3 rounded-full border border-outline bg-white text-on-surface text-base font-bold px-6 py-3 hover:bg-surface-container-low transition-colors",
          (pending || googlePending) && "opacity-70 cursor-wait",
        )}
      >
        <GoogleIcon />
        {googlePending
          ? isHebrew
            ? "מפנה לגוגל..."
            : "Redirecting to Google..."
          : isHebrew
            ? "התחבר עם Google"
            : "Sign in with Google"}
      </button>

      <p className="text-xs text-on-surface-variant text-center leading-5">
        {dict.forms.login.footerHint}
      </p>
    </form>
  );
}

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0124 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 01-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
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
