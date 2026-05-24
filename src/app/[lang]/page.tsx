import Link from "next/link";
import Image from "next/image";
import { CircleDollarSign, Users } from "lucide-react";
import { getDictionary, hasLocale, type Locale } from "./dictionaries";
import { notFound } from "next/navigation";
import { localePath } from "@/lib/paths";
import { BrandLogo } from "@/components/BrandLogo";

export default async function LandingPage({
  params,
}: PageProps<"/[lang]">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const dict = await getDictionary(locale);
  const isHebrew = locale === "he";
  const displayFont = isHebrew
    ? "font-[family-name:var(--font-display)]"
    : "font-[family-name:var(--font-display-en)]";

  return (
    <section className="relative flex flex-col items-stretch">
      <div className="relative w-full h-[220px] sm:h-[320px] md:h-[440px] lg:h-[520px] overflow-hidden">
        <Image
          src="/hero.png"
          alt={isHebrew ? "כוכבי המונדיאל" : "World Cup legends"}
          fill
          priority
          sizes="100vw"
          className="object-cover object-center"
        />
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-b from-transparent via-background/40 to-background pointer-events-none"
        />
      </div>

      <div className="relative z-10 -mt-12 md:-mt-20 px-4 md:px-16 pb-10 md:pb-20 flex justify-center">
        <div className="w-full max-w-2xl bg-surface-container-low p-6 md:p-10 border border-outline rounded-lg shadow-[0_8px_32px_rgba(28,20,15,0.12)] flex flex-col gap-6 md:gap-8 text-start">
          <div className="flex justify-center -mt-2">
            <BrandLogo locale={locale} size="hero" />
          </div>
          <div className="flex flex-col gap-3 md:gap-5">
            <p className="font-[family-name:var(--font-label)] text-[12px] font-bold tracking-[0.1em] uppercase text-surface-tint">
              {dict.landing.countdownLabel}
            </p>
            <div className="flex items-baseline gap-4 md:gap-6 flex-wrap">
              <CountdownUnit n="11" label={dict.landing.days} displayFont={displayFont} />
              <span
                aria-hidden
                className={`${displayFont} text-[28px] md:text-[48px] leading-none text-outline-variant`}
              >
                ·
              </span>
              <CountdownUnit n="04" label={dict.landing.hours} displayFont={displayFont} />
            </div>
          </div>

          <p
            className={`${displayFont} text-xl md:text-[26px] leading-8 md:leading-9 text-on-surface max-w-md`}
          >
            {dict.landing.tagline}
          </p>

          <div>
            <Link
              href={localePath(locale, "login")}
              className="press-down inline-flex items-center justify-center bg-primary text-on-primary font-[family-name:var(--font-label)] text-[14px] font-bold tracking-[0.05em] px-10 py-4 min-h-[48px] rounded-full shadow-md hover:bg-surface-tint hover:-translate-y-0.5 transition-all duration-200"
            >
              {dict.landing.cta}
            </Link>
          </div>

          <div className="pt-5 md:pt-6 border-t border-outline-variant flex flex-col gap-3">
            <p className="font-[family-name:var(--font-label)] text-[12px] font-bold tracking-[0.05em] text-on-surface-variant">
              {dict.landing.friendsPoolLabel}
            </p>
            <div className="flex flex-wrap gap-2 md:gap-3">
              <span className="text-sm md:text-base text-on-surface bg-surface-variant px-3 py-1.5 rounded-full border border-outline-variant inline-flex items-center gap-2">
                <CircleDollarSign className="h-4 w-4 text-surface-tint shrink-0" strokeWidth={1.75} />
                <span>{dict.landing.potLabel}:</span>
                <bdi className="font-bold">4,200 {dict.common.currency}</bdi>
              </span>
              <span className="text-sm md:text-base text-on-surface bg-surface-variant px-3 py-1.5 rounded-full border border-outline-variant inline-flex items-center gap-2">
                <Users className="h-4 w-4 text-surface-tint shrink-0" strokeWidth={1.75} />
                <bdi className="font-bold">32</bdi>
                <span>{dict.landing.participantsLabel}</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function CountdownUnit({
  n,
  label,
  displayFont,
}: {
  n: string;
  label: string;
  displayFont: string;
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <bdi
        className={`${displayFont} text-[40px] md:text-[64px] leading-none font-bold text-primary tracking-tight`}
      >
        {n}
      </bdi>
      <span
        className={`${displayFont} text-base md:text-2xl font-bold text-on-surface-variant`}
      >
        {label}
      </span>
    </span>
  );
}
