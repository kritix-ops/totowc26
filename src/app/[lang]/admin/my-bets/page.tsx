import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Trophy,
  CalendarDays,
  Layers,
  ListChecks,
  Check,
  X,
  Lock,
  CircleHelp,
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
  type AdminUserBetRow,
  type AdminUserMatchPickRow,
} from "../users/queries";
import {
  Card,
  Chip,
  SectionHeading,
  MatchupLabel,
  ScoreLine,
} from "@/components/ui";
import { localePath } from "@/lib/paths";
import { getLiveStakeConfig } from "@/lib/bank";
import { formatDateTime } from "@/lib/format";
import { renderPickAnswer, type PlayerNameMap } from "@/lib/bets/format";
import type { PickAnswer } from "@/lib/bets/types";
import { MyBetsEditor } from "./MyBetsEditor";
import { fetchMyBackdateAudit, type MyBackdateAuditRow } from "./actions";

// Admin self-backdate page. A FULL admin only — the admin layout's path
// whitelist excludes /my-bets for scoped operators, and requireAdmin here is
// the defense-in-depth mirror. Lists the admin's OWN bets across every surface
// and lets them add or fix a pick even after a match has started/finished, so
// a save dropped by the recurring prod DB hang can be corrected. Every edit is
// recorded in the private audit log at the bottom — visible only to the admin.
// See _plans/2026-06-23-admin-self-backdate-bets.md.

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

  // Bounds for the live (match/day) stake picker. Passed to every bet row; the
  // editor only renders the picker for live scopes, so free-pick rows ignore it.
  const stakeBounds = {
    minStake: liveStakeConfig.minStake,
    maxStake: liveStakeConfig.maxStake,
  };

  console.info("[admin self-backdate] page_read", {
    adminId: user.id,
    customBetCount: customRows.length,
    matchCount: matchRows.length,
    auditRows: audit.length,
  });

  const buckets = groupByScope(customRows);
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

      {matchRows.length > 0 && (
        <MatchPicksSection
          rows={matchRows}
          locale={locale}
          selfUserId={user.id}
          selfName={meName}
        />
      )}

      {buckets.match.length > 0 && (
        <ScopeSection
          icon={<Sparkles className="h-5 w-5" strokeWidth={1.75} />}
          title={isHebrew ? "הימורי לייב" : "Live bets"}
          rows={buckets.match}
          locale={locale}
          selfUserId={user.id}
          selfName={meName}
          playerNames={playerNames}
          stakeBounds={stakeBounds}
        />
      )}

      {buckets.day.length > 0 && (
        <ScopeSection
          icon={<CalendarDays className="h-5 w-5" strokeWidth={1.75} />}
          title={isHebrew ? "הימורי יום" : "Day bets"}
          rows={buckets.day}
          locale={locale}
          selfUserId={user.id}
          selfName={meName}
          playerNames={playerNames}
          stakeBounds={stakeBounds}
        />
      )}

      {buckets.group.length > 0 && (
        <ScopeSection
          icon={<Layers className="h-5 w-5" strokeWidth={1.75} />}
          title={isHebrew ? "הימורי בית" : "Group bets"}
          rows={buckets.group}
          locale={locale}
          selfUserId={user.id}
          selfName={meName}
          playerNames={playerNames}
          stakeBounds={stakeBounds}
        />
      )}

      {buckets.stage.length > 0 && (
        <ScopeSection
          icon={<Layers className="h-5 w-5" strokeWidth={1.75} />}
          title={isHebrew ? "הימורי שלב" : "Stage bets"}
          rows={buckets.stage}
          locale={locale}
          selfUserId={user.id}
          selfName={meName}
          playerNames={playerNames}
          stakeBounds={stakeBounds}
        />
      )}

      {buckets.tournament.length > 0 && (
        <ScopeSection
          icon={<Trophy className="h-5 w-5" strokeWidth={1.75} />}
          title={isHebrew ? "הימורי טורניר" : "Tournament bets"}
          rows={buckets.tournament}
          locale={locale}
          selfUserId={user.id}
          selfName={meName}
          playerNames={playerNames}
          stakeBounds={stakeBounds}
        />
      )}

      {customRows.length === 0 && matchRows.length === 0 && (
        <Card className="p-6 text-center text-on-surface-variant">
          {isHebrew ? "אין הימורים במערכת." : "No bets in the system."}
        </Card>
      )}

      <AuditLog rows={audit} locale={locale} />
    </section>
  );
}

