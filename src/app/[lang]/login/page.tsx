import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDictionary, hasLocale, type Locale } from "../dictionaries";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { getRequestUser } from "@/lib/request-user";
import { localePath } from "@/lib/paths";
import { BrandLogo } from "@/components/BrandLogo";
import { LoginForm } from "./LoginForm";

export default async function LoginPage({
  params,
}: PageProps<"/[lang]/login">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const dict = await getDictionary(locale);
  const isHebrew = locale === "he";

  const user = await getRequestUser();
  if (user) redirect(localePath(locale, "onboarding"));

  // Hide the "request to join" link when the admin has closed signups.
  const [s] = await db
    .select({ open: settings.publicSignupOpen })
    .from(settings)
    .where(eq(settings.id, 1))
    .limit(1);
  const signupOpen = s?.open ?? true;

  return (
    <section className="flex items-center justify-center min-h-[calc(100dvh-4rem)] px-4 md:px-16 py-6 md:py-10">
      <div className="w-full max-w-md flex flex-col gap-6 md:gap-10">
        <div className="text-center flex flex-col items-center gap-3">
          <BrandLogo locale={locale} size="hero" />
        </div>
        <LoginForm locale={locale} dict={dict} />
        {signupOpen && (
          <p className="text-sm text-on-surface-variant text-center">
            {isHebrew ? "עדיין לא רשום? " : "Not a member yet? "}
            <a
              href={localePath(locale, "signup")}
              className="text-primary underline underline-offset-2 font-medium"
            >
              {isHebrew ? "להגיש בקשה ←" : "Request to join →"}
            </a>
          </p>
        )}
      </div>
    </section>
  );
}
