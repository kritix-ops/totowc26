import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus, ChevronLeft, ChevronRight, Copy } from "lucide-react";
import { hasLocale, type Locale } from "../../dictionaries";
import { Card, Chip, LabelCaps, PillButton, SectionHeading } from "@/components/ui";
import { localePath } from "@/lib/paths";
import { formatDateTime } from "@/lib/format";
import {
  countDuplicateCustomBets,
  listCustomBets,
  type AdminCustomBetRow,
} from "@/db/admin-queries";
import { BetsTableActions } from "./BetsTableActions";

export default async function AdminBetsPage({
  params,
  searchParams,
}: PageProps<"/[lang]/admin/bets">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const isHebrew = locale === "he";
  const Chev = isHebrew ? ChevronLeft : ChevronRight;
  const sp = await searchParams;
  const statusFilter = parseStatusFilter(sp.status);
  const scopeFilter = parseScopeFilter(sp.scope);

  const [bets, duplicateCount] = await Promise.all([
    listCustomBets({
      status: statusFilter,
      scope: scopeFilter,
      limit: 200,
    }),
    countDuplicateCustomBets(),
  ]);

  return (
    <section className="px-4 md:px-16 py-6 md:py-12 flex flex-col gap-6 md:gap-8 max-w-5xl mx-auto w-full pb-24">
      <header className="flex flex-col gap-3">
        <Link
          href={localePath(locale, "admin")}
          className="inline-flex items-center gap-1 text-sm text-on-surface-variant hover:text-on-surface w-fit"
        >
          <Chev className="h-4 w-4" strokeWidth={2} />
          {isHebrew ? "חזרה לניהול" : "Back to admin"}
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-9 md:text-[40px] md:leading-[44px] font-bold text-primary">
              {isHebrew ? "הימורי לייב" : "Live bets"}
            </h1>
            <p className="text-sm text-on-surface-variant">
              {isHebrew
                ? "צור, פרסם ונהל את כל ההימורים שאינם 1/X/2."
                : "Create, publish, and manage every non‑1/X/2 bet."}
            </p>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
            <Link href={localePath(locale, "admin/live-bets/suggestions")}>
              <PillButton
                type="button"
                variant="ghost"
                className="min-h-[48px]"
              >
                {isHebrew ? "הצעות יום משחקים" : "Matchday"}
              </PillButton>
            </Link>
            <Link href={localePath(locale, "admin/tournament-suggestions")}>
              <PillButton
                type="button"
                variant="ghost"
                className="min-h-[48px]"
              >
                {isHebrew ? "הימורי טורניר" : "Tournament bets"}
              </PillButton>
            </Link>
            <Link href={localePath(locale, "admin/bets/new")}>
              <PillButton type="button" className="min-h-[48px]">
                <Plus className="h-5 w-5" strokeWidth={2.5} />
                {isHebrew ? "הימור חדש" : "New bet"}
              </PillButton>
            </Link>
          </div>
        </div>
      </header>

      {duplicateCount > 0 && (
        <Link
          href={localePath(locale, "admin/bets/duplicates")}
          className="press-down block"
        >
          <Card className="p-4 md:p-5 flex items-center justify-between gap-3 bg-tertiary-fixed text-on-tertiary-fixed-variant border-tertiary-fixed-dim hover:brightness-105">
            <div className="flex items-center gap-3 min-w-0">
              <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-tertiary-fixed-dim/40 shrink-0">
                <Copy className="h-5 w-5" strokeWidth={2} />
              </span>
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="font-bold text-base">
                  {isHebrew
                    ? `נמצאו ${duplicateCount} הימורים כפולים פעילים`
                    : `${duplicateCount} active bets are duplicates`}
                </span>
                <span className="text-xs">
                  {isHebrew
                    ? "לחץ לסקירה ובחירת איזה רשומה להשאיר."
                    : "Tap to review and pick which copy to keep."}
                </span>
              </div>
            </div>
            <span className="text-sm font-bold underline shrink-0">
              {isHebrew ? "פתח" : "Open"}
            </span>
          </Card>
        </Link>
      )}

      <FilterBar
        locale={locale}
        statusFilter={statusFilter}
        scopeFilter={scopeFilter}
      />

      {bets.length === 0 ? (
        <Card className="p-6 text-center text-on-surface-variant">
          {isHebrew
            ? "אין הימורים שמתאימים לסינון. נסה לאפס את הסינון או ליצור הימור חדש."
            : "No bets match the filters. Clear filters or create a new bet."}
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {bets.map((bet) => (
            <BetCard key={bet.id} bet={bet} locale={locale} />
          ))}
        </div>
      )}
    </section>
  );
}

