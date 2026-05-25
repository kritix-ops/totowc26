import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CircleDollarSign,
  Users,
  Trophy,
  Settings,
  RefreshCw,
  ChevronRight,
  Coins,
} from "lucide-react";
import { eq } from "drizzle-orm";
import { hasLocale, type Locale } from "../dictionaries";
import { Card, LabelCaps } from "@/components/ui";
import { localePath } from "@/lib/paths";
import { getViewAs } from "@/lib/view-as";
import { PAYBOX_FALLBACK_URL } from "@/lib/paybox";
import { db } from "@/db";
import { settings } from "@/db/schema";
import {
  getRecentSyncRuns,
  getPaymentsByStatus,
  getPaymentTotals,
} from "@/db/admin-queries";
import { SyncPanel } from "./SyncPanel";
import { PaymentsPanel } from "./PaymentsPanel";
import { ViewAsPanel } from "./ViewAsPanel";
import { PayboxSettingsPanel } from "./PayboxSettingsPanel";

export default async function AdminPage({
  params,
}: PageProps<"/[lang]/admin">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const isHebrew = locale === "he";

  const [syncHistory, payments, totals, viewAs, settingsRow] = await Promise.all([
    getRecentSyncRuns(20),
    getPaymentsByStatus("all", 50),
    getPaymentTotals(),
    getViewAs(),
    db
      .select({ payboxUrl: settings.payboxUrl })
      .from(settings)
      .where(eq(settings.id, 1))
      .limit(1)
      .then((r) => r[0] ?? null),
  ]);

  return (
    <section className="px-4 md:px-16 py-6 md:py-12 flex flex-col gap-6 md:gap-8 max-w-5xl mx-auto w-full">
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-9 md:text-[48px] md:leading-[52px] font-bold text-primary">
          {isHebrew ? "ניהול" : "Admin"}
        </h1>
        <Card className="px-5 py-3 flex items-center gap-3 self-start md:self-auto">
          <CircleDollarSign
            className="h-5 w-5 text-tertiary shrink-0"
            strokeWidth={1.5}
          />
          <div className="flex flex-col min-w-0">
            <LabelCaps>{isHebrew ? "סה״כ בקופה" : "Pot total"}</LabelCaps>
            <span className="font-[family-name:var(--font-display)] text-xl md:text-2xl leading-none font-bold text-surface-tint">
              <bdi>{totals.approvedSumIls.toLocaleString()}</bdi>{" "}
              {isHebrew ? "ש״ח" : "ILS"}
            </span>
          </div>
        </Card>
      </header>

      <nav
        aria-label={isHebrew ? "ניהול" : "Admin sections"}
        className="grid grid-cols-2 sm:grid-cols-4 gap-3"
      >
        <SectionLink
          locale={locale}
          path="admin/users"
          icon={<Users className="h-5 w-5" strokeWidth={1.75} />}
          label={isHebrew ? "משתתפים" : "Players"}
        />
        <SectionLink
          locale={locale}
          path="admin/results"
          icon={<Trophy className="h-5 w-5" strokeWidth={1.75} />}
          label={isHebrew ? "תוצאות טורניר" : "Tournament results"}
        />
        <SectionLink
          locale={locale}
          path="admin/settings/scoring"
          icon={<Coins className="h-5 w-5" strokeWidth={1.75} />}
          label={isHebrew ? "ניקוד ובנק" : "Scoring & bank"}
        />
        <SectionLink
          locale={locale}
          path="bets"
          icon={<RefreshCw className="h-5 w-5" strokeWidth={1.75} />}
          label={isHebrew ? "כל המשחקים" : "All matches"}
        />
        <SectionLink
          locale={locale}
          path="standings"
          icon={<Settings className="h-5 w-5" strokeWidth={1.75} />}
          label={isHebrew ? "טבלת הבתים" : "Standings"}
        />
      </nav>

      <ViewAsPanel locale={locale} current={viewAs} />

      <PayboxSettingsPanel
        locale={locale}
        current={settingsRow?.payboxUrl ?? null}
        fallback={PAYBOX_FALLBACK_URL}
      />

      <SyncPanel locale={locale} history={syncHistory} />

      <PaymentsPanel
        locale={locale}
        rows={payments}
        pendingCount={totals.pendingCount}
        approvedCount={totals.approvedCount}
        rejectedCount={totals.rejectedCount}
        approvedSumIls={totals.approvedSumIls}
      />
    </section>
  );
}

function SectionLink({
  locale,
  path,
  icon,
  label,
}: {
  locale: Locale;
  path: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      href={localePath(locale, path)}
      className="press-down"
    >
      <Card className="p-4 flex items-center gap-3 min-h-[64px] hover:bg-surface-container transition-colors h-full">
        <div className="w-10 h-10 rounded-full bg-primary-fixed flex items-center justify-center text-on-primary-fixed-variant shrink-0">
          {icon}
        </div>
        <span className="flex-1 min-w-0 font-bold text-sm text-on-surface truncate">
          {label}
        </span>
        <ChevronRight
          className="h-4 w-4 text-on-surface-variant shrink-0 rtl:rotate-180"
          strokeWidth={2}
        />
      </Card>
    </Link>
  );
}
