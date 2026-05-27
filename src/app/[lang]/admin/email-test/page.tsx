import { notFound } from "next/navigation";
import { hasLocale, type Locale } from "../../dictionaries";
import { getRequestUser } from "@/lib/request-user";
import { TestForm } from "./TestForm";

export default async function EmailTestPage({
  params,
}: PageProps<"/[lang]/admin/email-test">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const isHebrew = locale === "he";

  // Admin gate already enforced by /[lang]/admin/layout.tsx → requireAdmin.
  const user = await getRequestUser();
  const defaultTo = user?.email ?? "";

  const initialEnv = {
    resendApiKey: (process.env.RESEND_API_KEY ? "set" : "missing") as
      | "set"
      | "missing",
    emailFrom: process.env.EMAIL_FROM ?? null,
    emailReplyTo: process.env.EMAIL_REPLY_TO ?? null,
    adminNotificationEmail: process.env.ADMIN_NOTIFICATION_EMAIL ?? null,
  };

  return (
    <section className="px-4 md:px-16 py-6 md:py-12 flex flex-col gap-6 md:gap-8 max-w-3xl mx-auto w-full">
      <header className="flex flex-col gap-2">
        <h1 className="font-[family-name:var(--font-display)] text-[26px] leading-9 md:text-[40px] md:leading-[44px] font-bold text-primary">
          {isHebrew ? "בדיקת שליחת אימייל" : "Email send test"}
        </h1>
        <p className="text-sm md:text-base text-on-surface-variant">
          {isHebrew
            ? "מסלול בדיקה מהיר לוודא ש-Resend ו-DNS מוגדרים נכון. בחר תבנית, הזן כתובת ושלח."
            : "Quick smoke test to confirm Resend + DNS are wired correctly. Pick a template, enter an address, send."}
        </p>
      </header>

      <TestForm
        locale={locale}
        defaultTo={defaultTo}
        initialEnv={initialEnv}
      />
    </section>
  );
}
