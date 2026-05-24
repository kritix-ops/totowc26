import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleDollarSign, Check, X } from "lucide-react";
import { getDictionary, hasLocale, type Locale } from "../dictionaries";
import { PENDING_PAYMENTS, UPCOMING_MATCHES, LEADERBOARD, teamName, TEAMS } from "@/lib/mock-data";
import { Card, Chip, LabelCaps, PillButton, SectionHeading } from "@/components/ui";
import { Flag } from "@/components/Flag";
import { localePath } from "@/lib/paths";
import { SyncPanel } from "./SyncPanel";

export default async function AdminPage({
  params,
}: PageProps<"/[lang]/admin">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const dict = await getDictionary(locale);
  const total = LEADERBOARD.length * 100;

  return (
    <section className="px-4 md:px-16 py-6 md:py-12 flex flex-col gap-8 max-w-5xl mx-auto w-full">
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-9 md:text-[48px] md:leading-[52px] font-bold text-primary">
          {dict.admin.title}
        </h1>
        <Card className="px-5 py-3 flex items-center gap-3 self-start md:self-auto">
          <CircleDollarSign className="h-5 w-5 text-tertiary shrink-0" strokeWidth={1.5} />
          <div className="flex flex-col min-w-0">
            <LabelCaps>{dict.admin.potTotal}</LabelCaps>
            <span className="font-[family-name:var(--font-display)] text-xl md:text-2xl leading-none font-bold text-surface-tint">
              <bdi>{total.toLocaleString()}</bdi> {dict.common.currency}
            </span>
          </div>
        </Card>
      </header>

      <SyncPanel locale={locale} />

      <nav className="flex gap-2 border-b border-outline-variant overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
        {[
          { label: dict.admin.tabResults, href: localePath(locale, "admin/results"), active: false },
          { label: dict.admin.tabPayments, href: null, active: true },
          { label: dict.admin.tabUsers, href: localePath(locale, "admin/users"), active: false },
          { label: dict.admin.tabSettings, href: null, active: false },
        ].map((t) =>
          t.href ? (
            <Link
              key={t.label}
              href={t.href}
              className={`min-h-[44px] px-3 py-3 font-bold text-sm md:text-base whitespace-nowrap shrink-0 transition-colors ${
                t.active
                  ? "text-primary border-b-2 border-primary -mb-px"
                  : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              {t.label}
            </Link>
          ) : (
            <button
              key={t.label}
              type="button"
              className={`min-h-[44px] px-3 py-3 font-bold text-sm md:text-base whitespace-nowrap shrink-0 transition-colors ${
                t.active
                  ? "text-primary border-b-2 border-primary -mb-px"
                  : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              {t.label}
            </button>
          ),
        )}
      </nav>

      <section className="flex flex-col gap-4">
        <SectionHeading underline="thin" as="h3">
          {dict.admin.pendingPayments}
        </SectionHeading>
        <ul className="flex flex-col gap-3">
          {PENDING_PAYMENTS.map((p) => (
            <li
              key={p.id}
              className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-lg border border-outline-variant bg-surface-container-lowest"
            >
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="w-10 h-10 rounded-full bg-surface-variant flex items-center justify-center font-bold text-on-surface shrink-0" aria-hidden>
                  {p.user.charAt(0)}
                </div>
                <div className="flex flex-col gap-1 min-w-0 flex-1">
                  <span className="font-bold text-base truncate">{p.user}</span>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Chip tone={p.method === "bit" ? "primary" : "warning"}>
                      {p.method === "bit" ? dict.onboarding.bit : dict.onboarding.paybox}
                    </Chip>
                    <span className="font-[family-name:var(--font-label)] text-xs text-on-surface-variant">
                      {p.at}
                    </span>
                  </div>
                </div>
                <span className="font-[family-name:var(--font-display)] text-lg font-bold text-on-surface shrink-0">
                  <bdi>{p.amount}</bdi> {dict.common.currency}
                </span>
              </div>
              <div className="flex gap-2 sm:shrink-0">
                <button
                  type="button"
                  aria-label={dict.admin.approve}
                  className="press-down min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full bg-secondary text-on-secondary hover:brightness-105"
                >
                  <Check className="h-5 w-5" strokeWidth={2.5} />
                </button>
                <button
                  type="button"
                  aria-label={dict.admin.reject}
                  className="press-down min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full bg-surface-container-lowest border border-outline text-error hover:bg-error-container"
                >
                  <X className="h-5 w-5" strokeWidth={2.5} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeading underline="thin" as="h3">
          {dict.admin.markResult}
        </SectionHeading>
        <Card className="p-5 md:p-6 flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3 justify-between sm:justify-start sm:flex-1">
              <div className="flex items-center gap-2">
                <Flag code={UPCOMING_MATCHES[0].home} size={36} />
                <span className="font-bold text-base">{teamName(UPCOMING_MATCHES[0].home, locale)}</span>
              </div>
              <div className="flex items-center gap-2">
                <ScoreNumberInput />
                <span className="text-on-surface-variant">:</span>
                <ScoreNumberInput />
              </div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-base">{teamName(UPCOMING_MATCHES[0].away, locale)}</span>
                <span className="text-3xl" aria-hidden>{TEAMS[UPCOMING_MATCHES[0].away]?.flag}</span>
              </div>
            </div>
          </div>
          <PillButton type="button" className="self-stretch sm:self-end">
            {dict.admin.saveResult}
          </PillButton>
        </Card>
      </section>
    </section>
  );
}

function ScoreNumberInput() {
  return (
    <input
      type="number"
      min={0}
      max={99}
      defaultValue={0}
      dir="ltr"
      className="w-12 h-12 text-center font-[family-name:var(--font-score)] text-xl font-bold bg-surface-container border border-outline rounded text-on-surface focus:outline-none focus:border-primary [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
    />
  );
}
