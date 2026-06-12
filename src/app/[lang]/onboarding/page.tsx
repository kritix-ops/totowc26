import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles, payments } from "@/db/schema";
import { getUser } from "@/lib/supabase/auth";
import { getPayboxUrl } from "@/lib/paybox-server";
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

  const payboxUrl = await getPayboxUrl();

  // Operators (admin and live_bets_admin) skip the payment step — they
  // may never play, so we don't want them stuck on the onboarding screen
  // forever. A live_bets_admin who DOES want to place bets will pay
  // through /pay like any player; the bet-write gate requires isPaid
  // regardless of operator role. For players, both profile and payment
  // must be set before they reach the dashboard.
  const profileComplete =
    !!profile && profile.displayName.length >= 2 && profile.phone.length >= 7;
  const isOperator =
    profile?.role === "admin" || profile?.role === "live_bets_admin";
  if (profileComplete && (isOperator || latestPayment?.status === "approved")) {
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
          payboxUrl={payboxUrl}
        />
      </div>
    </section>
  );
}
