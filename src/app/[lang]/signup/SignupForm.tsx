"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail, Phone, User, AlertCircle } from "lucide-react";
import { clsx } from "clsx";
import type { Locale } from "../dictionaries";
import { PillButton, LabelCaps } from "@/components/ui";
import { localePath } from "@/lib/paths";
import { submitSignupRequest, type SignupErrorCode } from "./actions";

export function SignupForm({ locale }: { locale: Locale }) {
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
      <label className="flex flex-col gap-2">
        <LabelCaps>{isHebrew ? "שם להצגה" : "Display name"}</LabelCaps>
        <FieldWrap isHebrew={isHebrew} icon={<User className="h-5 w-5 text-outline" strokeWidth={1.5} />}>
          <input
            type="text"
            name="displayName"
            required
            autoComplete="name"
            minLength={2}
            placeholder={isHebrew ? "השם שיופיע בטבלה" : "Name shown on the leaderboard"}
            className={clsx(
              "w-full h-12 bg-transparent border-0 focus:outline-none text-[16px] text-on-surface placeholder:text-outline-variant",
              isHebrew ? "text-right pr-9" : "text-left pl-9",
            )}
          />
        </FieldWrap>
      </label>

      <label className="flex flex-col gap-2">
        <LabelCaps>{isHebrew ? "טלפון" : "Phone"}</LabelCaps>
        <FieldWrap isHebrew={isHebrew} icon={<Phone className="h-5 w-5 text-outline" strokeWidth={1.5} />}>
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
          <span>{translate(error, isHebrew)}</span>
        </p>
      )}

      <PillButton
        type="submit"
        disabled={pending}
        className={clsx("w-full py-4 text-base", pending && "opacity-70 cursor-wait")}
      >
        {pending
          ? isHebrew
            ? "שולח..."
            : "Sending..."
          : isHebrew
          ? "להגיש בקשה"
          : "Request to join"}
      </PillButton>

      <p className="text-xs text-on-surface-variant text-center leading-5">
        {isHebrew
          ? "הבקשה תאושר ידנית על ידי המנהל. תקבל מייל אישור בהמשך עם קישור להתחברות."
          : "Each request is reviewed by the organizer. You will get an approval email with a sign-in link."}
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

function translate(code: SignupErrorCode, isHebrew: boolean): string {
  const map: Record<SignupErrorCode, [string, string]> = {
    invalid: [
      "אחד מהפרטים לא תקין. בדוק שם, טלפון ומייל",
      "One of the fields is invalid. Check name, phone, and email",
    ],
    duplicate: [
      "כבר הגשת בקשה לטוטו, נחזור אליך בקרוב",
      "You already have a request on file. We will get back to you",
    ],
    rate_limited: [
      "יותר מדי ניסיונות. נסה שוב בעוד שעה",
      "Too many attempts. Try again in an hour",
    ],
    closed: [
      "ההרשמה סגורה כרגע. פנה למנהל הקבוצה",
      "Signups are closed right now. Contact the organizer",
    ],
    unknown: ["משהו השתבש. נסה שוב בעוד דקה", "Something went wrong. Try again in a minute"],
  };
  return map[code][isHebrew ? 0 : 1];
}
