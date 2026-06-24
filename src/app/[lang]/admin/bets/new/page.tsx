import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { eq } from "drizzle-orm";
import { hasLocale, type Locale } from "../../../dictionaries";
import { Card } from "@/components/ui";
import { localePath } from "@/lib/paths";
import { eq as drizzleEq } from "drizzle-orm";
import { db } from "@/db";
import { settings, groups, teams } from "@/db/schema";
import {
  getBetTemplate,
  listAnchorMatches,
  listAnchorDays,
  listBetTemplates,
} from "@/db/admin-queries";
import { getDeadlineContext } from "@/lib/deadlines";
import { BetForm, type InitialBet } from "../BetForm";
import type { AnswerConfig, GradingConfig } from "@/lib/bets/types";
import { adaptTemplateText } from "@/lib/bets/template-adapt";
import { buildGroupBetTemplate } from "@/lib/bets/group-bet-template";

export default async function NewBetPage({
  params,
  searchParams,
}: PageProps<"/[lang]/admin/bets/new">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const isHebrew = locale === "he";
  const Chev = isHebrew ? ChevronLeft : ChevronRight;
  const sp = await searchParams;

  // Optional pre-fill from a saved template + (optionally) a target
  // match/day. Pasted in via the quick-add buttons on the suggestions
  // page; admin still reviews + publishes manually so a stale team-name
  // in the question text gets caught before going live.
  const templateId = typeof sp.templateId === "string" ? sp.templateId : null;
  const targetMatchId = typeof sp.matchId === "string" ? sp.matchId : null;
  const targetMatchdayDate =
    typeof sp.matchdayDate === "string" ? sp.matchdayDate : null;

  const [anchorMatches, anchorDays, groupRows, [defaultsRow], deadlineCtx, templates, template] =
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
      listBetTemplates(50),
      templateId ? getBetTemplate(templateId) : Promise.resolve(null),
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

  // Smart team-name swap: if the template was anchored on a specific
  // match AND we're landing on a different match, find-and-replace the
  // source team names (HE + EN) in the question + grading-rule text so
  // a "Mexico to win?" template applied to Argentina ships as
  // "Argentina to win?" without the admin having to retype. Conservative:
  // only swaps when target teams are different + source/target both
  // resolved; otherwise leaves text as-is.
  const targetMatch = targetMatchId
    ? anchorMatches.find((m) => m.id === targetMatchId)
    : null;
  const adapted =
    template && targetMatch
      ? adaptTemplateText(template, targetMatch)
      : template
        ? {
            questionHe: template.questionHe,
            questionEn: template.questionEn,
            gradingRuleHe: template.gradingRuleHe,
            gradingRuleEn: template.gradingRuleEn,
          }
        : null;

  // Build the InitialBet payload when a template is selected. We do NOT
  // copy match_id / matchday_date / lock_at / decimal_odds / stake from
  // the source row — those are anchor-specific. Scope and the target
  // anchor are taken from the URL params (when supplied by the quick-add
  // button) so the form lands on the right surface without an extra
  // click. Without explicit targets we just clone the question + grading
  // shell and let the admin pick the anchor.
  const initialBet: InitialBet | undefined = template && adapted
    ? {
        scope: targetMatchId
          ? "match"
          : targetMatchdayDate
            ? "day"
            : template.scope,
        matchId: targetMatchId,
        matchdayDate: targetMatchdayDate,
        stage: null,
        groupId: null,
        questionHe: adapted.questionHe,
        questionEn: adapted.questionEn,
        gradingRuleHe: adapted.gradingRuleHe,
        gradingRuleEn: adapted.gradingRuleEn,
        answerType: template.answerType,
        answerConfig: template.answerConfig as AnswerConfig,
        // Pricing snapshots stay at the answer-type defaults; the form's
        // decimal_odds input recomputes both for live scope on save.
        stakeSnapshot: 0,
        payoutSnapshot: 0,
        decimalOdds: null,
        gradingSource: template.gradingSource,
        gradingConfig: template.gradingConfig as GradingConfig,
        // Empty string makes the form fall back to its suggestDefaultLockAt
        // pipeline (computes 5 min before the target match's kickoff).
        lockAt: "",
      }
    : undefined;

  // Group-winner prefill: the group-bets admin page deep-links here with
  // ?scope=group&groupId=X. We seed the form with that group's teams as
  // multi_choice options + a default "who wins group X" question, so the
  // admin only reviews and saves a draft. The groupId is matched (case-
  // insensitively) against the real group list; an unknown value falls back
  // to the normal empty form. Skipped when a template prefill already won.
  const wantsGroupScope = typeof sp.scope === "string" && sp.scope === "group";
  const groupIdParam =
    wantsGroupScope && typeof sp.groupId === "string"
      ? sp.groupId.toUpperCase()
      : null;
  const matchedGroupId =
    groupIdParam
      ? (groupRows.find((g) => g.id.toUpperCase() === groupIdParam)?.id ?? null)
      : null;

  let groupInitialBet: InitialBet | undefined;
  if (matchedGroupId && !initialBet) {
    const groupTeams = await db
      .select({ code: teams.code, nameHe: teams.nameHe, nameEn: teams.nameEn })
      .from(teams)
      .where(drizzleEq(teams.groupId, matchedGroupId))
      .orderBy(teams.nameEn);
    const tpl = buildGroupBetTemplate(matchedGroupId, groupTeams);
    groupInitialBet = {
      scope: "group",
      matchId: null,
      matchdayDate: null,
      stage: null,
      groupId: matchedGroupId,
      questionHe: tpl.questionHe,
      questionEn: tpl.questionEn,
      gradingRuleHe: tpl.gradingRuleHe,
      gradingRuleEn: tpl.gradingRuleEn,
      answerType: "multi_choice",
      answerConfig: { kind: "multi_choice", options: tpl.options },
      stakeSnapshot: 0,
      payoutSnapshot: 0,
      decimalOdds: null,
      gradingSource: "manual",
      gradingConfig: null,
      lockAt: "",
    };
  }

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
          templates={templates}
          initialBet={initialBet ?? groupInitialBet}
        />
      </Card>
    </section>
  );
}

