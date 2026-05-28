import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { Megaphone, ChevronLeft, ChevronRight } from "lucide-react";
import { hasLocale, type Locale } from "../../dictionaries";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/db";
import { Card } from "@/components/ui";
import { localePath } from "@/lib/paths";
import { BroadcastForm } from "./BroadcastForm";

// Lists every active profile so the admin can target a single
// player. Joined with auth.users for the email hint (helps disambiguate
// when two profiles share a display name).
type Recipient = {
  id: string;
  displayName: string;
  email: string | null;
  pushOptIn: boolean;
  subscriptionCount: number;
};

export default async function AdminBroadcastPage({
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

  const rows = await db.execute<Recipient>(sql`
    select
      p.id::text                            as "id",
      p.display_name                        as "displayName",
      au.email                              as "email",
      p.push_opt_in                         as "pushOptIn",
      (
        select count(*)::int
        from public.push_subscriptions ps
        where ps.user_id = p.id
      )                                     as "subscriptionCount"
    from public.profiles p
    left join auth.users au on au.id = p.id
    order by p.display_name asc
  `);
  const recipients = rows as unknown as Recipient[];
  const optedInCount = recipients.filter((r) => r.pushOptIn).length;
  const totalPlayers = recipients.length;
  const vapidConfigured = !!process.env.VAPID_PUBLIC_KEY;

  return (
    <section className="px-4 md:px-10 py-6 md:py-10 flex flex-col gap-6 max-w-3xl mx-auto w-full">
      <header className="flex flex-col gap-2">
        <Link
          href={localePath(locale, "admin")}
          className="inline-flex items-center gap-1 text-sm text-on-surface-variant hover:text-primary self-start"
        >
          <ChevronBack className="h-4 w-4" />
          {isHebrew ? "חזרה לניהול" : "Back to admin"}
        </Link>
        <h1 className="font-[family-name:var(--font-display)] text-[24px] leading-8 md:text-[36px] md:leading-[40px] font-bold text-primary inline-flex items-center gap-3">
          <Megaphone className="h-6 w-6 md:h-8 md:w-8" strokeWidth={1.75} />
          {isHebrew ? "שליחת הודעה" : "Broadcast"}
        </h1>
        <p className="text-base text-on-surface-variant">
          {isHebrew
            ? "שלח הודעה לשחקן יחיד, לכל מי שהפעיל push, או לכולם. הוודעה נשמרת תמיד במסך 'התראות' של הנמענים. סימון 'גם push' שולח התראת מערכת מיידית למי שיש לו subscription פעיל."
            : "Send an announcement to a single player, everyone with push opt-in, or everyone. The message always lands in the recipient's notifications feed. Tick 'also push' to fire a system notification to any active subscription."}
        </p>
      </header>

      <Card className="p-4 md:p-5 bg-tertiary-fixed text-on-tertiary-fixed-variant border border-tertiary-fixed-dim">
        <p className="text-sm">
          <strong className="block mb-1">
            {isHebrew ? "מצב נוכחי" : "Current state"}
          </strong>
          {isHebrew
            ? `${totalPlayers} משתתפים סך הכל; ${optedInCount} עם opt-in פעיל ל-push.`
            : `${totalPlayers} players total; ${optedInCount} with push opt-in on.`}
        </p>
      </Card>

      {!vapidConfigured && (
        <Card className="p-4 md:p-5 bg-tertiary-fixed text-on-tertiary-fixed-variant border border-tertiary-fixed-dim">
          <p className="text-sm">
            {isHebrew
              ? "VAPID לא מוגדר ⇒ 'גם push' תתעלם והודעה תישמר רק במסך התראות."
              : "VAPID isn't configured ⇒ 'also push' is ignored and the message is feed-only."}
          </p>
        </Card>
      )}

      <BroadcastForm
        locale={locale}
        recipients={recipients}
        optedInCount={optedInCount}
        totalPlayers={totalPlayers}
        pushAvailable={vapidConfigured}
      />
    </section>
  );
}
