import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  ListChecks,
  ShieldCheck,
  History,
} from "lucide-react";
import { hasLocale, type Locale } from "../../dictionaries";
import { requireAdmin } from "@/lib/admin";
import {
  fetchUserBasic,
  fetchUserBetsForAdmin,
  fetchUserMatchPicksForAdmin,
  fetchPlayerNamesById,
} from "../users/queries";
import { Card, Chip, SectionHeading } from "@/components/ui";
import { localePath } from "@/lib/paths";
import { getLiveStakeConfig } from "@/lib/bank";
import { formatDateTime } from "@/lib/format";
import { MyBetsBrowser } from "./MyBetsBrowser";
import { fetchMyBackdateAudit, type MyBackdateAuditRow } from "./actions";

// Admin self-backdate page. A FULL admin only — the admin layout's path
// whitelist excludes /my-bets for scoped operators, and requireAdmin here is
// the defense-in-depth mirror. Loads the admin's OWN bets across every surface
// and hands them to the client filter/browser, which lets them add or fix a
// pick even after a match has started/finished. Every edit is recorded in the
// private audit log at the bottom — visible only to the admin. See
// _plans/2026-06-23-admin-self-backdate-bets.md.

export default async function AdminMyBetsPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const isHebrew = locale === "he";
  const { user } = await requireAdmin(locale);
  const ChevronBack = isHebrew ? ChevronRight : ChevronLeft;

  const [me, customRows, matchRows, playerNames, audit, liveStakeConfig] =
    await Promise.all([
      fetchUserBasic(user.id),
      fetchUserBetsForAdmin(user.id),
      fetchUserMatchPicksForAdmin(user.id),
      fetchPlayerNamesById(),
      fetchMyBackdateAudit(),
      getLiveStakeConfig(),
    ]);
  if (!me) notFound();

  console.info("[admin self-backdate] page_read", {
    adminId: user.id,
    customBetCount: customRows.length,
    matchCount: matchRows.length,
    auditRows: audit.length,
  });

  const stakeBounds = {
    minStake: liveStakeConfig.minStake,
    maxStake: liveStakeConfig.maxStake,
  };
  const meName = isHebrew ? "אני" : "Me";

  return (
    <section className="px-4 md:px-10 py-6 md:py-10 flex flex-col gap-8 max-w-3xl mx-auto w-full pb-24 md:pb-10">
      <header className="flex flex-col gap-2">
        <Link
          href={localePath(locale, "admin")}
          className="inline-flex items-center gap-1 text-sm text-on-surface-variant hover:text-primary self-start"
        >
          <ChevronBack className="h-4 w-4" />
          {isHebrew ? "חזרה לניהול" : "Back to admin"}
        </Link>
        <h1 className="font-[family-name:var(--font-display)] text-[24px] leading-8 md:text-[36px] md:leading-[40px] font-bold text-primary inline-flex items-center gap-3">
          <ListChecks className="h-6 w-6 md:h-8 md:w-8" strokeWidth={1.75} />
          {isHebrew ? "ההימורים שלי — תיקון בדיעבד" : "My bets — backdate"}
        </h1>
        <p className="text-base text-on-surface-variant">
          {isHebrew
            ? "כאן אפשר להוסיף או לתקן הימורים שלך, גם אחרי שמשחק התחיל — למקרה שהימור לא נשמר בגלל תקלה."
            : "Add or fix your own bets, even after a match has started — for when a bet failed to save."}
        </p>
      </header>

      <Card className="p-4 md:p-5 flex items-start gap-3 border-primary/30 bg-primary/[0.04]">
        <ShieldCheck
          className="h-5 w-5 text-primary shrink-0 mt-0.5"
          strokeWidth={1.75}
        />
        <p className="text-sm text-on-surface-variant leading-relaxed">
          {isHebrew
            ? "כל תיקון כאן נרשם ביומן פרטי שרק אתה רואה (למטה בעמוד). לשאר המשתתפים הכל נראה רגיל לחלוטין."
            : "Every fix here is written to a private log only you can see (at the bottom of this page). To everyone else the app looks completely normal."}
        </p>
      </Card>

      <MyBetsBrowser
        locale={locale}
        selfUserId={user.id}
        selfName={meName}
        matchRows={matchRows}
        customRows={customRows}
        playerNames={playerNames}
        stakeBounds={stakeBounds}
      />

      <AuditLog rows={audit} locale={locale} />
    </section>
  );
}

