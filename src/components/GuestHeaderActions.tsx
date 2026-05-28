import Link from "next/link";
import { eq } from "drizzle-orm";
import { LogIn } from "lucide-react";
import type { Dictionary, Locale } from "@/app/[lang]/dictionaries";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { localePath } from "@/lib/paths";
import { LanguageToggle } from "./LanguageToggle";

// Guest header CTAs: Sign up + Sign in + language toggle. Wrapped in
// Suspense in the AppShell so the static shell paints first; this only
// runs a single quick settings lookup (settings.publicSignupOpen) to
// decide whether to render the Sign up pill, so the swap-in is fast.
export async function GuestHeaderActions({
  locale,
  dict,
}: {
  locale: Locale;
  dict: Dictionary;
}) {
  const row = await db
    .select({ open: settings.publicSignupOpen })
    .from(settings)
    .where(eq(settings.id, 1))
    .limit(1)
    .then((r) => r[0] ?? null);
  const signupOpen = row?.open ?? true;
  console.info("[guest header actions]", { signupOpen });

  return (
    <>
      {signupOpen && (
        <Link
          href={localePath(locale, "signup")}
          className="press-down inline-flex items-center justify-center min-h-[44px] px-3 md:px-4 rounded-full bg-surface-container-lowest border border-primary text-primary font-[family-name:var(--font-label)] text-[12px] md:text-[13px] font-bold tracking-[0.05em] hover:bg-primary-container transition-[background-color,color] duration-150"
        >
          {dict.nav.signup}
        </Link>
      )}
      <Link
        href={localePath(locale, "login")}
        className="press-down inline-flex items-center gap-1.5 min-h-[44px] px-3 md:px-4 rounded-full bg-primary text-on-primary font-[family-name:var(--font-label)] text-[12px] md:text-[13px] font-bold tracking-[0.05em] hover:bg-surface-tint transition-[background-color,color] duration-150"
      >
        <LogIn className="hidden md:block h-4 w-4" strokeWidth={2} />
        {dict.nav.signin}
      </Link>
      <LanguageToggle currentLocale={locale} label={dict.common.languageToggle} />
    </>
  );
}
