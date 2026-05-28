import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import {
  Bell,
  ChevronLeft,
  ChevronRight,
  CheckCheck,
  Megaphone,
  Trophy,
  Sparkles,
  Info,
} from "lucide-react";
import { clsx } from "clsx";
import { hasLocale, type Locale } from "../dictionaries";
import { getRequestUser } from "@/lib/request-user";
import { db } from "@/db";
import { userNotifications, type NotificationKind } from "@/db/schema";
import { markAllNotificationsRead } from "@/lib/notifications";
import { Card, SectionHeading } from "@/components/ui";
import { localePath } from "@/lib/paths";
import { formatDateTime } from "@/lib/format";

// /[lang]/notifications - feed of every announcement + auto-event the
// signed-in player has received. Newest first. Mark-all-read fires on
// load so the badge clears without an extra tap.

export default async function NotificationsPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const isHebrew = locale === "he";
  const ChevronBack = isHebrew ? ChevronRight : ChevronLeft;

  const user = await getRequestUser();
  if (!user) redirect(localePath(locale, "login"));

  // Mark every unread row read before we query the feed - the page
  // shows the same data either way, and clearing on load matches the
  // "you've seen them now" mental model.
  await markAllNotificationsRead(user.id);

  const rows = await db
    .select()
    .from(userNotifications)
    .where(eq(userNotifications.userId, user.id))
    .orderBy(desc(userNotifications.createdAt))
    .limit(100);

  return (
    <section className="px-4 md:px-10 py-6 md:py-10 flex flex-col gap-6 max-w-3xl mx-auto w-full pb-24">
      <header className="flex flex-col gap-2">
        <Link
          href={localePath(locale, "profile")}
          className="inline-flex items-center gap-1 text-sm text-on-surface-variant hover:text-primary self-start"
        >
          <ChevronBack className="h-4 w-4" />
          {isHebrew ? "חזרה לפרופיל" : "Back to profile"}
        </Link>
        <h1 className="font-[family-name:var(--font-display)] text-[26px] leading-9 md:text-[40px] md:leading-[44px] font-bold text-primary inline-flex items-center gap-3">
          <Bell className="h-6 w-6 md:h-8 md:w-8" strokeWidth={1.75} />
          {isHebrew ? "התראות" : "Notifications"}
        </h1>
        <p className="text-sm text-on-surface-variant inline-flex items-center gap-1.5">
          <CheckCheck className="h-4 w-4" strokeWidth={2} />
          {isHebrew ? "כל ההתראות סומנו כנקראו" : "All notifications marked as read"}
        </p>
      </header>

      {rows.length === 0 ? (
        <Card className="p-6 text-center text-on-surface-variant">
          {isHebrew ? "אין עדיין התראות." : "Nothing here yet."}
        </Card>
      ) : (
        <SectionHeading as="h2" underline="thin">
          {isHebrew ? `${rows.length} התראות` : `${rows.length} notifications`}
        </SectionHeading>
      )}

      <ul className="flex flex-col gap-3">
        {rows.map((n) => (
          <NotificationCard
            key={n.id}
            locale={locale}
            kind={n.kind}
            title={n.title}
            body={n.body}
            url={n.url}
            pushed={n.pushed}
            createdAt={n.createdAt.toISOString()}
            // We just marked everything read - readAt may not be on this
            // copy yet, so we display all as "read" since the markAll
            // call ran before this render.
            isRead
          />
        ))}
      </ul>
    </section>
  );
}

function NotificationCard({
  locale,
  kind,
  title,
  body,
  url,
  pushed,
  createdAt,
  isRead,
}: {
  locale: Locale;
  kind: NotificationKind;
  title: string;
  body: string;
  url: string | null;
  pushed: boolean;
  createdAt: string;
  isRead: boolean;
}) {
  const isHebrew = locale === "he";
  const tone = toneFor(kind);
  const timeLabel = formatDateTime(createdAt, locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  const inner = (
    <Card
      className={clsx(
        "p-4 md:p-5 flex gap-3 items-start hover:bg-surface-container transition-colors",
        !isRead && "border-primary",
      )}
    >
      <div
        className={clsx(
          "w-10 h-10 rounded-full flex items-center justify-center shrink-0",
          tone,
        )}
        aria-hidden
      >
        <NotificationIcon kind={kind} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h3 className="font-bold text-base text-on-surface leading-snug">
            {title}
          </h3>
          <span className="text-xs text-on-surface-variant tabular-nums shrink-0">
            {timeLabel}
          </span>
        </div>
        <p className="text-sm text-on-surface-variant mt-1 whitespace-pre-line">
          {body}
        </p>
        {pushed && (
          <p className="text-[11px] text-tertiary mt-1.5 inline-flex items-center gap-1">
            <Bell className="h-3 w-3" strokeWidth={2} />
            {isHebrew ? "נשלח גם כ-push" : "Also sent as push"}
          </p>
        )}
      </div>
    </Card>
  );

  if (url) {
    return (
      <li>
        <Link href={url} className="block">
          {inner}
        </Link>
      </li>
    );
  }
  return <li>{inner}</li>;
}

// Dispatcher component instead of `const Icon = iconFor(kind)` so the
// React Compiler lint rule against "components created during render"
// stays happy. Each branch references a stable top-level import.
function NotificationIcon({ kind }: { kind: NotificationKind }) {
  switch (kind) {
    case "announcement":
      return <Megaphone className="h-5 w-5" strokeWidth={1.75} />;
    case "bet_graded":
      return <Sparkles className="h-5 w-5" strokeWidth={1.75} />;
    case "match_final":
      return <Trophy className="h-5 w-5" strokeWidth={1.75} />;
    case "custom":
      return <Info className="h-5 w-5" strokeWidth={1.75} />;
  }
}

function toneFor(kind: NotificationKind): string {
  switch (kind) {
    case "announcement": return "bg-primary-fixed text-on-primary-fixed-variant";
    case "bet_graded":   return "bg-secondary-container text-on-secondary-container";
    case "match_final":  return "bg-tertiary-fixed text-on-tertiary-fixed-variant";
    case "custom":       return "bg-surface-variant text-on-surface";
  }
}