// Private backdate trail. Only this admin's own backdated rows, newest first.
function AuditLog({
  rows,
  locale,
}: {
  rows: MyBackdateAuditRow[];
  locale: Locale;
}) {
  const isHebrew = locale === "he";
  return (
    <section className="flex flex-col gap-3">
      <SectionHeading as="h2" underline="thin">
        <span className="inline-flex items-center gap-2">
          <History className="h-5 w-5" strokeWidth={1.75} />
          {isHebrew ? "יומן תיקונים פרטי" : "Private backdate log"}
          <span className="text-xs font-normal text-on-surface-variant tabular-nums">
            ({rows.length})
          </span>
        </span>
      </SectionHeading>
      <p className="text-xs text-on-surface-variant -mt-1">
        {isHebrew
          ? "רק אתה רואה את היומן הזה. כל שורה היא הוכחה שקופה לתיקון שביצעת."
          : "Only you can see this log. Each row is a transparent record of a fix you made."}
      </p>
      {rows.length === 0 ? (
        <Card className="p-5 text-center text-sm text-on-surface-variant">
          {isHebrew ? "עדיין אין תיקונים." : "No fixes yet."}
        </Card>
      ) : (
        <Card className="p-3 md:p-4 flex flex-col divide-y divide-outline-variant">
          {rows.map((r) => (
            <AuditRow key={r.id} row={r} locale={locale} />
          ))}
        </Card>
      )}
    </section>
  );
}

function AuditRow({
  row,
  locale,
}: {
  row: MyBackdateAuditRow;
  locale: Locale;
}) {
  const isHebrew = locale === "he";
  const when = formatDateTime(row.createdAt, locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const subject =
    row.surface === "match"
      ? isHebrew
        ? `${row.matchHomeHe ?? "?"} נגד ${row.matchAwayHe ?? "?"}`
        : `${row.matchHomeEn ?? "?"} vs ${row.matchAwayEn ?? "?"}`
      : isHebrew
        ? (row.questionHe ?? "—")
        : (row.questionEn ?? "—");
  const actionLabel =
    row.action === "clear"
      ? isHebrew
        ? "מחיקה"
        : "Cleared"
      : isHebrew
        ? "עדכון"
        : "Set";
  return (
    <div className="py-3 flex flex-col gap-1 first:pt-0 last:pb-0">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-sm font-bold text-on-surface min-w-0 flex-1">
          {subject}
        </span>
        <Chip tone={row.action === "clear" ? "default" : "secondary"}>
          {actionLabel}
        </Chip>
      </div>
      <div className="text-xs text-on-surface-variant tabular-nums">{when}</div>
      <div className="text-sm inline-flex items-center gap-2 flex-wrap">
        <span className="text-on-surface-variant line-through opacity-70">
          {formatAudit(row.surface, row.before, isHebrew)}
        </span>
        <span aria-hidden>→</span>
        <span className="text-on-surface font-medium">
          {formatAudit(row.surface, row.after, isHebrew)}
        </span>
      </div>
      <div className="text-xs text-on-surface-variant">
        <span className="font-bold">{isHebrew ? "סיבה: " : "Reason: "}</span>
        {row.reason}
      </div>
    </div>
  );
}

// Plain humanization of the audit before/after JSON. The audit row doesn't
// carry the answer config, so we render the raw value readably rather than the
// fully-localized label — enough to prove what changed.
function formatAudit(
  surface: "match" | "custom",
  value: unknown,
  isHebrew: boolean,
): string {
  if (value == null) return isHebrew ? "—" : "—";
  if (surface === "match") {
    const v = value as { home?: number; away?: number };
    if (typeof v.home === "number" && typeof v.away === "number") {
      return `${v.home}–${v.away}`;
    }
    return "—";
  }
  const a = value as { type?: string; value?: unknown };
  if (a.type === "yes_no") {
    return a.value ? (isHebrew ? "כן" : "Yes") : isHebrew ? "לא" : "No";
  }
  if (a.value == null) return "—";
  return String(a.value);
}