function groupByScope(rows: AdminUserBetRow[]) {
  const out = {
    tournament: [] as AdminUserBetRow[],
    stage: [] as AdminUserBetRow[],
    group: [] as AdminUserBetRow[],
    day: [] as AdminUserBetRow[],
    match: [] as AdminUserBetRow[],
  };
  for (const r of rows) out[r.scope].push(r);
  return out;
}

function ScopeSection({
  icon,
  title,
  rows,
  locale,
  selfUserId,
  selfName,
  playerNames,
  stakeBounds,
}: {
  icon: React.ReactNode;
  title: string;
  rows: AdminUserBetRow[];
  locale: Locale;
  selfUserId: string;
  selfName: string;
  playerNames: PlayerNameMap;
  stakeBounds: { minStake: number; maxStake: number };
}) {
  return (
    <section className="flex flex-col gap-3">
      <SectionHeading as="h2" underline="thin">
        <span className="inline-flex items-center gap-2">
          {icon}
          {title}
          <span className="text-xs font-normal text-on-surface-variant tabular-nums">
            ({rows.filter((r) => r.pickId != null).length} / {rows.length})
          </span>
        </span>
      </SectionHeading>
      <div className="flex flex-col gap-2">
        {rows.map((r) => (
          <BetRow
            key={r.betId}
            row={r}
            locale={locale}
            selfUserId={selfUserId}
            selfName={selfName}
            playerNames={playerNames}
            stakeBounds={stakeBounds}
          />
        ))}
      </div>
    </section>
  );
}

