import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight, Copy } from "lucide-react";
import { hasLocale, type Locale } from "../../../dictionaries";
import { Card, Chip, LabelCaps, SectionHeading } from "@/components/ui";
import { localePath } from "@/lib/paths";
import { formatDateTime } from "@/lib/format";
import {
  listDuplicateCustomBets,
  type AdminDuplicateBetRow,
} from "@/db/admin-queries";
import { DuplicateRowActions } from "./DuplicateRowActions";

// Surfaces every (scope, anchor, question_he) triplet that has 2+ active
// rows in custom_bets. Each group renders as a panel where the admin picks
// which row to keep and presses "Cancel" on the rest. Cancelling soft-flips
// status to 'cancelled', which removes the row from /bets/tournament (that
// page filters on status in ('open','locked')) without losing the audit trail.
export default async function AdminBetsDuplicatesPage({
  params,
}: PageProps<"/[lang]/admin/bets/duplicates">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const isHebrew = locale === "he";
  const Chev = isHebrew ? ChevronLeft : ChevronRight;

  const rows = await listDuplicateCustomBets();
  const groups = groupByDedupKey(rows);

  return (
    <section className="px-4 md:px-16 py-6 md:py-12 flex flex-col gap-6 md:gap-8 max-w-5xl mx-auto w-full pb-24">
      <header className="flex flex-col gap-3">
        <Link
          href={localePath(locale, "admin/bets")}
          className="inline-flex items-center gap-1 text-sm text-on-surface-variant hover:text-on-surface w-fit"
        >
          <Chev className="h-4 w-4" strokeWidth={2} />
          {isHebrew ? "חזרה להימורים" : "Back to bets"}
        </Link>
        <div className="flex flex-col gap-2">
          <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-9 md:text-[40px] md:leading-[44px] font-bold text-primary inline-flex items-center gap-3">
            <Copy className="h-6 w-6 md:h-7 md:w-7" strokeWidth={1.75} />
            {isHebrew ? "כפילויות הימורים" : "Duplicate bets"}
          </h1>
          <p className="text-sm text-on-surface-variant">
            {isHebrew
              ? "כאן רואים הימורים פעילים שמופיעים פעמיים או יותר עם אותה שאלה ואותו עוגן (טורניר/שלב/בית/יום/משחק). בחר איזה רשומה להשאיר ובטל את האחרות — ביטול מסיר את הרשומה ממסך המשתתפים בלי למחוק נתונים."
              : "Active bets that appear twice or more with the same question + anchor (tournament / stage / group / day / match). Keep one row, cancel the rest — cancellation removes the row from the player view without deleting data."}
          </p>
        </div>
      </header>

      {groups.length === 0 ? (
        <Card className="p-6 text-center text-on-surface-variant">
          {isHebrew
            ? "אין כפילויות פעילות. הכל נקי."
            : "No active duplicates. All clear."}
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((group) => (
            <DuplicateGroup
              key={group.key}
              locale={locale}
              group={group}
            />
          ))}
        </div>
      )}
    </section>
  );
}

type Group = {
  key: string;
  rows: AdminDuplicateBetRow[];
};

function groupByDedupKey(rows: AdminDuplicateBetRow[]): Group[] {
  const map = new Map<string, AdminDuplicateBetRow[]>();
  for (const row of rows) {
    const list = map.get(row.dedupKey);
    if (list) list.push(row);
    else map.set(row.dedupKey, [row]);
  }
  return Array.from(map.entries()).map(([key, rows]) => ({ key, rows }));
}