function parseStatusFilter(
  raw: string | string[] | undefined,
): AdminCustomBetRow["status"] | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (
    v === "draft" ||
    v === "open" ||
    v === "locked" ||
    v === "graded" ||
    v === "reversed" ||
    v === "cancelled"
  )
    return v;
  return null;
}

function parseScopeFilter(
  raw: string | string[] | undefined,
): AdminCustomBetRow["scope"] | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (
    v === "match" ||
    v === "day" ||
    v === "stage" ||
    v === "group" ||
    v === "tournament"
  )
    return v;
  return null;
}

function FilterBar({
  locale,
  statusFilter,
  scopeFilter,
}: {
  locale: Locale;
  statusFilter: AdminCustomBetRow["status"] | null;
  scopeFilter: AdminCustomBetRow["scope"] | null;
}) {
  const isHebrew = locale === "he";
  const statuses: Array<{ key: AdminCustomBetRow["status"] | "all"; label: string }> = [
    { key: "all",       label: isHebrew ? "הכל" : "All" },
    { key: "draft",     label: isHebrew ? "טיוטה" : "Draft" },
    { key: "open",      label: isHebrew ? "פתוח" : "Open" },
    { key: "locked",    label: isHebrew ? "נסגר" : "Locked" },
    { key: "graded",    label: isHebrew ? "נמדד" : "Graded" },
    { key: "cancelled", label: isHebrew ? "בוטל" : "Cancelled" },
  ];
  const scopes: Array<{ key: AdminCustomBetRow["scope"] | "all"; label: string }> = [
    { key: "all",        label: isHebrew ? "הכל" : "All scopes" },
    { key: "match",      label: isHebrew ? "משחק" : "Match" },
    { key: "day",        label: isHebrew ? "יום" : "Day" },
    { key: "stage",      label: isHebrew ? "שלב" : "Stage" },
    { key: "group",      label: isHebrew ? "בית" : "Group" },
    { key: "tournament", label: isHebrew ? "טורניר" : "Tournament" },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <LabelCaps>{isHebrew ? "סטטוס" : "Status"}</LabelCaps>
        <div className="flex flex-wrap gap-2">
          {statuses.map((s) => (
            <FilterChip
              key={s.key}
              label={s.label}
              paramKey="status"
              paramValue={s.key === "all" ? null : s.key}
              active={
                s.key === "all"
                  ? statusFilter === null
                  : statusFilter === s.key
              }
            />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <LabelCaps>{isHebrew ? "סוג" : "Scope"}</LabelCaps>
        <div className="flex flex-wrap gap-2">
          {scopes.map((s) => (
            <FilterChip
              key={s.key}
              label={s.label}
              paramKey="scope"
              paramValue={s.key === "all" ? null : s.key}
              active={
                s.key === "all"
                  ? scopeFilter === null
                  : scopeFilter === s.key
              }
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function FilterChip({
  label,
  paramKey,
  paramValue,
  active,
}: {
  label: string;
  paramKey: "status" | "scope";
  paramValue: string | null;
  active: boolean;
}) {
  // The chip writes its filter into the URL query string so the page is
  // a pure server-component with no client state. `replace: true` keeps
  // the history clean while the admin scrolls through filter options.
  const href = paramValue
    ? `?${paramKey}=${paramValue}`
    : `?${paramKey}=`;
  return (
    <Link href={href} replace scroll={false}>
      <Chip tone={active ? "primary" : "default"} className="min-h-[36px] cursor-pointer">
        {label}
      </Chip>
    </Link>
  );
}

function BetCard({
  bet,
  locale,
}: {
  bet: AdminCustomBetRow;
  locale: Locale;
}) {
  const isHebrew = locale === "he";
  const question = isHebrew ? bet.questionHe : bet.questionEn;
  const lockLabel = formatDateTime(bet.lockAt, locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <Card className="p-4 md:p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <SectionHeading as="h3" underline="thin" className="text-lg md:text-xl !leading-tight">
            {question}
          </SectionHeading>
          <div className="flex flex-wrap gap-2 items-center mt-1">
            <Chip tone={statusTone(bet.status)}>
              {statusLabel(bet.status, isHebrew)}
            </Chip>
            <Chip tone="secondary">{scopeLabel(bet, isHebrew)}</Chip>
            <Chip>{answerTypeLabel(bet.answerType, isHebrew)}</Chip>
            <Chip>{gradingSourceLabel(bet.gradingSource, isHebrew)}</Chip>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <LabelCaps>{isHebrew ? "נסגר" : "Locks"}</LabelCaps>
          <span className="font-[family-name:var(--font-label)] text-sm font-bold tabular-nums">
            {lockLabel}
          </span>
          <LabelCaps className="mt-1">{isHebrew ? "הימרו" : "Picks"}</LabelCaps>
          <span className="font-[family-name:var(--font-label)] text-sm font-bold tabular-nums">
            <bdi>{bet.pickCount}</bdi>
          </span>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 flex-wrap pt-3 border-t border-outline-variant">
        <p className="text-sm text-on-surface-variant">
          {isHebrew
            ? `עלות ${bet.stakeSnapshot} · זכייה ${bet.payoutSnapshot}`
            : `Stake ${bet.stakeSnapshot} · Payout ${bet.payoutSnapshot}`}
        </p>
        <BetsTableActions
          locale={locale}
          id={bet.id}
          status={bet.status}
        />
      </div>
    </Card>
  );
}

function statusTone(s: AdminCustomBetRow["status"]): "default" | "primary" | "secondary" | "warning" {
  switch (s) {
    case "draft":     return "default";
    case "open":      return "primary";
    case "locked":    return "warning";
    case "graded":    return "secondary";
    case "reversed":  return "warning";
    case "cancelled": return "default";
  }
}

function statusLabel(s: AdminCustomBetRow["status"], isHebrew: boolean): string {
  const map: Record<AdminCustomBetRow["status"], [string, string]> = {
    draft:     ["טיוטה", "Draft"],
    open:      ["פתוח", "Open"],
    locked:    ["נסגר", "Locked"],
    graded:    ["נמדד", "Graded"],
    reversed:  ["הוחזר", "Reversed"],
    cancelled: ["בוטל", "Cancelled"],
  };
  return map[s][isHebrew ? 0 : 1];
}

function scopeLabel(bet: AdminCustomBetRow, isHebrew: boolean): string {
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
}

function answerTypeLabel(
  t: AdminCustomBetRow["answerType"],
  isHebrew: boolean,
): string {
  const map: Record<AdminCustomBetRow["answerType"], [string, string]> = {
    yes_no:       ["כן/לא", "Yes/No"],
    number:       ["מספר", "Number"],
    multi_choice: ["בחירה", "Choice"],
    free_text:    ["טקסט", "Text"],
  };
  return map[t][isHebrew ? 0 : 1];
}

function gradingSourceLabel(
  s: AdminCustomBetRow["gradingSource"],
  isHebrew: boolean,
): string {
  const map: Record<AdminCustomBetRow["gradingSource"], [string, string]> = {
    auto_api_football:  ["אוטו (API-Football)", "Auto (API-Football)"],
    auto_football_data: ["אוטו (תוצאה)", "Auto (score)"],
    manual:             ["ידני", "Manual"],
  };
  return map[s][isHebrew ? 0 : 1];
}
