import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight, Trophy } from "lucide-react";
import { hasLocale, type Locale } from "../../../dictionaries";
import { Card, Chip, LabelCaps, SectionHeading } from "@/components/ui";
import { localePath } from "@/lib/paths";
import { formatDateTime } from "@/lib/format";
import { getAdminCustomBetDetail } from "@/db/admin-queries";
import { GradeForm } from "./GradeForm";

export default async function AdminBetDetailPage({
  params,
}: PageProps<"/[lang]/admin/bets/[id]">) {
  const { lang, id } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const isHebrew = locale === "he";
  const Chev = isHebrew ? ChevronLeft : ChevronRight;

  const bet = await getAdminCustomBetDetail(id);
  if (!bet) notFound();

  const question = isHebrew ? bet.questionHe : bet.questionEn;
  const gradingRule = isHebrew ? bet.gradingRuleHe : bet.gradingRuleEn;
  const lockLabel = formatDateTime(bet.lockAt, locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  const winners = bet.picks.filter((p) => p.wasCorrect === true).length;

  return (
    <section className="px-4 md:px-16 py-6 md:py-12 flex flex-col gap-6 md:gap-8 max-w-3xl mx-auto w-full pb-24">
      <header className="flex flex-col gap-3">
        <Link
          href={localePath(locale, "admin/bets")}
          className="inline-flex items-center gap-1 text-sm text-on-surface-variant hover:text-on-surface w-fit"
        >
          <Chev className="h-4 w-4" strokeWidth={2} />
          {isHebrew ? "חזרה לרשימה" : "Back to list"}
        </Link>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <h1 className="font-[family-name:var(--font-display)] text-[24px] leading-8 md:text-[36px] md:leading-[40px] font-bold text-primary">
            {question}
          </h1>
          <Chip tone={statusTone(bet.status)}>
            {statusLabel(bet.status, isHebrew)}
          </Chip>
        </div>
      </header>

      {/* Metadata grid */}
      <Card className="p-5 md:p-6 grid grid-cols-2 md:grid-cols-4 gap-4">
        <Meta label={isHebrew ? "סוג" : "Scope"}>
          {scopeLabel(bet, isHebrew)}
        </Meta>
        <Meta label={isHebrew ? "סוג תשובה" : "Answer type"}>
          {answerTypeLabel(bet.answerType, isHebrew)}
        </Meta>
        <Meta label={isHebrew ? "מקור דירוג" : "Grading"}>
          {gradingSourceLabel(bet.gradingSource, isHebrew)}
        </Meta>
        <Meta label={isHebrew ? "נסגר" : "Locks"}>{lockLabel}</Meta>
        <Meta label={isHebrew ? "עלות" : "Stake"}>
          <bdi className="tabular-nums">{bet.stakeSnapshot}</bdi>
        </Meta>
        <Meta label={isHebrew ? "תשלום" : "Payout"}>
          <bdi className="tabular-nums">{bet.payoutSnapshot}</bdi>
        </Meta>
        <Meta label={isHebrew ? "מהמרים" : "Picks"}>
          <bdi className="tabular-nums">{bet.picks.length}</bdi>
        </Meta>
        {bet.status === "graded" && (
          <Meta label={isHebrew ? "צודקים" : "Winners"}>
            <span className="inline-flex items-center gap-1.5 font-bold text-secondary">
              <Trophy className="h-4 w-4" strokeWidth={2} />
              <bdi className="tabular-nums">{winners}</bdi>
            </span>
          </Meta>
        )}
      </Card>

      {/* Grading rule contract */}
      <Card className="p-5 md:p-6 flex flex-col gap-2">
        <LabelCaps>{isHebrew ? "כלל דירוג" : "Grading rule"}</LabelCaps>
        <p className="text-base">{gradingRule}</p>
      </Card>

      {/* Grade form OR resolved-value display */}
      <GradeForm
        locale={locale}
        bet={{
          id: bet.id,
          status: bet.status,
          answerType: bet.answerType,
          answerConfig: bet.answerConfig,
          resolvedValue: bet.resolvedValue,
          payoutSnapshot: bet.payoutSnapshot,
        }}
      />

      {/* Picks table */}
      <section className="flex flex-col gap-3">
        <SectionHeading as="h2" underline="thin">
          {isHebrew ? "ניחושים" : "Picks"}
        </SectionHeading>
        {bet.picks.length === 0 ? (
          <Card className="p-6 text-center text-on-surface-variant">
            {isHebrew ? "עוד אין ניחושים." : "No picks yet."}
          </Card>
        ) : (
          <div className="flex flex-col gap-2">
            {bet.picks.map((p) => (
              <Card key={p.pickId} className="p-4 flex items-center justify-between gap-3 flex-wrap">
                <div className="flex flex-col gap-1 min-w-0 flex-1">
                  <span className="font-bold text-on-surface truncate">
                    {p.displayName}
                  </span>
                  <span className="text-xs text-on-surface-variant tabular-nums">
                    {formatDateTime(p.createdAt, locale, {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <Chip
                    tone={
                      p.wasCorrect === true
                        ? "secondary"
                        : p.wasCorrect === false
                          ? "default"
                          : "primary"
                    }
                  >
                    {renderAnswer(bet.answerType, bet.answerConfig, p.answer, isHebrew)}
                  </Chip>
                  {p.pointsEarned !== null && (
                    <span className="font-[family-name:var(--font-label)] text-sm font-bold tabular-nums">
                      {p.pointsEarned > 0 ? "+" : ""}
                      {p.pointsEarned}
                    </span>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}

function Meta({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <LabelCaps>{label}</LabelCaps>
      <span className="text-sm font-bold text-on-surface tabular-nums">
        {children}
      </span>
    </div>
  );
}

function statusTone(s: string): "default" | "primary" | "secondary" | "warning" {
  switch (s) {
    case "draft":     return "default";
    case "open":      return "primary";
    case "locked":    return "warning";
    case "graded":    return "secondary";
    case "reversed":  return "warning";
    case "cancelled": return "default";
  }
  return "default";
}

function statusLabel(s: string, isHebrew: boolean): string {
  const map: Record<string, [string, string]> = {
    draft:     ["טיוטה", "Draft"],
    open:      ["פתוח", "Open"],
    locked:    ["נסגר", "Locked"],
    graded:    ["נמדד", "Graded"],
    reversed:  ["הוחזר", "Reversed"],
    cancelled: ["בוטל", "Cancelled"],
  };
  return (map[s] ?? [s, s])[isHebrew ? 0 : 1];
}

function scopeLabel(
  bet: { scope: string; matchLabel: string | null; matchdayDate: string | null; stage: string | null; groupId: string | null },
  isHebrew: boolean,
): string {
  switch (bet.scope) {
    case "match":
      return bet.matchLabel ?? (isHebrew ? "משחק" : "Match");
    case "day":
      return bet.matchdayDate ?? (isHebrew ? "יום" : "Day");
    case "stage":
      return `${isHebrew ? "שלב" : "Stage"}: ${bet.stage}`;
    case "group":
      return `${isHebrew ? "בית" : "Group"} ${bet.groupId}`;
    case "tournament":
      return isHebrew ? "טורניר" : "Tournament";
  }
  return bet.scope;
}

function answerTypeLabel(t: string, isHebrew: boolean): string {
  const map: Record<string, [string, string]> = {
    yes_no:       ["כן/לא", "Yes/No"],
    number:       ["מספר", "Number"],
    multi_choice: ["בחירה", "Choice"],
    free_text:    ["טקסט", "Text"],
  };
  return (map[t] ?? [t, t])[isHebrew ? 0 : 1];
}

function gradingSourceLabel(s: string, isHebrew: boolean): string {
  const map: Record<string, [string, string]> = {
    auto_balldontlie:   ["balldontlie", "balldontlie"],
    auto_football_data: ["אוטו (תוצאה)", "Auto (score)"],
    manual:             ["ידני", "Manual"],
  };
  return (map[s] ?? [s, s])[isHebrew ? 0 : 1];
}

// Display the player's answer in a humane way for the picks list. We
// resolve multi_choice values to their label so the chip says "ברזיל"
// instead of "brazil".
function renderAnswer(
  answerType: string,
  config: unknown,
  answer: unknown,
  isHebrew: boolean,
): string {
  if (!answer || typeof answer !== "object") {
    return isHebrew ? "—" : "—";
  }
  const a = answer as { type?: string; value?: unknown };
  if (a.type === "yes_no") {
    return a.value ? (isHebrew ? "כן" : "Yes") : (isHebrew ? "לא" : "No");
  }
  if (a.type === "number") {
    return String(a.value ?? "—");
  }
  if (a.type === "multi_choice" && typeof a.value === "string") {
    const c = config as { options?: Array<{ value: string; labelHe: string; labelEn: string }> } | null;
    const opt = c?.options?.find((o) => o.value === a.value);
    if (opt) return isHebrew ? opt.labelHe : opt.labelEn;
    return a.value;
  }
  if (a.type === "free_text" && typeof a.value === "string") {
    return a.value;
  }
  return "—";
}
