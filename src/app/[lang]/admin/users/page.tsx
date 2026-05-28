import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { eq } from "drizzle-orm";
import { hasLocale, type Locale } from "../../dictionaries";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { localePath } from "@/lib/paths";
import { LabelCaps } from "@/components/ui";
import {
  getPaymentsByStatus,
  getPaymentTotals,
} from "@/db/admin-queries";
import { fetchSignupRequests } from "../signup-requests/queries";
import { SignupRequestsList } from "../signup-requests/SignupRequestsList";
import { PaymentsPanel } from "../PaymentsPanel";
import { fetchAdminUsers, fetchAdminStats } from "./queries";
import { ENTRY_FEE_ILS } from "@/lib/paybox";
import { PeopleTabs, type PeopleTab } from "./PeopleTabs";
import { UsersExplorer } from "./UsersExplorer";

type RequestStatusFilter = "pending" | "approved" | "rejected" | "all";

function parseTab(value: string | string[] | undefined): PeopleTab {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === "requests") return "requests";
  if (raw === "payments") return "payments";
  return "players";
}

function parseStatus(
  value: string | string[] | undefined,
): RequestStatusFilter {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === "approved" || raw === "rejected" || raw === "all") return raw;
  return "pending";
}

export default async function AdminPeoplePage({
  params,
  searchParams,
}: PageProps<"/[lang]/admin/users">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const isHebrew = locale === "he";
  const ChevronBack = isHebrew ? ChevronRight : ChevronLeft;

  const sp = await searchParams;
  const activeTab = parseTab(sp.tab);
  const requestsFilter = parseStatus(sp.status);

  // Tab-aware fetch: badge counts (pending signup requests + payment
  // totals) always load so the tab indicators are correct, but the
  // heavy list for each tab only loads when that tab is active. Admins
  // switch tabs constantly; keeping fetches scoped to the visible tab
  // keeps every navigation fast.
  const [[s], users, pendingForBadge, paymentTotals, requestsForList, paymentsForList] =
    await Promise.all([
      db
        .select({ entryFee: settings.entryFeeIls })
        .from(settings)
        .where(eq(settings.id, 1)),
      fetchAdminUsers(),
      fetchSignupRequests("pending"),
      getPaymentTotals(),
      activeTab === "requests"
        ? fetchSignupRequests(requestsFilter)
        : Promise.resolve(null),
      activeTab === "payments"
        ? getPaymentsByStatus("all", 50)
        : Promise.resolve(null),
    ]);
  const stats = await fetchAdminStats(s?.entryFee ?? ENTRY_FEE_ILS);

  const pendingRequestsCount = pendingForBadge.length;
  const pendingPaymentsCount = paymentTotals.pendingCount;

  return (
    <section className="px-4 md:px-10 py-6 md:py-10 flex flex-col gap-6 max-w-7xl mx-auto w-full pb-24 md:pb-10">
      <header className="flex flex-col gap-2">
        <Link
          href={localePath(locale, "admin")}
          className="inline-flex items-center gap-1 text-sm text-on-surface-variant hover:text-primary self-start min-h-[44px]"
        >
          <ChevronBack className="h-4 w-4" />
          {isHebrew ? "חזרה לדף הניהול" : "Back to admin"}
        </Link>
        <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-9 md:text-[44px] md:leading-[48px] font-bold text-primary">
          {isHebrew ? "ניהול משתתפים" : "People management"}
        </h1>
        <p className="text-sm md:text-base text-on-surface-variant">
          {isHebrew
            ? "צפה במשתתפים, אשר תשלומים, נהל הרשאות וטפל בבקשות הרשמה — הכל ממקום אחד"
            : "View players, approve payments, manage roles, and handle signup requests — all in one place"}
        </p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard
          label={isHebrew ? "סה\"כ משתתפים" : "Total players"}
          value={stats.totalUsers}
          accent="text-surface-tint"
        />
        <KPICard
          label={isHebrew ? "שילמו" : "Approved"}
          value={stats.approvedCount}
          accent="text-secondary"
          sub={`${stats.potIls.toLocaleString()} ${isHebrew ? "ש\"ח בקופה" : "ILS in pot"}`}
        />
        <Link
          href={`${localePath(locale, "admin/users")}?tab=payments`}
          className="press-down focus-visible:outline-2 focus-visible:outline-primary rounded-lg"
        >
          <KPICard
            label={isHebrew ? "ממתינים תשלום" : "Awaiting payment"}
            value={pendingPaymentsCount}
            accent="text-tertiary"
            sub={
              pendingPaymentsCount > 0
                ? isHebrew
                  ? "לחץ לאישור מהיר"
                  : "tap to review"
                : undefined
            }
          />
        </Link>
        <Link
          href={`${localePath(locale, "admin/users")}?tab=requests`}
          className="press-down focus-visible:outline-2 focus-visible:outline-primary rounded-lg"
        >
          <KPICard
            label={isHebrew ? "בקשות חדשות" : "New requests"}
            value={pendingRequestsCount}
            accent={
              pendingRequestsCount > 0 ? "text-tertiary" : "text-on-surface-variant"
            }
            sub={
              pendingRequestsCount > 0
                ? isHebrew
                  ? "ממתינות לאישור"
                  : "awaiting review"
                : isHebrew
                  ? "הכל מסונן"
                  : "all caught up"
            }
          />
        </Link>
      </div>

      <PeopleTabs
        locale={locale}
        active={activeTab}
        pendingRequestsCount={pendingRequestsCount}
        pendingPaymentsCount={pendingPaymentsCount}
      />

      {activeTab === "players" && (
        <UsersExplorer
          users={users}
          locale={locale}
          entryFee={s?.entryFee ?? ENTRY_FEE_ILS}
        />
      )}
      {activeTab === "requests" && (
        <SignupRequestsList
          locale={locale}
          requests={requestsForList ?? []}
          filter={requestsFilter}
        />
      )}
      {activeTab === "payments" && (
        <PaymentsPanel
          locale={locale}
          rows={paymentsForList ?? []}
          pendingCount={paymentTotals.pendingCount}
          approvedCount={paymentTotals.approvedCount}
          rejectedCount={paymentTotals.rejectedCount}
          approvedSumIls={paymentTotals.approvedSumIls}
        />
      )}
    </section>
  );
}

function KPICard({
  label,
  value,
  accent,
  sub,
}: {
  label: string;
  value: number;
  accent: string;
  sub?: string;
}) {
  return (
    <div className="bg-surface-container-low border border-outline-variant rounded-lg p-4 md:p-5 flex flex-col gap-1.5 h-full">
      <LabelCaps>{label}</LabelCaps>
      <div
        className={`font-[family-name:var(--font-display)] text-3xl md:text-4xl font-bold leading-none ${accent}`}
      >
        <span className="bidi-ltr">{value}</span>
      </div>
      {sub && (
        <span className="text-xs text-on-surface-variant truncate">{sub}</span>
      )}
    </div>
  );
}
