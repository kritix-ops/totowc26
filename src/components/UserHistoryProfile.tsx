import { clsx } from "clsx";
import { Card, LabelCaps, SectionHeading } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import {
  splitPendingSettled,
  type UserHistoryCategory,
  type UserHistoryRow,
  type UserHistorySummary,
} from "@/lib/transparency-history";
import type { Dictionary, Locale } from "@/app/[lang]/dictionaries";

// One player's complete betting history: a summary card first, then the
// pending (awaiting-result) bets, then the settled timeline newest-first.
// Stacked cards only — no tables — per the mobile rules. Every number is
// points, never money, stated once under the summary.

type TKeys = Dictionary["transparency"];

export const CATEGORY_LABEL: Record<UserHistoryCategory, keyof TKeys> = {
  match: "categoryMatch",
  live: "categoryLive",
  tournament: "categoryTournament",
  group: "categoryGroup",
  duel: "categoryDuel",
};

export function UserHistoryProfile({
  locale,
  dict,
  name,
  rows,
  summary,
}: {
  locale: Locale;
  dict: Dictionary;
  name: string;
  rows: UserHistoryRow[];
  summary: UserHistorySummary;
}) {
  const t = dict.transparency;
  const { pending, settled } = splitPendingSettled(rows);

  return (
    <div className="flex flex-col gap-5">
      <SummaryCard t={t} name={name} summary={summary} />

      {rows.length === 0 ? (
        <Card className="p-6 text-center text-on-surface-variant">
          {t.historyEmpty}
        </Card>
      ) : (
        <>
          {pending.length > 0 && (
            <section className="flex flex-col gap-2">
              <SectionHeading underline="thin" as="h2">
                {t.pendingSection}
                <span className="ms-2 text-on-surface-variant tabular-nums">
                  {pending.length}
                </span>
              </SectionHeading>
              <ul className="flex flex-col gap-2">
                {pending.map((r) => (
                  <li key={`${r.category}-${r.refId}`}>
                    <HistoryRowCard locale={locale} t={t} row={r} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {settled.length > 0 && (
            <section className="flex flex-col gap-2">
              <SectionHeading underline="thin" as="h2">
                {t.settledSection}
                <span className="ms-2 text-on-surface-variant tabular-nums">
                  {settled.length}
                </span>
              </SectionHeading>
              <ul className="flex flex-col gap-2">
                {settled.map((r) => (
                  <li key={`${r.category}-${r.refId}`}>
                    <HistoryRowCard locale={locale} t={t} row={r} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function SummaryCard({
  t,
  name,
  summary,
}: {
  t: TKeys;
  name: string;
  summary: UserHistorySummary;
}) {
  return (
    <Card className="p-5 md:p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <SectionHeading underline="thin" as="h2">
          {name}
        </SectionHeading>
        <span className="text-xs text-on-surface-variant">{t.pointsNotMoney}</span>
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="font-bold text-on-surface">{t.summaryNet}</span>
        <NetValue value={summary.net} className="text-3xl md:text-4xl" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label={t.betsCount} value={summary.totalBets} />
        <Tile label={t.summaryStaked} value={summary.totalStaked} />
        <Tile label={t.summaryWon} value={summary.totalWon} tone="positive" />
        <Tile label={t.summaryLost} value={summary.totalLost} tone="negative" />
      </div>

      <div className="grid grid-cols-3 gap-3 pt-3 border-t border-outline-variant">
        <Tile label={t.recordWins} value={summary.wins} tone="positive" countOnly />
        <Tile label={t.recordLosses} value={summary.losses} tone="negative" countOnly />
        <Tile label={t.recordPending} value={summary.pendingCount} countOnly />
      </div>
    </Card>
  );
}

function Tile({
  label,
  value,
  tone,
  countOnly,
}: {
  label: string;
  value: number;
  tone?: "positive" | "negative";
  countOnly?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 p-3 rounded-lg bg-surface-container-low border border-outline-variant">
      <LabelCaps as="div">{label}</LabelCaps>
      <span
        className={clsx(
          "font-[family-name:var(--font-score)] text-xl md:text-2xl font-bold tabular-nums",
          tone === "positive" && value !== 0 && "text-secondary",
          tone === "negative" && value !== 0 && "text-error",
        )}
      >
        <bdi>
          {!countOnly && tone === "positive" && value !== 0 ? "+" : ""}
          {!countOnly && tone === "negative" && value !== 0 ? "-" : ""}
          {value}
        </bdi>
      </span>
    </div>
  );
}

// Signed points value with sign-aware colour. Shared with the head-to-head
// view so the two surfaces render points identically.
export function NetValue({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        "font-[family-name:var(--font-score)] font-bold tabular-nums",
        value > 0 ? "text-secondary" : value < 0 ? "text-error" : "text-on-surface",
        className,
      )}
    >
      <bdi>
        {value > 0 ? "+" : ""}
        {value}
      </bdi>
    </span>
  );
}

// Small pill: a settled bet shows its signed net; a pending bet shows the
// "awaiting result" label instead of a number.
export function NetChip({
  net,
  isPending,
  pendingLabel,
}: {
  net: number | null;
  isPending: boolean;
  pendingLabel: string;
}) {
  if (isPending || net === null) {
    return (
      <span className="inline-flex items-center justify-center px-2.5 h-7 rounded-full bg-surface-container-high text-on-surface-variant text-xs font-bold">
        {pendingLabel}
      </span>
    );
  }
  const tone =
    net > 0
      ? "bg-secondary-container text-on-secondary-container"
      : net < 0
        ? "bg-error-container text-on-error-container"
        : "bg-surface-container-high text-on-surface-variant";
  return (
    <span
      className={clsx(
        "inline-flex items-center justify-center px-2.5 h-7 rounded-full font-[family-name:var(--font-score)] text-base font-bold tabular-nums",
        tone,
      )}
    >
      <bdi>
        {net > 0 ? "+" : ""}
        {net}
      </bdi>
    </span>
  );
}

function HistoryRowCard({
  locale,
  t,
  row,
}: {
  locale: Locale;
  t: TKeys;
  row: UserHistoryRow;
}) {
  const isHebrew = locale === "he";
  const categoryLabel = t[CATEGORY_LABEL[row.category]];
  const context =
    row.category === "duel"
      ? row.opponentName
        ? `${t.vsLabel} ${row.opponentName}`
        : t.noOpponentYet
      : row.contextLabel;

  return (
    <Card className="p-4 md:p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 px-2 h-6 rounded-full text-[11px] font-bold bg-surface-container-high text-on-surface-variant">
          {categoryLabel}
        </span>
        <span className="text-[11px] text-outline tabular-nums">
          {row.stake > 0 && (
            <>
              {t.stakeLabel} <bdi>{row.stake}</bdi>
              {" · "}
            </>
          )}
          {formatDateTime(row.sortTs, locale, {
            day: "numeric",
            month: "short",
          })}
        </span>
      </div>

      <div className="flex flex-col gap-0.5">
        <p className="font-bold text-sm md:text-base text-on-surface">
          {row.question}
        </p>
        {context && (
          <p className="text-xs text-on-surface-variant">{context}</p>
        )}
      </div>

      <div className="grid grid-cols-[1fr_1fr_auto] gap-3 pt-2 border-t border-outline-variant items-center">
        <Cell label={t.pickHeading}>
          <span
            className="text-sm md:text-base font-bold text-on-surface truncate"
            title={row.pickLabel}
            dir={isHebrew ? "rtl" : "ltr"}
          >
            {row.pickLabel}
          </span>
        </Cell>
        <Cell label={t.resultHeading}>
          <span
            className="text-sm md:text-base font-bold text-on-surface truncate"
            title={row.resultLabel ?? undefined}
          >
            {row.resultLabel ?? "—"}
          </span>
        </Cell>
        <Cell label={t.pointsLabel}>
          <NetChip
            net={row.net}
            isPending={row.isPending}
            pendingLabel={t.awaitingResult}
          />
        </Cell>
      </div>
    </Card>
  );
}

function Cell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-1 min-w-0">
      <span className="font-[family-name:var(--font-label)] text-[10px] font-bold tracking-[0.05em] uppercase text-on-surface-variant">
        {label}
      </span>
      <div className="min-w-0 max-w-full">{children}</div>
    </div>
  );
}
