import { notFound, redirect } from "next/navigation";
import { ArrowDownLeft, ArrowUpRight, Coins, Scale } from "lucide-react";
import { clsx } from "clsx";
import { getDictionary, hasLocale, type Locale } from "../../dictionaries";
import { getUser } from "@/lib/supabase/auth";
import { getBankBreakdown } from "@/lib/bank";
import { getBankHistory, type BankEvent } from "@/db/queries";
import { Card, SectionHeading } from "@/components/ui";
import { localePath } from "@/lib/paths";
import { formatDateTime } from "@/lib/format";

export default async function BankHistoryPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const dict = await getDictionary(locale);
  const isHebrew = locale === "he";

  const user = await getUser();
  if (!user) redirect(localePath(locale, "login"));

  const [breakdown, events] = await Promise.all([
    getBankBreakdown(user.id),
    getBankHistory(user.id),
  ]);

  return (
    <section className="px-4 md:px-16 py-6 md:py-12 flex flex-col gap-8 md:gap-10 max-w-3xl mx-auto w-full">
      <header className="flex flex-col gap-2">
        <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-9 md:text-[40px] md:leading-[44px] font-bold text-on-surface inline-flex items-center gap-3">
          <Coins className="h-7 w-7 md:h-9 md:w-9 text-primary" strokeWidth={1.75} />
          {dict.bank.history}
        </h1>
        <p className="text-base text-on-surface-variant">
          {isHebrew
            ? "כל תנועה שהשפיעה על הבנק שלך - מתחילה מהיתרה הראשונית, דרך השקעות ותשלומים, ועד התאמות אדמין."
            : "Every event that touched your bank — from the starting balance through stakes, payouts, and admin adjustments."}
        </p>
      </header>

      <Card className="p-5 md:p-6 flex flex-col gap-4">
        <SectionHeading underline="thin" as="h2">
          {dict.bank.balance}
        </SectionHeading>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <BreakdownCell
            label={dict.bank.starting}
            value={breakdown.starting}
          />
          <BreakdownCell
            label={dict.bank.payoutsEarned}
            value={breakdown.payoutsEarned}
            tone="positive"
          />
          <BreakdownCell
            label={dict.bank.stakesPaid}
            value={-breakdown.stakesPaid}
            tone="negative"
          />
          <BreakdownCell
            label={dict.bank.duels}
            value={breakdown.duelDelta}
            tone={
              breakdown.duelDelta > 0
                ? "positive"
                : breakdown.duelDelta < 0
                  ? "negative"
                  : undefined
            }
          />
          <BreakdownCell
            label={dict.bank.adjustments}
            value={breakdown.adjustments}
            tone={breakdown.adjustments >= 0 ? "positive" : "negative"}
          />
        </div>
        <div className="flex items-center justify-between gap-3 pt-3 border-t border-outline-variant">
          <span className="inline-flex items-center gap-2 font-bold text-on-surface">
            <Scale className="h-5 w-5" strokeWidth={1.75} />
            {dict.bank.balance}
          </span>
          <span
            className={clsx(
              "font-[family-name:var(--font-score)] text-3xl md:text-4xl font-bold tabular-nums",
              breakdown.balance < 0 ? "text-error" : "text-on-surface",
            )}
          >
            <bdi>{breakdown.balance}</bdi>
          </span>
        </div>
      </Card>

      <div className="flex flex-col gap-2">
        <SectionHeading underline="thin" as="h2">
          {isHebrew ? "תנועות" : "Transactions"}
        </SectionHeading>
        {events.length === 0 ? (
          <Card className="p-6 text-center text-on-surface-variant">
            {dict.bank.noTransactions}
          </Card>
        ) : (
          <ul className="flex flex-col gap-2">
            {events.map((ev, i) => (
              <EventRow
                key={`${ev.kind}-${ev.at}-${i}`}
                event={ev}
                locale={locale}
                isHebrew={isHebrew}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function BreakdownCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "positive" | "negative";
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-[family-name:var(--font-label)] text-[11px] font-bold tracking-[0.05em] uppercase text-on-surface-variant">
        {label}
      </span>
      <span
        className={clsx(
          "font-[family-name:var(--font-score)] text-2xl md:text-3xl font-bold tabular-nums",
          tone === "positive" && value !== 0 && "text-secondary",
          tone === "negative" && value !== 0 && "text-error",
        )}
      >
        <bdi>
          {value > 0 ? "+" : ""}
          {value}
        </bdi>
      </span>
    </div>
  );
}

function EventRow({
  event,
  locale,
  isHebrew,
}: {
  event: BankEvent;
  locale: Locale;
  isHebrew: boolean;
}) {
  const positive = event.delta > 0;
  const Icon = positive ? ArrowUpRight : ArrowDownLeft;
  return (
    <li className="flex items-center justify-between gap-3 p-3 md:p-4 rounded-lg bg-surface-container-lowest border border-outline-variant">
      <div className="flex items-center gap-3 min-w-0">
        <span
          className={clsx(
            "flex items-center justify-center w-9 h-9 rounded-full shrink-0",
            positive
              ? "bg-secondary-container text-on-secondary-container"
              : "bg-error-container text-on-error-container",
          )}
          aria-hidden
        >
          <Icon className="h-4 w-4" strokeWidth={2.25} />
        </span>
        <div className="flex flex-col min-w-0">
          <span className="font-bold text-on-surface text-sm md:text-base truncate">
            {describeKind(event.kind, isHebrew)}
          </span>
          {event.detail && (
            <span className="text-xs text-on-surface-variant truncate">
              {event.detail}
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-col items-end gap-0.5 shrink-0">
        <span
          className={clsx(
            "font-[family-name:var(--font-score)] text-base md:text-lg font-bold tabular-nums",
            positive ? "text-secondary" : "text-error",
          )}
        >
          <bdi>
            {positive ? "+" : ""}
            {event.delta}
          </bdi>
        </span>
        <span className="text-[11px] text-outline">
          {formatDateTime(event.at, locale, {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>
    </li>
  );
}

function describeKind(kind: BankEvent["kind"], isHebrew: boolean): string {
  const labels: Record<BankEvent["kind"], [string, string]> = {
    start:         ["בנק התחלתי", "Starting bank"],
    payout_match:  ["תשלום הימור משחק", "Match bet payout"],
    stake_custom:  ["השקעה בהימור מותאם", "Custom bet stake"],
    payout_custom: ["תשלום הימור מותאם", "Custom bet payout"],
    adjustment:    ["התאמת אדמין", "Admin adjustment"],
  };
  return labels[kind][isHebrew ? 0 : 1];
}
