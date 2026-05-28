import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight, Coins } from "lucide-react";
import { getDictionary, hasLocale, type Locale } from "../../../../dictionaries";
import { getBankBreakdown } from "@/lib/bank";
import { fetchUserBasic, fetchUserAdjustments } from "../../queries";
import { Card, SectionHeading } from "@/components/ui";
import { localePath } from "@/lib/paths";
import { AdjustmentForm } from "./AdjustmentForm";
import { AdjustmentList } from "./AdjustmentList";

export default async function AdminUserBankPage({
  params,
}: {
  params: Promise<{ lang: string; id: string }>;
}) {
  const { lang, id } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const dict = await getDictionary(locale);
  const isHebrew = locale === "he";
  const ChevronBack = isHebrew ? ChevronRight : ChevronLeft;

  const [user, breakdown, adjustments] = await Promise.all([
    fetchUserBasic(id),
    getBankBreakdown(id),
    fetchUserAdjustments(id),
  ]);
  if (!user) notFound();

  return (
    <section className="px-4 md:px-10 py-6 md:py-10 flex flex-col gap-8 max-w-3xl mx-auto w-full">
      <header className="flex flex-col gap-2">
        <Link
          href={localePath(locale, "admin/users")}
          className="inline-flex items-center gap-1 text-sm text-on-surface-variant hover:text-primary self-start"
        >
          <ChevronBack className="h-4 w-4" />
          {isHebrew ? "חזרה למשתתפים" : "Back to users"}
        </Link>
        <h1 className="font-[family-name:var(--font-display)] text-[24px] leading-8 md:text-[36px] md:leading-[40px] font-bold text-primary inline-flex items-center gap-3">
          <Coins className="h-6 w-6 md:h-8 md:w-8" strokeWidth={1.75} />
          {isHebrew ? "ניהול בנק נקודות" : "Points bank management"}
        </h1>
        <p className="text-base text-on-surface-variant">
          <strong className="text-on-surface">{user.displayName}</strong>
          <span aria-hidden className="mx-2 opacity-40">·</span>
          <span className="font-mono text-sm">{user.phone}</span>
        </p>
      </header>

      <Card className="p-5 md:p-6 flex flex-col gap-4">
        <SectionHeading underline="thin" as="h2">
          {dict.bank.balance}
        </SectionHeading>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Cell label={dict.bank.starting} value={breakdown.starting} />
          <Cell
            label={dict.bank.payoutsEarned}
            value={breakdown.payoutsEarned}
            positive
          />
          <Cell
            label={dict.bank.stakesPaid}
            value={-breakdown.stakesPaid}
            negative
          />
          <Cell
            label={dict.bank.duels}
            value={breakdown.duelDelta}
            positive={breakdown.duelDelta > 0}
            negative={breakdown.duelDelta < 0}
          />
          <Cell
            label={dict.bank.adjustments}
            value={breakdown.adjustments}
            positive={breakdown.adjustments > 0}
            negative={breakdown.adjustments < 0}
          />
        </div>
        <div className="flex items-center justify-between gap-3 pt-3 border-t border-outline-variant">
          <span className="font-bold">{dict.bank.balance}</span>
          <span
            className={`font-[family-name:var(--font-score)] text-3xl md:text-4xl font-bold tabular-nums ${
              breakdown.balance < 0 ? "text-error" : "text-on-surface"
            }`}
          >
            <bdi>{breakdown.balance}</bdi>
          </span>
        </div>
      </Card>

      <Card className="p-5 md:p-6 flex flex-col gap-4">
        <SectionHeading underline="thin" as="h2">
          {isHebrew ? "התאמת נקודות" : "Adjust points"}
        </SectionHeading>
        <p className="text-sm text-on-surface-variant">
          {isHebrew
            ? "הוסף או הורד נקודות מהבנק של המשתמש. סיבה חובה. המגבלה לרשומה אחת היא ±500 - לתיקון גדול יותר, כתוב כמה רשומות."
            : "Add or subtract from this user's bank. Reason is required. Single-row cap is ±500 - for larger corrections, write multiple rows."}
        </p>
        <p className="text-xs text-on-surface-variant border-s-4 border-tertiary-fixed-dim ps-3 py-1">
          {isHebrew
            ? "אל תכתוב מידע אישי בסיבה - הטקסט נשמר לעד ולא ניתן לעריכה."
            : "Do not paste sensitive info in the reason - text is permanent and uneditable."}
        </p>
        <AdjustmentForm targetUserId={id} locale={locale} />
      </Card>

      <div className="flex flex-col gap-2">
        <SectionHeading underline="thin" as="h2">
          {isHebrew ? "היסטוריית התאמות" : "Adjustment history"}
        </SectionHeading>
        <AdjustmentList rows={adjustments} locale={locale} />
      </div>
    </section>
  );
}

function Cell({
  label,
  value,
  positive,
  negative,
}: {
  label: string;
  value: number;
  positive?: boolean;
  negative?: boolean;
}) {
  const tone = positive ? "text-secondary" : negative ? "text-error" : "";
  return (
    <div className="flex flex-col gap-1">
      <span className="font-[family-name:var(--font-label)] text-[11px] font-bold tracking-[0.05em] uppercase text-on-surface-variant">
        {label}
      </span>
      <span
        className={`font-[family-name:var(--font-score)] text-2xl md:text-3xl font-bold tabular-nums ${tone}`}
      >
        <bdi>
          {value > 0 ? "+" : ""}
          {value}
        </bdi>
      </span>
    </div>
  );
}
