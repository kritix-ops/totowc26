import { notFound } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { hasLocale, type Locale } from "../../dictionaries";
import { localePath } from "@/lib/paths";
import { BrandLogo } from "@/components/BrandLogo";

export const metadata = {
  title: "תודה",
};

export default async function SignupThanksPage({
  params,
}: PageProps<"/[lang]/signup/thanks">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const isHebrew = locale === "he";

  return (
    <section className="flex items-center justify-center min-h-[calc(100dvh-4rem)] px-4 md:px-16 py-6 md:py-10">
      <div className="w-full max-w-md flex flex-col items-center gap-6 text-center">
        <BrandLogo locale={locale} size="hero" />

        <CheckCircle2
          className="h-16 w-16 text-secondary"
          strokeWidth={1.5}
          aria-hidden="true"
        />

        <div className="flex flex-col gap-3">
          <h1 className="text-2xl font-semibold text-on-surface">
            {isHebrew ? "תודה, קיבלנו את הבקשה" : "Thanks - we got your request"}
          </h1>
          <p className="text-base text-on-surface-variant leading-7">
            {isHebrew
              ? "מנהל הקבוצה יעבור על הבקשה ויחזור אליך במייל ברגע שתאושר. אין צורך לעשות שום דבר נוסף."
              : "The organizer will review your request and email you once it is approved. Nothing else for you to do right now."}
          </p>
        </div>

        <a
          href={localePath(locale, "login")}
          className="text-sm text-primary underline underline-offset-2"
        >
          {isHebrew ? "חזרה למסך הכניסה" : "Back to sign in"}
        </a>
      </div>
    </section>
  );
}
