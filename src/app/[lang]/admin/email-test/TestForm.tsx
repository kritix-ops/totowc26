"use client";

import { useState, useTransition } from "react";
import { AlertCircle, Check, Send } from "lucide-react";
import { clsx } from "clsx";
import type { Locale } from "../../dictionaries";
import { Card, LabelCaps, SectionHeading } from "@/components/ui";
import {
  sendTestEmail,
  type EmailTemplate,
  type EnvSummary,
  type SendTestEmailResult,
} from "./actions";

const TEMPLATES: { value: EmailTemplate; he: string; en: string }[] = [
  { value: "admin_notification", he: "התראת אדמין", en: "Admin notification" },
  { value: "user_confirmation", he: "אישור קבלת בקשה", en: "User confirmation" },
  { value: "user_approval", he: "אישור הצטרפות", en: "User approval" },
];

export function TestForm({
  locale,
  defaultTo,
  initialEnv,
}: {
  locale: Locale;
  defaultTo: string;
  initialEnv: EnvSummary;
}) {
  const isHebrew = locale === "he";
  const [to, setTo] = useState(defaultTo);
  const [template, setTemplate] = useState<EmailTemplate>("user_confirmation");
  const [result, setResult] = useState<SendTestEmailResult | null>(null);
  const [pending, startTransition] = useTransition();

  const env = result?.env ?? initialEnv;
  const canSend = env.resendApiKey === "set" && !!env.emailFrom;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setResult(null);
    startTransition(async () => {
      const res = await sendTestEmail(to, template);
      setResult(res);
    });
  };

  return (
    <Card className="p-5 md:p-6 flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <SectionHeading as="h2" underline="thin">
          {isHebrew ? "שליחת אימייל בדיקה" : "Send test email"}
        </SectionHeading>
        <p className="text-sm text-on-surface-variant">
          {isHebrew
            ? "שולח אימייל אמיתי דרך Resend עם אחת מתבניות האימייל של המערכת. נתוני הבדיקה הם דמה — שום שורה לא נכתבת ל-DB."
            : "Sends a real email through Resend using one of the system templates. The sample data is fake — no DB rows are written."}
        </p>
      </header>

      <EnvStatus env={env} isHebrew={isHebrew} />

      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <LabelCaps as="div">
            {isHebrew ? "נמען" : "Recipient"}
          </LabelCaps>
          <input
            type="email"
            inputMode="email"
            dir="ltr"
            required
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="you@example.com"
            className="h-12 px-4 rounded-lg bg-surface-container-lowest border border-outline focus:border-primary focus:outline-none text-base text-on-surface placeholder:text-outline-variant text-left"
          />
        </div>

        <div className="flex flex-col gap-2">
          <LabelCaps as="div">
            {isHebrew ? "תבנית" : "Template"}
          </LabelCaps>
          <select
            value={template}
            onChange={(e) => setTemplate(e.target.value as EmailTemplate)}
            className="h-12 px-3 rounded-lg bg-surface-container-lowest border border-outline focus:border-primary focus:outline-none text-base text-on-surface"
          >
            {TEMPLATES.map((t) => (
              <option key={t.value} value={t.value}>
                {isHebrew ? t.he : t.en}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          disabled={pending || !canSend}
          className={clsx(
            "press-down self-start inline-flex items-center justify-center gap-2 min-h-[48px] px-6 rounded-full bg-primary text-on-primary font-[family-name:var(--font-label)] text-[13px] font-bold tracking-[0.05em] hover:bg-surface-tint transition-colors",
            (pending || !canSend) && "opacity-60 cursor-not-allowed",
          )}
        >
          <Send className="h-4 w-4" strokeWidth={2.25} />
          {pending
            ? isHebrew
              ? "שולח..."
              : "Sending..."
            : isHebrew
              ? "שלח אימייל בדיקה"
              : "Send test email"}
        </button>
      </form>

      {result?.ok && (
        <div className="flex items-start gap-3 p-4 rounded-lg bg-secondary-container border border-secondary-fixed">
          <Check
            className="h-5 w-5 mt-0.5 text-on-secondary-container shrink-0"
            strokeWidth={2.5}
          />
          <div className="flex flex-col gap-1 min-w-0 text-on-secondary-container">
            <p className="font-bold text-sm">
              {isHebrew ? "נשלח בהצלחה" : "Sent successfully"}
            </p>
            <p className="text-xs">
              <span className="font-bold">
                {isHebrew ? "מזהה הודעה: " : "Message id: "}
              </span>
              <span dir="ltr" className="font-mono break-all">
                {result.messageId}
              </span>
            </p>
            <p className="text-xs opacity-80">
              {isHebrew
                ? "בדוק את תיבת הדואר של הנמען (כולל ספאם) ואת לוח הבקרה של Resend."
                : "Check the recipient's inbox (including spam) and the Resend dashboard."}
            </p>
          </div>
        </div>
      )}

      {result && !result.ok && (
        <div className="flex items-start gap-3 p-4 rounded-lg bg-error-container border border-error">
          <AlertCircle
            className="h-5 w-5 mt-0.5 text-on-error-container shrink-0"
            strokeWidth={2.5}
          />
          <div className="flex flex-col gap-1 min-w-0 text-on-error-container">
            <p className="font-bold text-sm">{translateError(result.error, isHebrew)}</p>
            {result.detail && (
              <p className="text-xs font-mono break-all">{result.detail}</p>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function EnvStatus({ env, isHebrew }: { env: EnvSummary; isHebrew: boolean }) {
  const rows: { label: string; value: string; ok: boolean }[] = [
    {
      label: "RESEND_API_KEY",
      value: env.resendApiKey === "set" ? (isHebrew ? "מוגדר" : "set") : (isHebrew ? "חסר" : "missing"),
      ok: env.resendApiKey === "set",
    },
    {
      label: "EMAIL_FROM",
      value: env.emailFrom ?? (isHebrew ? "חסר" : "missing"),
      ok: !!env.emailFrom,
    },
    {
      label: "EMAIL_REPLY_TO",
      value: env.emailReplyTo ?? (isHebrew ? "לא מוגדר (לא חובה)" : "not set (optional)"),
      ok: true,
    },
    {
      label: "ADMIN_NOTIFICATION_EMAIL",
      value:
        env.adminNotificationEmail ??
        (isHebrew ? "לא מוגדר (לא חובה)" : "not set (optional)"),
      ok: true,
    },
  ];

  return (
    <div className="flex flex-col gap-2 p-4 rounded-lg bg-surface-container-low border border-outline-variant">
      <LabelCaps>{isHebrew ? "תצורת אימייל" : "Email configuration"}</LabelCaps>
      <ul className="flex flex-col gap-1.5">
        {rows.map((r) => (
          <li
            key={r.label}
            className="flex items-center justify-between gap-3 text-xs"
          >
            <span dir="ltr" className="font-mono font-bold text-on-surface">
              {r.label}
            </span>
            <span
              dir="ltr"
              className={clsx(
                "font-mono truncate text-left",
                r.ok ? "text-on-surface-variant" : "text-error",
              )}
            >
              {r.value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function translateError(
  code: Exclude<SendTestEmailResult, { ok: true }>["error"],
  isHebrew: boolean,
): string {
  const map: Record<typeof code, [string, string]> = {
    unauthorized: ["יש להתחבר", "Sign in required"],
    forbidden: ["אין הרשאה", "Not allowed"],
    invalid_email: ["כתובת אימייל לא תקינה", "Invalid email address"],
    not_configured: [
      "Resend לא מוגדר — חסר RESEND_API_KEY או EMAIL_FROM",
      "Resend is not configured — RESEND_API_KEY or EMAIL_FROM missing",
    ],
    send_failed: ["השליחה נכשלה — בדוק את ההודעה למטה", "Send failed — see detail below"],
  };
  return map[code][isHebrew ? 0 : 1];
}
