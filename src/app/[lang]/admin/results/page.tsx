import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tournamentResults } from "@/db/schema";
import { hasLocale, type Locale } from "../../dictionaries";
import { LabelCaps } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { ResultsForm } from "./ResultsForm";

export default async function AdminResultsPage({
  params,
}: PageProps<"/[lang]/admin/results">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const isHebrew = locale === "he";

  const [row] = await db
    .select({
      topScorer: tournamentResults.topScorer,
      finalWentToPenalties: tournamentResults.finalWentToPenalties,
      updatedAt: tournamentResults.updatedAt,
    })
    .from(tournamentResults)
    .where(eq(tournamentResults.id, 1));

  const topScorer = row?.topScorer ?? "";
  const finalPen =
    row?.finalWentToPenalties === true
      ? "yes"
      : row?.finalWentToPenalties === false
        ? "no"
        : "";

  return (
    <section className="px-4 md:px-16 py-6 md:py-12 flex flex-col gap-6 md:gap-8 max-w-3xl mx-auto w-full">
      <header className="flex flex-col gap-2">
        <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-9 md:text-[44px] md:leading-[48px] font-bold text-primary">
          {isHebrew ? "תוצאות הטורניר" : "Tournament results"}
        </h1>
        <p className="text-sm md:text-base text-on-surface-variant">
          {isHebrew
            ? "סגירת ההימורי על. שמירה כאן תנקד את כולם מחדש."
            : "Finalise the tournament specials. Saving rescores everyone."}
        </p>
        {row?.updatedAt && (
          <LabelCaps>
            {isHebrew ? "עודכן ב" : "Updated"}{" "}
            <bdi>
              {formatDateTime(row.updatedAt, locale, {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </bdi>
          </LabelCaps>
        )}
      </header>

      <ResultsForm
        initialTopScorer={topScorer}
        initialFinalPen={finalPen}
        locale={locale}
      />
    </section>
  );
}
