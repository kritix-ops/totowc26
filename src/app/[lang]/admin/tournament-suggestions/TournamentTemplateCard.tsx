"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Award,
  Check,
  CircleDot,
  Crown,
  Footprints,
  Medal,
  RectangleHorizontal,
  Target,
} from "lucide-react";
import { clsx } from "clsx";
import { Card, PillButton, SectionHeading } from "@/components/ui";
import {
  COMMON_ADMIN_ERRORS,
  translateAdminError,
  type LocalizedTuple,
} from "@/lib/admin/errors";
import { localePath } from "@/lib/paths";
import type { Locale } from "@/app/[lang]/dictionaries";
import type { AnswerConfig } from "@/lib/bets/types";
import { usePendingAction } from "@/lib/use-pending-action";
import { publishTournamentTemplate } from "./actions";
import type { TournamentTemplate } from "./page";

// One template row: presents the suggested copy, lets the admin edit
// every field inline, and publishes a scope='tournament' custom bet
// on click. After publish the card flips to a confirmation chip so
// the admin can move on without losing scroll position.

export function TournamentTemplateCard({
  locale,
  template,
  maxPayout,
}: {
  locale: Locale;
  template: TournamentTemplate;
  maxPayout: number;
}) {
  const router = useRouter();
  const isHebrew = locale === "he";

  const [open, setOpen] = useState(false);
  const [published, setPublished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // When the server reports an existing active copy, we stash the id so
  // the warning panel can link the admin to it. Confirming "publish anyway"
  // re-submits with force=true.
  const [duplicateExistingId, setDuplicateExistingId] = useState<string | null>(null);
  const { pending, run } = usePendingAction();

  const [questionHe, setQuestionHe] = useState(template.questionHe);
  const [questionEn, setQuestionEn] = useState(template.questionEn);
  const [ruleHe, setRuleHe] = useState(template.gradingRuleHe);
  const [ruleEn, setRuleEn] = useState(template.gradingRuleEn);
  const [stake, setStake] = useState(template.defaultStake);
  const [payout, setPayout] = useState(template.defaultPayout);

  const lockLocalDefault = isoToLocalInput(template.defaultLockAtIso);
  const [lockAtLocal, setLockAtLocal] = useState(lockLocalDefault);

  const submit = (force = false) => {
    setError(null);
    if (!force) setDuplicateExistingId(null);
    const lockAtIso = localInputToIso(lockAtLocal);
    if (!lockAtIso) {
      setError("lock_in_past");
      return;
    }
    const answerConfig = buildAnswerConfig(template);
    void run(async () => {
      const res = await publishTournamentTemplate({
        questionHe,
        questionEn,
        gradingRuleHe: ruleHe,
        gradingRuleEn: ruleEn,
        answerType: template.answerType,
        answerConfig,
        stake,
        payout,
        lockAt: lockAtIso,
        force,
      });
      if (!res.ok) {
        if (res.error === "duplicate_exists") {
          setDuplicateExistingId(res.existingId);
          return;
        }
        setError(res.error);
        return;
      }
      setDuplicateExistingId(null);
      setPublished(true);
      router.refresh();
    });
  };

  if (published) {
    return (
      <Card className="p-4 md:p-5 flex items-center justify-between gap-3 bg-secondary-container text-on-secondary-container border border-secondary-fixed">
        <span className="inline-flex items-center gap-2 text-base font-bold">
          <Check className="h-5 w-5" strokeWidth={2.5} />
          {isHebrew ? "פורסם" : "Published"}
        </span>
        <span className="text-sm">
          {isHebrew ? template.titleHe : template.titleEn}
        </span>
      </Card>
    );
  }

  return (
    <Card className="p-4 md:p-5 flex flex-col gap-3">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-tertiary-fixed text-on-tertiary-fixed-variant shrink-0">
            <TemplateIcon iconKey={template.iconKey} />
          </span>
          <div className="flex flex-col gap-0.5 min-w-0">
            <SectionHeading underline="thin" as="h2">
              {isHebrew ? template.titleHe : template.titleEn}
            </SectionHeading>
            <p className="text-xs text-on-surface-variant">
              {isHebrew ? template.helperHe : template.helperEn}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="press-down min-h-[40px] px-3 inline-flex items-center justify-center rounded-full bg-surface-container-low text-on-surface border border-outline text-sm font-bold"
          >
            {open
              ? isHebrew ? "סגור עריכה" : "Close editor"
              : isHebrew ? "ערוך" : "Edit"}
          </button>
          <PillButton
            type="button"
            onClick={() => submit(false)}
            disabled={pending}
            className={clsx(
              "min-h-[40px] px-5",
              pending && "opacity-60 cursor-not-allowed",
            )}
          >
            {pending
              ? isHebrew ? "מפרסם..." : "Publishing..."
              : isHebrew ? "פרסם" : "Publish"}
          </PillButton>
        </div>
      </header>

      <div className="flex items-center gap-3 tabular-nums bidi-ltr text-sm">
        <span className="text-on-surface-variant">
          {isHebrew ? "השקעה" : "Stake"}
        </span>
        <span className="font-bold">{stake}</span>
        <span className="text-on-surface-variant">→</span>
        <span className="text-on-surface-variant">
          {isHebrew ? "תשלום" : "Payout"}
        </span>
        <span className="font-bold text-surface-tint">{payout}</span>
        <span className="text-[11px] text-on-surface-variant ms-2">
          {isHebrew ? "תקרת מערכת:" : "Cap:"} {maxPayout}
        </span>
      </div>

      {open && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-outline-variant">
          <label className="flex flex-col gap-1 text-xs font-bold text-on-surface">
            {isHebrew ? "שאלה (עברית)" : "Question (Hebrew)"}
            <input
              type="text"
              value={questionHe}
              onChange={(e) => setQuestionHe(e.target.value)}
              maxLength={200}
              className="h-10 px-2 rounded-md border border-outline bg-surface-container-lowest text-sm"
              dir="rtl"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-bold text-on-surface">
            {isHebrew ? "שאלה (אנגלית)" : "Question (English)"}
            <input
              type="text"
              value={questionEn}
              onChange={(e) => setQuestionEn(e.target.value)}
              maxLength={200}
              className="h-10 px-2 rounded-md border border-outline bg-surface-container-lowest text-sm"
              dir="ltr"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-bold text-on-surface md:col-span-2">
            {isHebrew ? "כלל הכרעה (עברית)" : "Grading rule (Hebrew)"}
            <textarea
              value={ruleHe}
              onChange={(e) => setRuleHe(e.target.value)}
              rows={2}
              maxLength={400}
              className="px-2 py-1.5 rounded-md border border-outline bg-surface-container-lowest text-sm"
              dir="rtl"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-bold text-on-surface md:col-span-2">
            {isHebrew ? "כלל הכרעה (אנגלית)" : "Grading rule (English)"}
            <textarea
              value={ruleEn}
              onChange={(e) => setRuleEn(e.target.value)}
              rows={2}
              maxLength={400}
              className="px-2 py-1.5 rounded-md border border-outline bg-surface-container-lowest text-sm"
              dir="ltr"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-bold text-on-surface">
            {isHebrew ? "השקעה" : "Stake"}
            <input
              type="number"
              min={1}
              max={maxPayout - 1}
              value={stake}
              onChange={(e) =>
                setStake(
                  Math.max(1, Math.min(maxPayout - 1, Math.trunc(Number(e.target.value) || 0))),
                )
              }
              className="h-10 px-2 rounded-md border border-outline bg-surface-container-lowest text-sm tabular-nums"
              dir="ltr"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-bold text-on-surface">
            {isHebrew ? "תשלום" : "Payout"}
            <input
              type="number"
              min={stake + 1}
              max={maxPayout}
              value={payout}
              onChange={(e) =>
                setPayout(
                  Math.max(stake + 1, Math.min(maxPayout, Math.trunc(Number(e.target.value) || 0))),
                )
              }
              className="h-10 px-2 rounded-md border border-outline bg-surface-container-lowest text-sm tabular-nums"
              dir="ltr"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-bold text-on-surface md:col-span-2">
            {isHebrew ? "תאריך נעילה" : "Lock at"}
            <input
              type="datetime-local"
              value={lockAtLocal}
              onChange={(e) => setLockAtLocal(e.target.value)}
              className="h-10 px-2 rounded-md border border-outline bg-surface-container-lowest text-sm tabular-nums"
              dir="ltr"
            />
            <span className="text-[10px] text-on-surface-variant font-normal">
              {isHebrew
                ? "לרוב 5 דקות לפני המשחק הראשון שמשפיע על ההכרעה."
                : "Usually 5 minutes before the first match that affects the outcome."}
            </span>
          </label>
        </div>
      )}

      {duplicateExistingId && (
        <div className="rounded-lg border border-tertiary-fixed-dim bg-tertiary-fixed text-on-tertiary-fixed-variant p-3 flex flex-col gap-2">
          <p className="inline-flex items-center gap-1.5 text-sm font-bold">
            <AlertCircle className="h-4 w-4" strokeWidth={2.5} />
            {isHebrew
              ? "כבר קיים הימור פעיל עם השאלה הזו."
              : "An active bet already exists with this question."}
          </p>
          <p className="text-xs">
            {isHebrew
              ? "המשתתפים יראו את הרשומה הקיימת. אם בכל זאת תפרסם עכשיו, יווצרו שתי רשומות זהות שיופיעו פעמיים במסך ההימורים."
              : "Players already see the existing copy. Publishing again creates a second identical record that will appear twice in the player view."}
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href={localePath(locale, `admin/bets/${duplicateExistingId}`)}
              className="inline-flex items-center justify-center gap-1.5 min-h-[36px] px-3 rounded-full border border-outline bg-surface-container-lowest text-on-surface text-xs font-bold hover:bg-surface-container"
            >
              {isHebrew ? "פתח את הקיים" : "Open existing"}
            </Link>
            <PillButton
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => submit(true)}
              className="min-h-[36px] py-1.5 px-3 text-xs"
            >
              {isHebrew ? "פרסם בכל זאת" : "Publish anyway"}
            </PillButton>
            <button
              type="button"
              onClick={() => setDuplicateExistingId(null)}
              className="press-down min-h-[36px] px-3 inline-flex items-center justify-center rounded-full bg-surface-container-lowest text-on-surface text-xs font-bold border border-outline"
            >
              {isHebrew ? "ביטול" : "Dismiss"}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="inline-flex items-center gap-1.5 text-sm text-error">
          <AlertCircle className="h-4 w-4" strokeWidth={2} />
          {translateError(error, isHebrew)}
        </p>
      )}
    </Card>
  );
}

