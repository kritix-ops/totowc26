import Link from "next/link";
import { AlertCircle, ArrowLeft, ShieldCheck } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import type { Locale } from "@/app/[lang]/dictionaries";
import { confirmAuthAction } from "./actions";
import { ConfirmSubmitButton } from "./ConfirmSubmitButton";

// Intermediate confirm page for admin-issued auth links (recovery, invite,
// magiclink). The page itself only renders — it does NOT call verifyOtp.
// That call happens in the server action wired to the form below, which
// is POST-only, so link-preview crawlers that GET the page cannot burn
// the one-time Supabase token.
//
// See src/lib/supabase/auth.ts → buildAuthConfirmUrl for the why.

type RawSearchParams = Record<string, string | string[] | undefined>;

export const dynamic = "force-dynamic";

export default async function AuthConfirmPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const sp = await searchParams;
  const tokenHash = pickFirst(sp.token_hash);
  const type = pickFirst(sp.type);
  const next = pickFirst(sp.next) ?? "/he/onboarding";
  const locale: Locale = next.startsWith("/en/") ? "en" : "he";

  const valid =
    typeof tokenHash === "string" &&
    tokenHash.length > 0 &&
    type !== undefined &&
    (type === "recovery" || type === "invite" || type === "magiclink");

  if (!valid) {
    return <InvalidLinkScreen locale={locale} />;
  }

  return <ConfirmScreen locale={locale} tokenHash={tokenHash} type={type} next={next} />;
}

function pickFirst(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function ConfirmScreen({
  locale,
  tokenHash,
  type,
  next,
}: {
  locale: Locale;
  tokenHash: string;
  type: string;
  next: string;
}) {
  const isHebrew = locale === "he";
  const displayFont = isHebrew
    ? "font-[family-name:var(--font-display)]"
    : "font-[family-name:var(--font-display-en)]";

  const heading =
    type === "recovery"
      ? isHebrew
        ? "איפוס הסיסמה שלך"
        : "Reset your password"
      : isHebrew
        ? "אישור הכניסה לטוטו"
        : "Confirm your sign-in";

  const body =
    type === "recovery"
      ? isHebrew
        ? "לחץ על הכפתור כדי להמשיך לבחירת סיסמה חדשה. הקישור חד-פעמי, אז המשך רק אם זה אתה."
        : "Tap the button to continue and choose a new password. The link is single-use, so only continue if this is you."
      : isHebrew
        ? "לחץ על הכפתור כדי להמשיך לטוטו מונדיאל. הקישור חד-פעמי, אז המשך רק אם זה אתה."
        : "Tap the button to continue to Toto Mundial. The link is single-use, so only continue if this is you.";

  return (
    <section className="flex items-center justify-center min-h-[calc(100dvh-4rem)] px-4 md:px-16 py-8 md:py-12">
      <div className="w-full max-w-md flex flex-col gap-8 items-center text-center">
        <BrandLogo locale={locale} size="hero" />
        <div className="flex flex-col items-center gap-3">
          <div className="w-14 h-14 rounded-full bg-secondary-container flex items-center justify-center">
            <ShieldCheck className="h-7 w-7 text-secondary" strokeWidth={2} />
          </div>
          <h1 className={`${displayFont} text-2xl md:text-3xl font-bold text-on-surface`}>
            {heading}
          </h1>
          <p className="text-sm md:text-base text-on-surface-variant leading-relaxed max-w-[28ch]">
            {body}
          </p>
        </div>

        <form
          action={confirmAuthAction}
          className="w-full bg-[#FBF6EB] p-5 md:p-6 rounded-lg border border-outline shadow-[0_8px_24px_rgba(28,20,15,0.08)] flex flex-col gap-4"
        >
          <input type="hidden" name="token_hash" value={tokenHash} />
          <input type="hidden" name="type" value={type} />
          <input type="hidden" name="next" value={next} />
          <ConfirmSubmitButton locale={locale} type={type} />
          <p className="text-xs text-on-surface-variant text-center leading-5">
            {isHebrew
              ? "אם לא ביקשת קישור, אפשר להתעלם מההודעה."
              : "If you did not request this link, you can safely ignore the message."}
          </p>
        </form>
      </div>
    </section>
  );
}

function InvalidLinkScreen({ locale }: { locale: Locale }) {
  const isHebrew = locale === "he";
  const displayFont = isHebrew
    ? "font-[family-name:var(--font-display)]"
    : "font-[family-name:var(--font-display-en)]";
  return (
    <section className="flex items-center justify-center min-h-[calc(100dvh-4rem)] px-4 md:px-16 py-8 md:py-12">
      <div className="w-full max-w-md flex flex-col gap-6 items-center text-center">
        <BrandLogo locale={locale} size="hero" />
        <div className="w-14 h-14 rounded-full bg-error-container flex items-center justify-center">
          <AlertCircle className="h-7 w-7 text-error" strokeWidth={2} />
        </div>
        <h1 className={`${displayFont} text-2xl md:text-3xl font-bold text-on-surface`}>
          {isHebrew ? "קישור לא תקין" : "Invalid link"}
        </h1>
        <p className="text-sm md:text-base text-on-surface-variant leading-relaxed max-w-[32ch]">
          {isHebrew
            ? "הקישור שפתחת חסר פרטים. בקש מהאדמין קישור חדש או נסה להתחבר ישירות."
            : "This link is missing details. Ask the admin for a fresh link, or sign in directly."}
        </p>
        <Link
          href={isHebrew ? "/he/login" : "/en/login"}
          className="press-down min-h-[48px] inline-flex items-center justify-center gap-2 rounded-full bg-primary text-on-primary text-base font-bold px-6 py-3"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={2} />
          {isHebrew ? "חזרה להתחברות" : "Back to sign in"}
        </Link>
      </div>
    </section>
  );
}
