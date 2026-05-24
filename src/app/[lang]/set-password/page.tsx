import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { getUser } from "@/lib/supabase/auth";
import { localePath } from "@/lib/paths";
import { hasLocale, type Locale } from "../dictionaries";
import { BrandLogo } from "@/components/BrandLogo";
import { SetPasswordForm } from "./SetPasswordForm";

export default async function SetPasswordPage({
  params,
}: PageProps<"/[lang]/set-password">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;

  const user = await getUser();
  if (!user) redirect(localePath(locale, "login"));

  const [profile] = await db
    .select({ displayName: profiles.displayName })
    .from(profiles)
    .where(eq(profiles.id, user.id))
    .limit(1);

  const isHebrew = locale === "he";
  const displayFont = isHebrew
    ? "font-[family-name:var(--font-display)]"
    : "font-[family-name:var(--font-display-en)]";

  return (
    <section className="flex items-center justify-center min-h-[calc(100dvh-4rem)] px-4 md:px-16 py-6 md:py-10">
      <div className="w-full max-w-md flex flex-col gap-6 md:gap-10">
        <div className="text-center flex flex-col items-center gap-3">
          <BrandLogo locale={locale} size="hero" />
          <h1
            className={`${displayFont} text-xl md:text-2xl font-bold text-on-surface mt-2`}
          >
            {isHebrew ? `שלום, ${profile?.displayName ?? ""}` : `Welcome, ${profile?.displayName ?? ""}`}
          </h1>
          <p className="text-sm md:text-base text-on-surface-variant">
            {isHebrew
              ? "בחר סיסמה כדי לסיים את ההצטרפות לטוטו"
              : "Choose a password to finish joining the pool"}
          </p>
        </div>
        <SetPasswordForm locale={locale} />
      </div>
    </section>
  );
}
