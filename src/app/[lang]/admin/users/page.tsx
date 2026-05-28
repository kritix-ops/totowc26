import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { eq } from "drizzle-orm";
import { hasLocale, type Locale } from "../../dictionaries";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { localePath } from "@/lib/paths";
import { LabelCaps } from "@/components/ui";
import { fetchAdminUsers, fetchAdminStats } from "./queries";
import { UsersExplorer } from "./UsersExplorer";

export default async function AdminUsersPage({
  params,
}: PageProps<"/[lang]/admin/users">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;

  const [[s], users] = await Promise.all([
    db.select({ entryFee: settings.entryFeeIls }).from(settings).where(eq(settings.id, 1)),
    fetchAdminUsers(),
  ]);
  const stats = await fetchAdminStats(s?.entryFee ?? 100);
  const isHebrew = locale === "he";
  const ChevronBack = isHebrew ? ChevronRight : ChevronLeft;

  return (
    <section className="px-4 md:px-10 py-6 md:py-10 flex flex-col gap-8 max-w-7xl mx-auto w-full">
      <header className="flex flex-col gap-2">
        <Link
          href={localePath(locale, "admin")}
          className="inline-flex items-center gap-1 text-sm text-on-surface-variant hover:text-primary self-start"
        >
          <ChevronBack className="h-4 w-4" />
          {isHebrew ? "חזרה לדף הניהול" : "Back to admin"}
        </Link>
        <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-9 md:text-[44px] md:leading-[48px] font-bold text-primary">
          {isHebrew ? "ניהול משתתפים" : "User management"}
        </h1>
        <p className="text-sm md:text-base text-on-surface-variant">
          {isHebrew
            ? "צפה, סנן, ערוך, אשר תשלומים ונהל הרשאות"
            : "View, filter, edit, approve payments and manage roles"}
        </p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard label={isHebrew ? "סה\"כ משתתפים" : "Total users"} value={stats.totalUsers} accent="text-surface-tint" />
        <KPICard label={isHebrew ? "שילמו" : "Approved"} value={stats.approvedCount} accent="text-secondary" sub={`${stats.potIls.toLocaleString()} ${isHebrew ? "ש\"ח בקופה" : "ILS in pot"}`} />
        <KPICard label={isHebrew ? "ממתינים" : "Pending"} value={stats.pendingCount} accent="text-tertiary" />
        <KPICard label={isHebrew ? "לא שילמו" : "Unpaid"} value={stats.unpaidCount} accent="text-error" sub={`${stats.adminCount} ${isHebrew ? "אדמינים" : "admins"}`} />
      </div>

      <UsersExplorer users={users} locale={locale} entryFee={s?.entryFee ?? 100} />
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
    <div className="bg-surface-container-low border border-outline-variant rounded-lg p-4 md:p-5 flex flex-col gap-1.5">
      <LabelCaps>{label}</LabelCaps>
      <div className={`font-[family-name:var(--font-display)] text-3xl md:text-4xl font-bold leading-none ${accent}`}>
        <span className="bidi-ltr">{value}</span>
      </div>
      {sub && (
        <span className="text-xs text-on-surface-variant truncate">{sub}</span>
      )}
    </div>
  );
}
