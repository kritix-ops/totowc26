import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight, Settings } from "lucide-react";
import { hasLocale, type Locale } from "../../../dictionaries";
import { requireAdmin } from "@/lib/admin";
import { getCategoryPrizeBreakdown } from "@/db/queries";
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

  const [[cfg], prize] = await Promise.all([
    db
      .select({
        startingBank: settings.startingBank,
        scoringExact: settings.scoringExact,
        scoringOutcome: settings.scoringOutcome,
        matchRiskEnabled: settings.matchRiskEnabled,
        matchRiskPenalty: settings.matchRiskPenalty,
        dailyRenewalEnabled: settings.dailyRenewalEnabled,
        dailyRenewalAmount: settings.dailyRenewalAmount,
        duelMaxStake: settings.duelMaxStake,
        duelDefaultJoinWindowHours: settings.duelDefaultJoinWindowHours,
        duelDailyLimit: settings.duelDailyLimit,
        liveOddsBaseStake: settings.liveOddsBaseStake,
        liveOddsMaxPayout: settings.liveOddsMaxPayout,
        liveOddsHouseEdgePct: settings.liveOddsHouseEdgePct,
        stakeYesNo: settings.stakeYesNo,
        payoutYesNo: settings.payoutYesNo,
        stakeNumber: settings.stakeNumber,
        payoutNumber: settings.payoutNumber,
        stakeMultiChoice: settings.stakeMultiChoice,
        payoutMultiChoice: settings.payoutMultiChoice,
        stakeFreeText: settings.stakeFreeText,
        payoutFreeText: settings.payoutFreeText,
        prizePct1: settings.prizePct1,
        prizePct2: settings.prizePct2,
        prizePct3: settings.prizePct3,
        prizePct4: settings.prizePct4,
        prizeKingFirstPct: settings.prizeKingFirstPct,
        prizeKingSecondPct: settings.prizeKingSecondPct,
        prizeKingThirdPct: settings.prizeKingThirdPct,
        prizeMatchesWinnerPct: settings.prizeMatchesWinnerPct,
        prizeLiveWinnerPct: settings.prizeLiveWinnerPct,
        prizeDuelsWinnerPct: settings.prizeDuelsWinnerPct,
        prizeReservePct: settings.prizeReservePct,
        adminOverheadIls: settings.adminOverheadIls,
      })
      .from(settings)
      .where(eq(settings.id, 1)),
    getCategoryPrizeBreakdown(),
  ]);

  const initial = {
    startingBank: cfg?.startingBank ?? 30,
    scoringExact: cfg?.scoringExact ?? 15,
    scoringOutcome: cfg?.scoringOutcome ?? 5,
    matchRiskEnabled: cfg?.matchRiskEnabled ?? false,
    matchRiskPenalty: cfg?.matchRiskPenalty ?? 5,
    dailyRenewalEnabled: cfg?.dailyRenewalEnabled ?? false,
    dailyRenewalAmount: cfg?.dailyRenewalAmount ?? 3,
    duelMaxStake: cfg?.duelMaxStake ?? 5,
    duelDefaultJoinWindowHours: cfg?.duelDefaultJoinWindowHours ?? 24,
    duelDailyLimit: cfg?.duelDailyLimit ?? 20,
    liveOddsBaseStake: cfg?.liveOddsBaseStake ?? 3,
    liveOddsMaxPayout: cfg?.liveOddsMaxPayout ?? 25,
    liveOddsHouseEdgePct: cfg?.liveOddsHouseEdgePct ?? 5,
    stakeYesNo: cfg?.stakeYesNo ?? 1,
    payoutYesNo: cfg?.payoutYesNo ?? 3,
    stakeNumber: cfg?.stakeNumber ?? 2,
    payoutNumber: cfg?.payoutNumber ?? 6,
    stakeMultiChoice: cfg?.stakeMultiChoice ?? 2,
    payoutMultiChoice: cfg?.payoutMultiChoice ?? 5,
    stakeFreeText: cfg?.stakeFreeText ?? 3,
    payoutFreeText: cfg?.payoutFreeText ?? 10,
    prizePct1: cfg?.prizePct1 ?? 50,
    prizePct2: cfg?.prizePct2 ?? 30,
    prizePct3: cfg?.prizePct3 ?? 15,
    prizePct4: cfg?.prizePct4 ?? 5,
    prizeKingFirstPct: cfg?.prizeKingFirstPct ?? 30,
    prizeKingSecondPct: cfg?.prizeKingSecondPct ?? 12,
    prizeKingThirdPct: cfg?.prizeKingThirdPct ?? 6,
    prizeMatchesWinnerPct: cfg?.prizeMatchesWinnerPct ?? 15,
    prizeLiveWinnerPct: cfg?.prizeLiveWinnerPct ?? 15,
    prizeDuelsWinnerPct: cfg?.prizeDuelsWinnerPct ?? 12,
    prizeReservePct: cfg?.prizeReservePct ?? 10,
    adminOverheadIls: cfg?.adminOverheadIls ?? 100,
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
            ? "בנק התחלתי, ניקוד הימור 1/X/2, וברירות מחדל לעלות/תשלום עבור הימורים מותאמים שאתה יוצר."
            : "Starting bank, 1/X/2 payouts, and the default stake/payout per custom-bet answer type."}
        </p>
      </header>

      <Card className="p-4 md:p-5 bg-tertiary-fixed text-on-tertiary-fixed-variant border border-tertiary-fixed-dim">
        <p className="text-sm">
          <strong className="block mb-1">
            {isHebrew ? "שים לב" : "Heads up"}
          </strong>
          {isHebrew
            ? "ברירות המחדל לעלות/תשלום משפיעות רק על הימורים חדשים שתיצור באדמין. הימורים קיימים שומרים את העלות והתשלום שלהם מרגע היצירה."
            : "Default stake/payout values only affect bets you create from now on. Existing bets keep their snapshotted prices."}
        </p>
      </Card>

      <ScoringForm initial={initial} locale={locale} potIls={prize.potIls} />
    </section>
  );
}
