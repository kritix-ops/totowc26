import { notFound, redirect } from "next/navigation";
import { getDictionary, hasLocale, type Locale } from "../dictionaries";
import { getUser } from "@/lib/supabase/auth";
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

  const user = await getUser();
  if (user) redirect(localePath(locale, "onboarding"));

  return (
    <section className="flex items-center justify-center min-h-[calc(100dvh-4rem)] px-4 md:px-16 py-6 md:py-10">
      <div className="w-full max-w-md flex flex-col gap-6 md:gap-10">
        <div className="text-center flex flex-col items-center gap-3">
          <BrandLogo locale={locale} size="hero" />
          <p className="text-base md:text-lg text-on-surface-variant">
            {dict.landing.tagline}
          </p>
        </div>
        <LoginForm locale={locale} dict={dict} />
      </div>
    </section>
  );
}