function TemplateIcon({ iconKey }: { iconKey: TournamentTemplate["iconKey"] }) {
  const props = { className: "h-5 w-5", strokeWidth: 1.75 } as const;
  switch (iconKey) {
    case "crown":   return <Crown {...props} />;
    case "medal":   return <Medal {...props} />;
    case "boot":    return <Footprints {...props} />;
    case "goal":    return <Target {...props} />;
    case "card":    return <RectangleHorizontal {...props} />;
    case "penalty": return <CircleDot {...props} />;
    case "award":   return <Award {...props} />;
    default:        return <Award {...props} />;
  }
}

function buildAnswerConfig(template: TournamentTemplate): AnswerConfig {
  switch (template.answerType) {
    case "yes_no":
      return { kind: "yes_no" };
    case "number":
      return {
        kind: "number",
        min: template.numberMin,
        max: template.numberMax,
        unit: (template.numberUnit as "goals" | "corners" | "cards" | "shots" | "minutes" | "") ?? "",
      };
    case "multi_choice":
      // dynamicSource templates (top scorer, golden ball, ...) store
      // an empty options[] and the picker hydrates the full WC roster
      // from /api/picker-options at view time. Keeps each bet's
      // answer_config jsonb at ~120 bytes instead of ~200 KB.
      if (template.dynamicSource) {
        return {
          kind: "multi_choice",
          options: [],
          dynamicSource: template.dynamicSource,
        };
      }
      return {
        kind: "multi_choice",
        options: template.answerOptions ?? [],
      };
    case "free_text":
      return { kind: "free_text" };
  }
}

// datetime-local inputs use local time without a TZ suffix. Convert
// the ISO string into the right shape and back without losing the
// admin's intent.
function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const offsetMs = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - offsetMs).toISOString().slice(0, 16);
}

function localInputToIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getTime() <= Date.now()) return null;
  return d.toISOString();
}

const ERROR_MAP = {
  ...COMMON_ADMIN_ERRORS,
  invalid_input: ["ערכים לא תקינים", "Invalid values"],
  lock_in_past:  ["תאריך הנעילה בעבר", "Lock time is in the past"],
} as const satisfies Record<string, LocalizedTuple>;

function translateError(code: string, isHebrew: boolean): string {
  return translateAdminError(code in ERROR_MAP ? code : "db", ERROR_MAP, isHebrew);
}
