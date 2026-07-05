import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  ListChecks,
  ShieldCheck,
  History,
  User as UserIcon,
} from "lucide-react";
import { hasLocale, type Locale } from "../../dictionaries";
import { requireAdmin } from "@/lib/admin";
import {
  fetchUserBasic,
  fetchUserBetsForAdmin,
  fetchUserMatchPicksForAdmin,
  fetchUserAdvancePicksForAdmin,
  fetchSelectableUsers,
  fetchPlayerNamesById,
} from "../users/queries";
import { Card, Chip, SectionHeading } from "@/components/ui";
import { localePath } from "@/lib/paths";
import { getLiveStakeConfig } from "@/lib/bank";
import { formatDateTime } from "@/lib/format";
import { MyBetsBrowser } from "./MyBetsBrowser";
import { UserPicker } from "./UserPicker";
import { fetchMyBackdateAudit, type MyBackdateAuditRow } from "./actions";

// Admin backdate page. A FULL admin only — the admin layout's path whitelist
// excludes /my-bets for scoped operators, and requireAdmin here is the
// defense-in-depth mirror. Loads a chosen user's bets across every surface
// (score / custom / "who advances?") and hands them to the client
// filter/browser, which lets the admin add or fix a pick even after a match has
// started/finished. The target defaults to the acting admin; a picker at the
// top switches to any other user via ?user=<id>. Every edit is recorded in the
// backdate log at the bottom — private to the acting admin. See
// _plans/2026-07-05-admin-backdate-all-users-advance.md.

export default async function AdminMyBetsPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ user?: string | string[] }>;
}) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const isHebrew = locale === "he";
  const { user } = await requireAdmin(locale);
  const ChevronBack = isHebrew ? ChevronRight : ChevronLeft;

  const sp = await searchParams;
  const requestedUser = typeof sp.user === "string" ? sp.user : undefined;

  // Resolve the target: the requested user if it's a real, selectable account,
  // else the acting admin. Guards against a stale/forged ?user= landing on a
  // blank page.
  const selectableUsers = await fetchSelectableUsers();
  const isSelectable =
    requestedUser != null &&
    requestedUser !== user.id &&
    selectableUsers.some((u) => u.id === requestedUser);
  const targetId = isSelectable ? requestedUser! : user.id;
  const isSelf = targetId === user.id;

  const [
    targetBasic,
    customRows,
    matchRows,
    advanceRows,
    playerNames,
    audit,
    liveStakeConfig,
  ] = await Promise.all([
    fetchUserBasic(targetId),
    fetchUserBetsForAdmin(targetId),
    fetchUserMatchPicksForAdmin(targetId),
    fetchUserAdvancePicksForAdmin(targetId),
    fetchPlayerNamesById(),
    fetchMyBackdateAudit(),
    getLiveStakeConfig(),
  ]);
  if (!targetBasic) notFound();

  console.info("[admin backdate] page_read", {
    adminId: user.id,
    targetId,
    isSelf,
    customBetCount: customRows.length,
    matchCount: matchRows.length,
    advanceCount: advanceRows.length,
    auditRows: audit.length,
  });

  const stakeBounds = {
    minStake: liveStakeConfig.minStake,
    maxStake: liveStakeConfig.maxStake,
  };
  // The name shown on the editor dialog and rows. Self stays "me" for a
  // familiar label; another user shows their display name.
  const targetName = isSelf
    ? isHebrew
      ? "אני"
      : "Me"
    : targetBasic.displayName;

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
          {isHebrew ? "תיקון בדיעבד" : "Backdate a bet"}
        </h1>
        <p className="text-base text-on-surface-variant">
          {isHebrew
            ? "כאן אפשר להוסיף או לתקן הימורים של כל משתתף, גם אחרי שמשחק התחיל — למקרה שהימור לא נשמר בגלל תקלה."
            : "Add or fix any player's bets, even after a match has started — for when a bet failed to save."}
        </p>
      </header>

      <Card className="p-4 md:p-5 flex flex-col gap-3 border-primary/30 bg-primary/[0.04]">
        <UserPicker
          locale={locale}
          users={selectableUsers}
          currentUserId={targetId}
          selfUserId={user.id}
        />
        {!isSelf && (
          <p className="text-sm text-on-surface inline-flex items-center gap-2">
            <UserIcon className="h-4 w-4 text-primary shrink-0" strokeWidth={2} />
            {isHebrew ? (
              <span>
                מתקנים עבור <span className="font-bold">{targetName}</span>
              </span>
            ) : (
              <span>
                Fixing for <span className="font-bold">{targetName}</span>
              </span>
            )}
          </p>
        )}
      </Card>

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
        targetUserId={targetId}
        targetName={targetName}
        matchRows={matchRows}
        customRows={customRows}
        advanceRows={advanceRows}
        playerNames={playerNames}
        stakeBounds={stakeBounds}
      />

      <AuditLog rows={audit} locale={locale} />
    </section>
  );
}

// Private backdate trail. Every backdated row this admin wrote, across all
// target users, newest first.
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
  // Both 'match' and 'advance' surfaces carry the matchup (advance reuses the
  // match join); 'custom' carries the question.
  const subject =
    row.surface === "custom"
      ? isHebrew
        ? (row.questionHe ?? "—")
        : (row.questionEn ?? "—")
      : isHebrew
        ? `${row.matchHomeHe ?? "?"} נגד ${row.matchAwayHe ?? "?"}`
        : `${row.matchHomeEn ?? "?"} vs ${row.matchAwayEn ?? "?"}`;
  const surfaceLabel =
    row.surface === "advance"
      ? isHebrew
        ? "מי עולה"
        : "Who advances"
      : row.surface === "custom"
        ? isHebrew
          ? "הימור"
          : "Bet"
        : isHebrew
          ? "תוצאה"
          : "Score";
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
      <div className="flex items-center gap-2 flex-wrap text-xs text-on-surface-variant">
        <span className="tabular-nums">{when}</span>
        <span aria-hidden>·</span>
        <span className="inline-flex items-center gap-1">
          <UserIcon className="h-3 w-3" strokeWidth={2} />
          {row.isSelf
            ? isHebrew
              ? "אני"
              : "Me"
            : (row.targetUserName ?? (isHebrew ? "משתמש" : "user"))}
        </span>
        <span aria-hidden>·</span>
        <span>{surfaceLabel}</span>
      </div>
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
  surface: "match" | "custom" | "advance",
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
  if (surface === "advance") {
    const v = value as { team?: string };
    return typeof v.team === "string" && v.team.length > 0 ? v.team : "—";
  }
  const a = value as { type?: string; value?: unknown };
  if (a.type === "yes_no") {
    return a.value ? (isHebrew ? "כן" : "Yes") : isHebrew ? "לא" : "No";
  }
  if (a.value == null) return "—";
  return String(a.value);
}
