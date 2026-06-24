import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { hasLocale, type Locale } from "../../../../dictionaries";
import { Chip } from "@/components/ui";
import { localePath } from "@/lib/paths";
import { formatDateTime } from "@/lib/format";
import { getAdminCustomBetDetail } from "@/db/admin-queries";
import { sanitizeReturnQuery } from "@/lib/bets/admin-bet-filters";
import {
  canEditPublishedOdds,
  liveOddsEditRows,
  oddsEditPricingMode,
} from "@/lib/bets/edit-odds";
import type { AnswerConfig } from "@/lib/bets/types";
import { EditOddsForm } from "./EditOddsForm";

export default async function EditOddsPage({
  params,
  searchParams,
}: PageProps<"/[lang]/admin/bets/[id]/odds">) {
  const { lang, id } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const isHebrew = locale === "he";
  const Chev = isHebrew ? ChevronLeft : ChevronRight;

  // Preserve the list filters through this sub-page, like the detail/edit pages.
  const sp = await searchParams;
  const returnQs = sanitizeReturnQuery(sp.return);
  const returnSuffix = returnQs ? `?return=${encodeURIComponent(returnQs)}` : "";
  const detailHref = localePath(locale, `admin/bets/${id}`) + returnSuffix;

  const bet = await getAdminCustomBetDetail(id);
  if (!bet) notFound();
  // Server-side guard mirrors the action: bounce anything not eligible back to
  // the detail page (publish / cancel / grade live there instead).
  if (
    !canEditPublishedOdds({
      status: bet.status,
      scope: bet.scope,
      lockAt: bet.lockAt,
      answerConfig: bet.answerConfig,
    })
  ) {
    redirect(detailHref);
  }

  const rows = liveOddsEditRows(bet.answerConfig as AnswerConfig, isHebrew);
  const pricingMode = oddsEditPricingMode(bet.answerConfig as AnswerConfig);
  const question = isHebrew ? bet.questionHe : bet.questionEn;
  const lockLabel = formatDateTime(bet.lockAt, locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <section className="px-4 md:px-16 py-6 md:py-12 flex flex-col gap-6 md:gap-8 max-w-3xl mx-auto w-full pb-24">
      <header className="flex flex-col gap-3">
        <Link
          href={detailHref}
          className="inline-flex items-center gap-1 text-sm text-on-surface-variant hover:text-on-surface w-fit"
        >
          <Chev className="h-4 w-4" strokeWidth={2} />
          {isHebrew ? "חזרה לפרטי ההימור" : "Back to bet"}
        </Link>
        <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-9 md:text-[40px] md:leading-[44px] font-bold text-primary">
          {isHebrew ? "עריכת יחסים" : "Edit odds"}
        </h1>
        <p className="text-base text-on-surface">{question}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone="primary">{isHebrew ? "פתוח" : "Open"}</Chip>
          <Chip tone="secondary">
            {isHebrew
              ? `${bet.picks.length} הימרו`
              : `${bet.picks.length} picks`}
          </Chip>
          <Chip>
            {isHebrew ? `נסגר ${lockLabel}` : `Locks ${lockLabel}`}
          </Chip>
        </div>
      </header>

      <EditOddsForm
        locale={locale}
        betId={bet.id}
        answerType={bet.answerType === "yes_no" ? "yes_no" : "multi_choice"}
        rows={rows}
        pricingMode={pricingMode}
        pickCount={bet.picks.length}
        backHref={detailHref}
      />
    </section>
  );
}
