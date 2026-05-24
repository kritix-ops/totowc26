import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles, payments } from "@/db/schema";
import { getUser } from "@/lib/supabase/auth";
import { localePath } from "@/lib/paths";
import { getDictionary, hasLocale, type Locale } from "../dictionaries";
import { BrandLogo } from "@/components/BrandLogo";
import { OnboardingForm } from "./OnboardingForm";

export default async function OnboardingPage({
  params,
}: PageProps<"/[lang]/onboarding">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const dict = await getDictionary(locale);

  const user = await getUser();
  if (!user) redirect(localePath(locale, "login"));

  // Load current profile + latest payment.
  const [profile] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.id, user.id))
    .limit(1);

  const [latestPayment] = await db
    .select()
    .from(payments)
    .where(eq(payments.userId, user.id))
    .limit(1);

  // Admins skip the payment step. For players, both profile and payment must
  // be set before they reach the dashboard.
  const profileComplete =
    !!profile && profile.displayName.length >= 2 && profile.phone.length >= 7;
  const isAdmin = profile?.role === "admin";
  if (profileComplete && (isAdmin || latestPayment?.status === "approved")) {
    redirect(localePath(locale));
  }

  return (
    <section className="flex items-center justify-center min-h-[calc(100dvh-4rem)] px-4 md:px-16 py-6 md:py-10">
      <div className="w-full max-w-md flex flex-col gap-6 md:gap-10">
        <div className="text-center flex flex-col items-center gap-3">
          <BrandLogo locale={locale} size="hero" />
          <p className="text-base md:text-lg text-on-surface-variant">
            {dict.onboarding.title}
          </p>
          <p className="text-sm md:text-base text-on-surface-variant">
            {dict.onboarding.subtitle}
          </p>
        </div>

        <OnboardingForm
          locale={locale}
          dict={dict}
          initialName={profile?.displayName ?? ""}
          initialPhone={profile?.phone ?? user.phone ?? ""}
          paymentStatus={latestPayment?.status ?? null}
          paymentMethod={latestPayment?.method ?? null}
        />
      </div>
    </section>
  );
}
