import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { eq } from "drizzle-orm";
import { hasLocale, type Locale } from "../../../dictionaries";
import { Card } from "@/components/ui";
import { localePath } from "@/lib/paths";
import { db } from "@/db";
import { settings, groups } from "@/db/schema";
import { listAnchorMatches, listAnchorDays } from "@/db/admin-queries";
import { getDeadlineContext } from "@/lib/deadlines";
import { BetForm } from "../BetForm";

export default async function NewBetPage({
  params,
}: PageProps<"/[lang]/admin/bets/new">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const isHebrew = locale === "he";
  const Chev = isHebrew ? ChevronLeft : ChevronRight;

  const [anchorMatches, anchorDays, groupRows, [defaultsRow], deadlineCtx] =
    await Promise.all([
      listAnchorMatches(),
      listAnchorDays(),
      db.select({ id: groups.id }).from(groups).orderBy(groups.displayOrder),
      db
        .select({
          stakeYesNo: settings.stakeYesNo,
          payoutYesNo: settings.payoutYesNo,
          stakeNumber: settings.stakeNumber,
          payoutNumber: settings.payoutNumber,
          stakeMultiChoice: settings.stakeMultiChoice,
          payoutMultiChoice: settings.payoutMultiChoice,
          stakeFreeText: settings.stakeFreeText,
          payoutFreeText: settings.payoutFreeText,
          betLockMinutes: settings.betLockMinutes,
          // Live-bet pricing knobs — the form reads these to convert the
          // admin's decimal_odds into the suggested stake/payout preview
          // and to mirror the user-side payout cap math byte-for-byte.
          liveOddsBaseStake: settings.liveOddsBaseStake,
          liveOddsHouseEdgePct: settings.liveOddsHouseEdgePct,
          liveOddsMaxPayoutRatio: settings.liveOddsMaxPayoutRatio,
          liveOddsMaxPayoutCeiling: settings.liveOddsMaxPayoutCeiling,
        })
        .from(settings)
        .where(eq(settings.id, 1))
        .limit(1),
      getDeadlineContext(),
    ]);
  const defaults = defaultsRow
    ? {
        ...defaultsRow,
        deadlineOffsets: deadlineCtx.defaults,
        tournamentStartAt:
          (deadlineCtx.tournamentStartAt ?? deadlineCtx.derivedTournamentStartAt)
            ?.toISOString() ?? null,
      }
    : undefined;

  return (
    <section className="px-4 md:px-16 py-6 md:py-12 flex flex-col gap-6 md:gap-8 max-w-3xl mx-auto w-full pb-24">
      <header className="flex flex-col gap-3">
        <Link
          href={localePath(locale, "admin/bets")}
          className="inline-flex items-center gap-1 text-sm text-on-surface-variant hover:text-on-surface w-fit"
        >
          <Chev className="h-4 w-4" strokeWidth={2} />
          {isHebrew ? "חזרה להימורים" : "Back to bets"}
        </Link>
        <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-9 md:text-[40px] md:leading-[44px] font-bold text-primary">
          {isHebrew ? "הימור חדש" : "New bet"}
        </h1>
        <p className="text-sm text-on-surface-variant">
          {isHebrew
            ? "הימור נשמר כטיוטה. פרסם אותו מהרשימה אחרי שתוודא שהכל נכון."
            : "Saved as a draft. Publish it from the list after you double-check."}
        </p>
      </header>

      <Card className="p-5 md:p-8">
        <BetForm
          locale={locale}
          anchorMatches={anchorMatches}
          anchorDays={anchorDays}
          groupIds={groupRows.map((g) => g.id)}
          defaults={defaults}
        />
      </Card>
    </section>
  );
}
