import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { eq } from "drizzle-orm";
import { hasLocale, type Locale } from "../../../../dictionaries";
import { Card } from "@/components/ui";
import { localePath } from "@/lib/paths";
import { db } from "@/db";
import { settings, groups } from "@/db/schema";
import {
  getAdminCustomBetDetail,
  listAnchorMatches,
  listAnchorDays,
} from "@/db/admin-queries";
import { sanitizeReturnQuery } from "@/lib/bets/admin-bet-filters";
import { getDeadlineContext } from "@/lib/deadlines";
import { BetForm, type InitialBet } from "../../BetForm";
import type { AnswerConfig, GradingConfig } from "@/lib/bets/types";

export default async function EditBetPage({
  params,
  searchParams,
}: PageProps<"/[lang]/admin/bets/[id]/edit">) {
  const { lang, id } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const isHebrew = locale === "he";
  const Chev = isHebrew ? ChevronLeft : ChevronRight;

  // Keep the list filters alive through edit → back-to-bet → back-to-list.
  const sp = await searchParams;
  const returnQs = sanitizeReturnQuery(sp.return);
  const returnSuffix = returnQs ? `?return=${encodeURIComponent(returnQs)}` : "";
  const detailHref = localePath(locale, `admin/bets/${id}`) + returnSuffix;

  const bet = await getAdminCustomBetDetail(id);
  if (!bet) notFound();
  // Server-side gate: edit is draft-only. Anything else bounces back to
  // the detail page where the admin can publish / cancel / grade instead.
  if (bet.status !== "draft") {
    redirect(detailHref);
  }

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

  const initial: InitialBet = {
    scope: bet.scope,
    matchId: bet.matchId,
    matchdayDate: bet.matchdayDate,
    stage: bet.stage as InitialBet["stage"],
    groupId: bet.groupId,
    questionHe: bet.questionHe,
    questionEn: bet.questionEn,
    gradingRuleHe: bet.gradingRuleHe,
    gradingRuleEn: bet.gradingRuleEn,
    answerType: bet.answerType,
    answerConfig: bet.answerConfig as AnswerConfig,
    stakeSnapshot: bet.stakeSnapshot,
    payoutSnapshot: bet.payoutSnapshot,
    decimalOdds: bet.decimalOdds,
    gradingSource: bet.gradingSource,
    gradingConfig: bet.gradingConfig as GradingConfig,
    lockAt: bet.lockAt,
  };

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
          {isHebrew ? "עריכת הימור" : "Edit bet"}
        </h1>
        <p className="text-sm text-on-surface-variant">
          {isHebrew
            ? "אפשר לערוך רק טיוטה. אחרי פרסום, ההימור נעול - בטל וצור חדש אם צריך."
            : "Only drafts are editable. After publish, cancel and recreate instead."}
        </p>
      </header>

      <Card className="p-5 md:p-8">
        <BetForm
          locale={locale}
          anchorMatches={anchorMatches}
          anchorDays={anchorDays}
          groupIds={groupRows.map((g) => g.id)}
          defaults={defaults}
          mode="edit"
          betId={id}
          initialBet={initial}
          // Edit mode hides the template picker; pass an empty array so
          // the prop is satisfied without an extra DB roundtrip.
          templates={[]}
          // Carry the list filters through so save/publish return the admin to
          // the exact filtered list they came from.
          returnQs={returnQs || undefined}
        />
      </Card>
    </section>
  );
}

