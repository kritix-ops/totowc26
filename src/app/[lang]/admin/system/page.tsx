import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight, Mail, Bell } from "lucide-react";
import { eq } from "drizzle-orm";
import { hasLocale, type Locale } from "../../dictionaries";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { localePath } from "@/lib/paths";
import { LabelCaps } from "@/components/ui";
import { getViewAs } from "@/lib/view-as";
import { PAYBOX_FALLBACK_URL } from "@/lib/paybox";
import {
  getRecentBackupRuns,
  getRecentSyncRuns,
  getTeamMappingStatus,
} from "@/db/admin-queries";
import { fetchApiFootballStatus } from "@/lib/api-football";
import { AdminSection, AdminTile } from "../AdminSections";
import { BackupPanel } from "../BackupPanel";
import { SyncPanel } from "../SyncPanel";
import { ViewAsPanel } from "../ViewAsPanel";
import { PayboxSettingsPanel } from "../PayboxSettingsPanel";
import { PublicSignupSettingsPanel } from "../SignupSettingsPanel";
import { WhatsAppSettingsPanel } from "../WhatsAppSettingsPanel";
import { DashboardDigestSettingsPanel } from "../DashboardDigestSettingsPanel";
import { LiveShowUpcomingSettingsPanel } from "../LiveShowUpcomingSettingsPanel";

// "System & ops" page — the home for everything an admin sets once and
// then forgets (URLs, view-as, signup gate) plus the heavy operational
// dashboards (sync, backup). Lives outside the home so the home stays
// focused on daily-driver work. Debug tooling (email/push test) gets a
// tile each.
export default async function AdminSystemPage({
  params,
}: PageProps<"/[lang]/admin/system">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const isHebrew = locale === "he";
  const ChevronBack = isHebrew ? ChevronRight : ChevronLeft;

  const [
    syncHistory,
    backupHistory,
    viewAs,
    settingsRow,
    teamMapping,
    apiFootballQuota,
  ] = await Promise.all([
    getRecentSyncRuns(20),
    getRecentBackupRuns(10),
    getViewAs(),
    db
      .select({
        payboxUrl: settings.payboxUrl,
        whatsappGroupUrl: settings.whatsappGroupUrl,
        publicSignupOpen: settings.publicSignupOpen,
        dashboardDigestEnabled: settings.dashboardDigestEnabled,
        liveShowUpcoming: settings.liveShowUpcoming,
      })
      .from(settings)
      .where(eq(settings.id, 1))
      .limit(1)
      .then((r) => r[0] ?? null),
    getTeamMappingStatus(),
    fetchApiFootballStatus(),
  ]);

  return (
    <section className="px-4 md:px-10 py-6 md:py-10 flex flex-col gap-6 md:gap-8 max-w-5xl mx-auto w-full pb-24 md:pb-10">
      <header className="flex flex-col gap-2">
        <Link
          href={localePath(locale, "admin")}
          className="inline-flex items-center gap-1 text-sm text-on-surface-variant hover:text-primary self-start min-h-[44px]"
        >
          <ChevronBack className="h-4 w-4" />
          {isHebrew ? "חזרה לדף הניהול" : "Back to admin"}
        </Link>
        <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-9 md:text-[44px] md:leading-[48px] font-bold text-primary">
          {isHebrew ? "מערכת ותפעול" : "System & ops"}
        </h1>
        <p className="text-sm md:text-base text-on-surface-variant">
          {isHebrew
            ? "הגדרות חד-פעמיות, פעולות שירות ובדיקות מערכת. דברים שמוגדרים פעם אחת או רצים ברקע."
            : "One-time configuration, ops dashboards and system diagnostics. Things you set once or run in the background."}
        </p>
      </header>

      <AdminSection title={isHebrew ? "הגדרות" : "Settings"}>
        <div className="md:col-span-2">
          <PublicSignupSettingsPanel
            locale={locale}
            current={settingsRow?.publicSignupOpen ?? true}
          />
        </div>
        <div className="md:col-span-2">
          <PayboxSettingsPanel
            locale={locale}
            current={settingsRow?.payboxUrl ?? null}
            fallback={PAYBOX_FALLBACK_URL}
          />
        </div>
        <div className="md:col-span-2">
          <WhatsAppSettingsPanel
            locale={locale}
            current={settingsRow?.whatsappGroupUrl ?? null}
          />
        </div>
        <div className="md:col-span-2">
          <DashboardDigestSettingsPanel
            locale={locale}
            current={settingsRow?.dashboardDigestEnabled ?? true}
          />
        </div>
        <div className="md:col-span-2">
          <LiveShowUpcomingSettingsPanel
            locale={locale}
            current={settingsRow?.liveShowUpcoming ?? true}
          />
        </div>
        <div className="md:col-span-2">
          <ViewAsPanel locale={locale} current={viewAs} />
        </div>
      </AdminSection>

      <AdminSection title={isHebrew ? "תפעול ושירות" : "Operations"}>
        <div className="md:col-span-2">
          <SyncPanel
            locale={locale}
            history={syncHistory}
            teamMapping={teamMapping}
            apiFootballQuota={apiFootballQuota}
          />
        </div>
        <div className="md:col-span-2">
          <BackupPanel locale={locale} history={backupHistory} />
        </div>
      </AdminSection>

      <AdminSection title={isHebrew ? "בדיקות מערכת" : "Diagnostics"}>
        <AdminTile
          locale={locale}
          path="admin/email-test"
          icon={<Mail className="h-5 w-5" strokeWidth={1.75} />}
          label={isHebrew ? "בדיקת אימייל" : "Email test"}
        />
        <AdminTile
          locale={locale}
          path="admin/push-test"
          icon={<Bell className="h-5 w-5" strokeWidth={1.75} />}
          label={isHebrew ? "בדיקת push" : "Push test"}
        />
      </AdminSection>

      <p className="text-xs text-on-surface-variant px-1 flex items-center gap-2">
        <LabelCaps>{isHebrew ? "טיפ" : "Tip"}</LabelCaps>
        {isHebrew
          ? "כל מה שכאן הוגדר פעם אחת ולא נגעו בו מאז. אם משהו נראה לא הגיוני, ודא בדף הניהול הראשי שלא חסר עוד מקור מידע."
          : "Everything here is set-once. If a value looks wrong, double-check the admin home for an upstream source."}
      </p>
    </section>
  );
}