function DuplicateGroup({
  locale,
  group,
}: {
  locale: Locale;
  group: Group;
}) {
  const isHebrew = locale === "he";
  const first = group.rows[0];
  return (
    <Card className="p-4 md:p-5 flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <SectionHeading as="h2" underline="thin" className="!text-lg md:!text-xl !leading-tight">
          {isHebrew ? first.questionHe : first.questionEn}
        </SectionHeading>
        <div className="flex flex-wrap gap-2 items-center">
          <Chip tone="warning">
            {isHebrew
              ? `${group.rows.length} עותקים`
              : `${group.rows.length} copies`}
          </Chip>
          <Chip tone="secondary">{scopeLabel(first, isHebrew)}</Chip>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {group.rows.map((row, idx) => (
          <DuplicateRow
            key={row.id}
            locale={locale}
            row={row}
            index={idx + 1}
          />
        ))}
      </div>
    </Card>
  );
}

function DuplicateRow({
  locale,
  row,
  index,
}: {
  locale: Locale;
  row: AdminDuplicateBetRow;
  index: number;
}) {
  const isHebrew = locale === "he";
  const lockLabel = formatDateTime(row.lockAt, locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const createdLabel = formatDateTime(row.createdAt, locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="border border-outline-variant rounded-lg p-3 md:p-4 flex flex-col gap-3 bg-surface-container-lowest">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <LabelCaps>
              {isHebrew ? `עותק #${index}` : `Copy #${index}`}
            </LabelCaps>
            <Chip tone={statusTone(row.status)}>
              {statusLabel(row.status, isHebrew)}
            </Chip>
            {row.pickCount > 0 && (
              <Chip tone="warning">
                {isHebrew
                  ? `${row.pickCount} ניחושים`
                  : `${row.pickCount} picks`}
              </Chip>
            )}
          </div>
          <span className="text-[11px] text-on-surface-variant font-mono break-all">
            {row.id}
          </span>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
        <div className="flex flex-col">
          <dt className="text-xs text-on-surface-variant">
            {isHebrew ? "נסגר" : "Locks"}
          </dt>
          <dd className="font-bold tabular-nums">{lockLabel}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-xs text-on-surface-variant">
            {isHebrew ? "נוצר" : "Created"}
          </dt>
          <dd className="font-bold tabular-nums">{createdLabel}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-xs text-on-surface-variant">
            {isHebrew ? "עלות" : "Stake"}
          </dt>
          <dd className="font-bold tabular-nums">{row.stakeSnapshot}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-xs text-on-surface-variant">
            {isHebrew ? "תשלום" : "Payout"}
          </dt>
          <dd className="font-bold tabular-nums">{row.payoutSnapshot}</dd>
        </div>
      </dl>

      <DuplicateRowActions
        locale={locale}
        id={row.id}
        hasPicks={row.pickCount > 0}
      />
    </div>
  );
}

function statusTone(s: AdminDuplicateBetRow["status"]): "default" | "primary" | "secondary" | "warning" {
  switch (s) {
    case "draft":     return "default";
    case "open":      return "primary";
    case "locked":    return "warning";
    case "graded":    return "secondary";
    case "reversed":  return "warning";
    case "cancelled": return "default";
  }
}

function statusLabel(s: AdminDuplicateBetRow["status"], isHebrew: boolean): string {
  const map: Record<AdminDuplicateBetRow["status"], [string, string]> = {
    draft:     ["טיוטה", "Draft"],
    open:      ["פתוח", "Open"],
    locked:    ["נסגר", "Locked"],
    graded:    ["נמדד", "Graded"],
    reversed:  ["הוחזר", "Reversed"],
    cancelled: ["בוטל", "Cancelled"],
  };
  return map[s][isHebrew ? 0 : 1];
}

function scopeLabel(row: AdminDuplicateBetRow, isHebrew: boolean): string {
  switch (row.scope) {
    case "match":
      return row.matchLabel ?? (isHebrew ? "משחק" : "Match");
    case "day":
      return row.matchdayDate ?? (isHebrew ? "יום" : "Day");
    case "stage":
      return `${isHebrew ? "שלב" : "Stage"}: ${row.stage}`;
    case "group":
      return `${isHebrew ? "בית" : "Group"} ${row.groupId}`;
    case "tournament":
      return isHebrew ? "טורניר" : "Tournament";
  }
}
