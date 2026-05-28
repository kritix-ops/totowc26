import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDictionary, hasLocale, type Locale } from "../dictionaries";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { getRequestUser } from "@/lib/request-user";
import { localePath } from "@/lib/paths";
import { BrandLogo } from "@/components/BrandLogo";
import { SignupForm } from "./SignupForm";

export const metadata = {
  title: "הרשמה",
};

export default async function SignupPage({
  params,
  searchParams,
}: PageProps<"/[lang]/signup">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const isHebrew = locale === "he";
  const dict = await getDictionary(locale);

  // Already signed in? Send them where they belong.
  const user = await getRequestUser();
  if (user) redirect(localePath(locale, "onboarding"));

  // /auth/callback forwards anyone who signed in with Google but isn't
  // in the pool yet (no profile row) here, pre-filling email + name
  // from Google so they only need to add a phone.
  const sp = await searchParams;
  const initialEmail = stringParam(sp.email);
  const initialName = stringParam(sp.name);
  const fromGoogle = stringParam(sp.source) === "google";

  // Public-signup toggle. When off, render a closed-signups page instead
  // of the form so the URL stays browsable but inert.
  const [s] = await db
    .select({ open: settings.publicSignupOpen })
    .from(settings)
    .where(eq(settings.id, 1))
    .limit(1);
  const open = s?.open ?? true;

  return (
    <section className="flex items-center justify-center min-h-[calc(100dvh-4rem)] px-4 md:px-16 py-6 md:py-10">
      <div className="w-full max-w-md flex flex-col gap-6 md:gap-10">
        <div className="text-center flex flex-col items-center gap-3">
          <BrandLogo locale={locale} size="hero" />
          <p className="text-base md:text-lg text-on-surface-variant">
            {isHebrew ? "להגשת בקשה להצטרפות" : "Request to join the pool"}
          </p>
        </div>

        {open ? (
          <SignupForm
            locale={locale}
            dict={dict}
            initialName={initialName}
            initialEmail={initialEmail}
            fromGoogle={fromGoogle}
          />
        ) : (
          <ClosedNotice isHebrew={isHebrew} />
        )}

        <p className="text-sm text-on-surface-variant text-center">
          {isHebrew ? "כבר רשום? " : "Already a member? "}
          <a
            href={localePath(locale, "login")}
            className="text-primary underline underline-offset-2"
          >
            {isHebrew ? "להתחברות" : "Sign in"}
          </a>
        </p>
      </div>
    </section>
  );
}

function stringParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function ClosedNotice({ isHebrew }: { isHebrew: boolean }) {
  return (
    <div className="bg-[#FBF6EB] p-6 rounded-lg border border-outline text-center">
      <h2 className="text-lg font-semibold text-on-surface mb-2">
        {isHebrew ? "ההרשמה סגורה כרגע" : "Signups are closed"}
      </h2>
      <p className="text-sm text-on-surface-variant leading-6">
        {isHebrew
          ? "מנהל הקבוצה סגר את ההרשמה. פנה אליו ישירות אם תרצה להצטרף."
          : "The organizer has closed signups. Reach out to them directly to join."}
      </p>
    </div>
  );
}
