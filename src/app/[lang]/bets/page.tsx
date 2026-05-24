import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getDictionary, hasLocale, type Locale } from "../dictionaries";
import { getUser } from "@/lib/supabase/auth";
import { getUpcomingFixtures } from "@/db/queries";
import { Card, LabelCaps } from "@/components/ui";
import { Flag } from "@/components/Flag";
import { localePath } from "@/lib/paths";
import { formatDateTime } from "@/lib/format";

export default async function BetsListPage({
  params,
}: PageProps<"/[lang]/bets">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const dict = await getDictionary(locale);

  const user = await getUser();
  if (!user) redirect(localePath(locale, "login"));

  const fixtures = await getUpcomingFixtures(user.id, 50);
  const isHebrew = locale === "he";
  const Chev = isHebrew ? ChevronLeft : ChevronRight;

  return (
    <section className="px-4 md:px-16 py-6 md:py-12 flex flex-col gap-6 md:gap-8 max-w-3xl mx-auto w-full">
      <header className="flex items-end justify-between">
        <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-9 md:text-[48px] md:leading-[52px] font-bold text-primary">
          {dict.nav.myBets}
        </h1>
      </header>
      {fixtures.length === 0 ? (
        <Card className="p-6 text-center text-on-surface-variant">
          {isHebrew
            ? "אין משחקים מתוכננים. נסה שוב בקרוב."
            : "No matches scheduled. Check back soon."}
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {fixtures.map((m) => {
            const homeName = isHebrew ? m.homeNameHe : m.homeNameEn;
            const awayName = isHebrew ? m.awayNameHe : m.awayNameEn;
            const hasBet = m.myHome !== null && m.myAway !== null;
            return (
              <Link key={m.id} href={localePath(locale, `bets/${m.id}`)} className="block">
                <Card className="p-4 md:p-5 flex items-center justify-between gap-3 hover:bg-surface-container transition-colors">
                  <div className="flex items-center gap-2 md:gap-3 flex-1 min-w-0">
                    <Flag code={m.homeCode} size={28} />
                    <span className="text-sm md:text-base font-bold truncate">{homeName}</span>
                    <span className="text-on-surface-variant text-xs md:text-sm px-1">vs</span>
                    <span className="text-sm md:text-base font-bold truncate">{awayName}</span>
                    <Flag code={m.awayCode} size={28} />
                  </div>
                  <div className="flex items-center gap-2 md:gap-3 shrink-0">
                    {hasBet ? (
                      <span className="font-[family-name:var(--font-score)] text-base md:text-lg font-bold bidi-ltr text-primary">
                        {m.myHome} - {m.myAway}
                      </span>
                    ) : (
                      <div className="text-end">
                        <LabelCaps as="div" className="mb-0.5">
                          {isHebrew ? "פתיחה" : "Kickoff"}
                        </LabelCaps>
                        <span className="font-[family-name:var(--font-label)] text-xs font-bold bidi-ltr">
                          {formatShort(m.kickoffAt, locale)}
                        </span>
                      </div>
                    )}
                    <Chev className="h-5 w-5 text-outline shrink-0" />
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

function formatShort(iso: string, locale: Locale): string {
  return formatDateTime(iso, locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
