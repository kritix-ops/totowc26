import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight, Settings } from "lucide-react";
import { hasLocale, type Locale } from "../../../dictionaries";
import { requireAdmin } from "@/lib/admin";
import { getStakeConfig } from "@/lib/bank";
import { getPrizeBreakdown } from "@/db/queries";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { Card } from "@/components/ui";
import { localePath } from "@/lib/paths";
import { ScoringForm } from "./ScoringForm";

export default async function AdminScoringSettingsPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  await requireAdmin(locale);
  const isHebrew = locale === "he";
  const ChevronBack = isHebrew ? ChevronRight : ChevronLeft;

  // Read the full settings row including the main 1/X/2 scoring values
  // (StakeConfig doesn't include the main payouts since the main pick is
  // free, so we fetch them directly here).
  const [stakeCfg, [mainCfg], prize] = await Promise.all([
    getStakeConfig(),
    db
      .select({
        scoringExact: settings.scoringExact,
        scoringOutcome: settings.scoringOutcome,
        prizePct1: settings.prizePct1,
        prizePct2: settings.prizePct2,
        prizePct3: settings.prizePct3,
        prizePct4: settings.prizePct4,
      })
      .from(settings)
      .where(eq(settings.id, 1)),
    getPrizeBreakdown(),
  ]);

  const initial = {
    startingBank: stakeCfg.startingBank,
    stakeBtts: stakeCfg.stakeBtts,
    stakeOver25: stakeCfg.stakeOver25,
    stakeHt: stakeCfg.stakeHt,
    stakeGroupTeam: stakeCfg.stakeGroupTeam,
    stakeBracketChampion: stakeCfg.stakeBracketChampion,
    stakeBracketRunnerUp: stakeCfg.stakeBracketRunnerUp,
    stakeBracketThird: stakeCfg.stakeBracketThird,
    stakeBracketFourth: stakeCfg.stakeBracketFourth,
    stakeTopScorer: stakeCfg.stakeTopScorer,
    stakeFinalPenalties: stakeCfg.stakeFinalPenalties,
    scoringExact: mainCfg?.scoringExact ?? 15,
    scoringOutcome: mainCfg?.scoringOutcome ?? 3,
    scoringBtts: stakeCfg.scoringBtts,
    scoringOver25: stakeCfg.scoringOver25,
    scoringHtExact: stakeCfg.scoringHtExact,
    scoringHtOutcome: stakeCfg.scoringHtOutcome,
    scoringGroupTeam: stakeCfg.scoringGroupTeam,
    scoringGroupPerfect: stakeCfg.scoringGroupPerfect,
    scoringChampion: stakeCfg.scoringChampion,
    scoringRunnerUp: stakeCfg.scoringRunnerUp,
    scoringThird: stakeCfg.scoringThird,
    scoringFourth: stakeCfg.scoringFourth,
    scoringTopScorer: stakeCfg.scoringTopScorer,
    scoringFinalPenalties: stakeCfg.scoringFinalPenalties,
    prizePct1: mainCfg?.prizePct1 ?? 50,
    prizePct2: mainCfg?.prizePct2 ?? 30,
    prizePct3: mainCfg?.prizePct3 ?? 15,
    prizePct4: mainCfg?.prizePct4 ?? 5,
  };

  return (
    <section className="px-4 md:px-10 py-6 md:py-10 flex flex-col gap-8 max-w-3xl mx-auto w-full">
      <header className="flex flex-col gap-2">
        <Link
          href={localePath(locale, "admin")}
          className="inline-flex items-center gap-1 text-sm text-on-surface-variant hover:text-primary self-start"
        >
          <ChevronBack className="h-4 w-4" />
          {isHebrew ? "חזרה לניהול" : "Back to admin"}
        </Link>
        <h1 className="font-[family-name:var(--font-display)] text-[24px] leading-8 md:text-[36px] md:leading-[40px] font-bold text-primary inline-flex items-center gap-3">
          <Settings className="h-6 w-6 md:h-8 md:w-8" strokeWidth={1.75} />
          {isHebrew ? "ניקוד ובנק נקודות" : "Scoring & points bank"}
        </h1>
        <p className="text-base text-on-surface-variant">
          {isHebrew
            ? "ערוך את הסכום ההתחלתי של הבנק, את עלות ההשקעה לכל סוג הימור, ואת התשלום שמתקבל בהימור נכון."
            : "Edit starting bank, per-action stake costs, and the payout awarded for a correct bet."}
        </p>
      </header>

      <Card className="p-4 md:p-5 bg-tertiary-fixed text-on-tertiary-fixed-variant border border-tertiary-fixed-dim">
        <p className="text-sm">
          <strong className="block mb-1">
            {isHebrew ? "שים לב" : "Heads up"}
          </strong>
          {isHebrew
            ? "שינויים לא ישפיעו על הימורים שכבר נשמרו - העלות מצולמת ברגע השמירה ונשמרת בשורת ההימור. שינוי כאן ישפיע רק על הימורים חדשים."
            : "Changes do not affect bets already submitted — each bet's stake is snapshotted on save. This form only changes pricing for future submissions."}
        </p>
      </Card>

      <ScoringForm initial={initial} locale={locale} potIls={prize.potIls} />
    </section>
  );
}