function BetRow({
  row,
  locale,
  selfUserId,
  selfName,
  playerNames,
  stakeBounds,
}: {
  row: AdminUserBetRow;
  locale: Locale;
  selfUserId: string;
  selfName: string;
  playerNames: PlayerNameMap;
  stakeBounds: { minStake: number; maxStake: number };
}) {
  const isHebrew = locale === "he";
  const hasPick = row.pickId != null;
  const lockLabel = formatDateTime(row.lockAt, locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const answerLabel = renderPickAnswer(
    row.answerType,
    row.answerConfig,
    row.pickAnswer,
    isHebrew,
    playerNames,
  );
  return (
    <Card className="p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <h3 className="text-sm md:text-base font-bold text-on-surface leading-snug min-w-0 flex-1">
          {isHebrew ? row.questionHe : row.questionEn}
        </h3>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Chip
            tone={
              row.status === "open"
                ? "primary"
                : row.status === "graded"
                  ? "secondary"
                  : "default"
            }
          >
            {row.status === "open"
              ? isHebrew
                ? "פתוח"
                : "Open"
              : row.status === "graded"
                ? isHebrew
                  ? "נגמר"
                  : "Settled"
                : isHebrew
                  ? "נסגר"
                  : "Locked"}
          </Chip>
          <span className="text-xs text-on-surface-variant tabular-nums inline-flex items-center gap-1">
            <Lock className="h-3 w-3" strokeWidth={2} />
            {lockLabel}
          </span>
          <MyBetsEditor
            surface="custom"
            customBetId={row.betId}
            questionHe={row.questionHe}
            questionEn={row.questionEn}
            answerType={row.answerType}
            answerConfig={row.answerConfig}
            currentAnswer={(row.pickAnswer ?? null) as PickAnswer | null}
            stake={row.stakeSnapshot}
            payout={row.payoutSnapshot}
            scope={row.scope}
            stakeBounds={stakeBounds}
            currentStake={row.pickStakePaid}
            targetUserId={selfUserId}
            targetUserName={selfName}
            locale={locale}
            lockAt={row.lockAt}
            triggerLabel={
              hasPick
                ? isHebrew
                  ? "תקן"
                  : "Fix"
                : isHebrew
                  ? "הוסף"
                  : "Add"
            }
          />
        </div>
      </div>
      {row.homeCode && row.awayCode && (
        <div className="text-xs text-on-surface-variant">
          <MatchupLabel
            home={
              isHebrew
                ? (row.homeNameHe ?? row.homeCode)
                : (row.homeNameEn ?? row.homeCode)
            }
            away={
              isHebrew
                ? (row.awayNameHe ?? row.awayCode)
                : (row.awayNameEn ?? row.awayCode)
            }
            locale={locale}
          />
        </div>
      )}
      <div
        className={`flex items-center gap-2 text-sm rounded p-2 ${
          hasPick
            ? "bg-surface-container-low border border-outline-variant"
            : "bg-transparent border border-dashed border-outline-variant"
        }`}
      >
        {hasPick ? (
          <Check className="h-4 w-4 text-secondary shrink-0" strokeWidth={2.5} />
        ) : (
          <CircleHelp
            className="h-4 w-4 text-on-surface-variant shrink-0"
            strokeWidth={2}
          />
        )}
        <span
          className={`flex-1 ${hasPick ? "text-on-surface font-medium" : "text-on-surface-variant italic"}`}
        >
          {hasPick ? answerLabel : isHebrew ? "לא ניחשת" : "Not picked"}
        </span>
        {row.pickPointsEarned != null && (
          <span
            className={`text-xs tabular-nums font-bold ${
              row.pickWasCorrect ? "text-secondary" : "text-error"
            }`}
          >
            {row.pickWasCorrect ? "+" : ""}
            {row.pickPointsEarned}
          </span>
        )}
      </div>
    </Card>
  );
}

function MatchPicksSection({
  rows,
  locale,
  selfUserId,
  selfName,
}: {
  rows: AdminUserMatchPickRow[];
  locale: Locale;
  selfUserId: string;
  selfName: string;
}) {
  const isHebrew = locale === "he";
  const filled = rows.filter((r) => r.pickId != null).length;
  return (
    <section className="flex flex-col gap-3">
      <SectionHeading as="h2" underline="thin">
        <span className="inline-flex items-center gap-2">
          <ListChecks className="h-5 w-5" strokeWidth={1.75} />
          {isHebrew ? "הימורי 1/X/2" : "Score picks (1/X/2)"}
          <span className="text-xs font-normal text-on-surface-variant tabular-nums">
            ({filled} / {rows.length})
          </span>
        </span>
      </SectionHeading>
      <Card className="p-3 md:p-4 flex flex-col gap-1">
        {rows.map((r) => (
          <MatchPickRow
            key={r.matchId}
            row={r}
            locale={locale}
            selfUserId={selfUserId}
            selfName={selfName}
          />
        ))}
      </Card>
    </section>
  );
}

function MatchPickRow({
  row,
  locale,
  selfUserId,
  selfName,
}: {
  row: AdminUserMatchPickRow;
  locale: Locale;
  selfUserId: string;
  selfName: string;
}) {
  const isHebrew = locale === "he";
  const hasPick = row.pickId != null;
  const kickoff = formatDateTime(row.kickoffAt, locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const home = isHebrew ? row.homeNameHe : row.homeNameEn;
  const away = isHebrew ? row.awayNameHe : row.awayNameEn;
  const matchupHe = `${row.homeNameHe} נגד ${row.awayNameHe}`;
  const matchupEn = `${row.homeNameEn} vs ${row.awayNameEn}`;
  // Unlike the read-only per-user inspector, EVERY match is editable here —
  // that is the whole point. A started/finished match surfaces the lock-bypass
  // checkbox inside the dialog.
  const started = row.matchStatus !== "scheduled";
  return (
    <div className="flex items-center gap-2 py-2 px-2 rounded border-b border-outline-variant last:border-b-0">
      <span className="text-xs text-on-surface-variant tabular-nums shrink-0 w-20 md:w-24">
        {kickoff}
      </span>
      <span className="text-sm flex-1 min-w-0 truncate">
        <MatchupLabel home={home} away={away} locale={locale} />
        {started && (
          <span className="ms-1 text-[10px] font-bold uppercase text-error align-middle">
            {isHebrew ? "התחיל" : "started"}
          </span>
        )}
      </span>
      {hasPick ? (
        <span className="text-sm font-bold tabular-nums shrink-0 inline-flex items-center gap-1">
          <Check className="h-3.5 w-3.5 text-secondary" strokeWidth={2.5} />
          <ScoreLine
            home={row.pickHomeScore!}
            away={row.pickAwayScore!}
            separator="–"
          />
        </span>
      ) : (
        <span className="text-xs text-on-surface-variant italic shrink-0 inline-flex items-center gap-1">
          <X className="h-3.5 w-3.5" strokeWidth={2} />—
        </span>
      )}
      {row.pickPointsEarned != null && (
        <span
          className={`text-xs font-bold tabular-nums shrink-0 w-10 text-end ${
            row.pickPointsEarned > 0 ? "text-secondary" : "text-on-surface-variant"
          }`}
        >
          {row.pickPointsEarned > 0 ? "+" : ""}
          {row.pickPointsEarned}
        </span>
      )}
      <MyBetsEditor
        surface="match"
        matchId={row.matchId}
        matchupHe={matchupHe}
        matchupEn={matchupEn}
        currentHomeScore={row.pickHomeScore}
        currentAwayScore={row.pickAwayScore}
        targetUserId={selfUserId}
        targetUserName={selfName}
        locale={locale}
        lockAt={row.kickoffAt}
        triggerLabel={
          hasPick ? (isHebrew ? "תקן" : "Fix") : isHebrew ? "הוסף" : "Add"
        }
      />
    </div>
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
