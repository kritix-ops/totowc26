"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail, Phone, User, AlertCircle } from "lucide-react";
import { clsx } from "clsx";
import type { Dictionary, Locale } from "../dictionaries";
import { PillButton, LabelCaps } from "@/components/ui";
import { localePath } from "@/lib/paths";
import { submitSignupRequest, type SignupErrorCode } from "./actions";

export function SignupForm({
  locale,
  dict,
  initialName = "",
  initialEmail = "",
  fromGoogle = false,
}: {
  locale: Locale;
  dict: Dictionary;
  initialName?: string;
  initialEmail?: string;
  fromGoogle?: boolean;
}) {
  const isHebrew = locale === "he";
  const router = useRouter();
  const [error, setError] = useState<SignupErrorCode | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (formData: FormData) => {
    setError(null);
    startTransition(async () => {
      const res = await submitSignupRequest(formData);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.replace(localePath(locale, "signup/thanks"));
    });
  };

  return (
    <form
      action={submit}
      className="bg-[#FBF6EB] p-5 md:p-6 rounded-lg border border-outline shadow-[0_8px_24px_rgba(28,20,15,0.08)] flex flex-col gap-5"
    >
      {fromGoogle && (
        <div
          className="rounded-md border border-tertiary bg-tertiary-fixed/40 px-4 py-3 text-sm text-on-tertiary-fixed-variant flex items-start gap-2"
          role="status"
        >
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" strokeWidth={2} />
          <span>
            {isHebrew
              ? "המייל הזה לא רשום בקבוצה. השלם את הטלפון ושלח בקשה — המנהל יאשר ידנית."
              : "This email isn't in the pool yet. Add your phone and submit — admin will approve manually."}
          </span>
        </div>
      )}

      <label className="flex flex-col gap-2">
        <LabelCaps>{dict.forms.signup.displayNameLabel}</LabelCaps>
        <FieldWrap icon={<User className="h-5 w-5 text-outline" strokeWidth={1.5} />}>
          <input
            type="text"
            name="displayName"
            required
            autoComplete="name"
            minLength={2}
            defaultValue={initialName}
            placeholder={dict.forms.signup.displayNamePlaceholder}
            className={clsx(
              "w-full h-12 bg-transparent border-0 focus:outline-none text-[16px] text-on-surface placeholder:text-outline-variant",
              isHebrew ? "text-right pr-9" : "text-left pl-9",
            )}
          />
        </FieldWrap>
      </label>

      <label className="flex flex-col gap-2">
        <LabelCaps>{dict.forms.signup.phoneLabel}</LabelCaps>
        <FieldWrap icon={<Phone className="h-5 w-5 text-outline" strokeWidth={1.5} />}>
          <input
            type="tel"
            name="phone"
            required
            autoComplete="tel"
            inputMode="tel"
            dir="ltr"
            minLength={7}
            placeholder="050-1234567"
            className={clsx(
              "w-full h-12 bg-transparent border-0 focus:outline-none text-[16px] text-on-surface placeholder:text-outline-variant",
              isHebrew ? "text-right pr-9" : "text-left pl-9",
            )}
          />
        </FieldWrap>
      </label>

      <label className="flex flex-col gap-2">
        <LabelCaps>{dict.forms.signup.emailLabel}</LabelCaps>
        <FieldWrap icon={<Mail className="h-5 w-5 text-outline" strokeWidth={1.5} />}>
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            dir="ltr"
            inputMode="email"
            defaultValue={initialEmail}
            placeholder="you@example.com"
            className={clsx(
              "w-full h-12 bg-transparent border-0 focus:outline-none text-[16px] text-on-surface placeholder:text-outline-variant",
              isHebrew ? "text-right pr-9" : "text-left pl-9",
            )}
          />
        </FieldWrap>
      </label>

      {/* Honeypot: hidden from real users via tab-out + aria-hidden +
          autocomplete off. Server rejects any submission where this is
          non-empty. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="hidden"
      />

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
        {pending ? dict.forms.signup.pendingLabel : dict.forms.signup.submitCta}
      </PillButton>

      <p className="text-xs text-on-surface-variant text-center leading-5">
        {dict.forms.signup.footerHint}
      </p>
    </form>
  );
}

function FieldWrap({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="relative border-b border-outline focus-within:border-primary transition-colors">
      <span className="absolute top-1/2 -translate-y-1/2 start-1 pointer-events-none">
        {icon}
      </span>
      {children}
    </div>
  );
}

function translate(code: SignupErrorCode, dict: Dictionary): string {
  return dict.errors.signup[code] ?? dict.errors.signup.unknown;
}
