import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { Bell, ChevronLeft, ChevronRight } from "lucide-react";
import { hasLocale, type Locale } from "../../dictionaries";
import { requireAdmin } from "@/lib/admin";
import { execRows } from "@/db/helpers";
import { Card } from "@/components/ui";
import { localePath } from "@/lib/paths";
import { PushTestForm } from "./PushTestForm";

// Lists every profile that currently has at least one push
// subscription, with their opt-in flag. The form uses this so the
// admin can pick "me" or any other subscribed player to test against.
//
// Profiles WITHOUT any subscription are skipped - a send would do
// nothing anyway. The "send to everyone opted-in" mode still honors
// the opt-in flag at send time.
type Candidate = {
  id: string;
  displayName: string;
  pushOptIn: boolean;
  subscriptionCount: number;
};

export default async function AdminPushTestPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  await requireAdmin(locale);
  const isHebrew = locale === "he";
  const ChevronBack = isHebrew ? ChevronRight : ChevronLeft;

  const candidates = await execRows<Candidate>(sql`
    select
      p.id::text                            as "id",
      p.display_name                        as "displayName",
      p.push_opt_in                         as "pushOptIn",
      count(ps.id)::int                     as "subscriptionCount"
    from public.profiles p
    join public.push_subscriptions ps on ps.user_id = p.id
    group by p.id, p.display_name, p.push_opt_in
    order by p.display_name asc
  `);
  const optedInCount = candidates.filter((c) => c.pushOptIn).length;
  const vapidConfigured = !!process.env.VAPID_PUBLIC_KEY;

  return (
    <section className="px-4 md:px-10 py-6 md:py-10 flex flex-col gap-6 max-w-3xl mx-auto w-full">
      <header className="flex flex-col gap-2">
        <Link
          href={localePath(locale, "admin")}
          className="inline-flex items-center gap-1 text-sm text-on-surface-variant hover:text-primary self-start"
        >
          <ChevronBack className="h-4 w-4" />
          {isHebrew ? "חזרה לדף הניהול" : "Back to admin"}
        </Link>
        <h1 className="font-[family-name:var(--font-display)] text-[24px] leading-8 md:text-[36px] md:leading-[40px] font-bold text-primary inline-flex items-center gap-3">
          <Bell className="h-6 w-6 md:h-8 md:w-8" strokeWidth={1.75} />
          {isHebrew ? "בדיקת שליחת push" : "Push send test"}
        </h1>
        <p className="text-base text-on-surface-variant">
          {isHebrew
            ? "שליחת התראת בדיקה למנוי ספציפי, לכל המשתתפים שהפעילו push, או רק לעצמך. עוקף את חלון התזכורות ואת טבלת ה-dedup - לא מתעד שליחה אמיתית."
            : "Send a smoke-test notification to one user, everyone with push opt-in, or just yourself. Bypasses the reminder window and dedup table — does NOT count as a real reminder."}
        </p>
      </header>

      {!vapidConfigured && (
        <Card className="p-4 md:p-5 bg-error-container text-on-error-container border border-error">
          <p className="text-sm font-bold">
            {isHebrew
              ? "VAPID לא מוגדר במשתני הסביבה. הפעל pnpm push:vapid והוסף את שלושת המפתחות."
              : "VAPID env vars are missing. Run pnpm push:vapid and add all three keys."}
          </p>
        </Card>
      )}

      <Card className="p-4 md:p-5 bg-tertiary-fixed text-on-tertiary-fixed-variant border border-tertiary-fixed-dim">
        <p className="text-sm">
          <strong className="block mb-1">
            {isHebrew ? "מצב נוכחי" : "Current state"}
          </strong>
          {isHebrew
            ? `${candidates.length} משתתפים עם מנויים פעילים; ${optedInCount} מהם הפעילו את ה-opt-in.`
            : `${candidates.length} players have active subscriptions; ${optedInCount} of them currently have opt-in on.`}
        </p>
      </Card>

      <PushTestForm
        locale={locale}
        candidates={candidates}
        optedInCount={optedInCount}
      />
    </section>
  );
}
