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
} from "lucide-react";
import { hasLocale, type Locale } from "../../../../dictionaries";
import { requireAdmin } from "@/lib/admin";
import {
  fetchUserBasic,
  fetchUserBetsForAdmin,
  fetchUserMatchPicksForAdmin,
  type AdminUserBetRow,
  type AdminUserMatchPickRow,
} from "../../queries";
import { Card, Chip, SectionHeading, LabelCaps, MatchupLabel } from "@/components/ui";
import { localePath } from "@/lib/paths";
import { formatDateTime } from "@/lib/format";
import { AdminPickEditor } from "./AdminPickEditor";
import type { PickAnswer } from "@/lib/bets/types";

// Admin read-only view of one user's bets across every surface. Mirrors
// the structure of /admin/users/[id]/bank: back link, header with the
// user's identity, then sections per surface. Each section lists every
// open / locked bet on that surface and shows the user's answer (or a
// faint "—" if they haven't picked). Edits are deliberately not here
// yet — see _plans/2026-06-08-admin-bet-inspector.md phase 2 for the
// write path with audit + reason + lock-bypass.

export default async function AdminUserBetsPage({
  params,
}: {
  params: Promise<{ lang: string; id: string }>;
}) {
  const { lang, id } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const isHebrew = locale === "he";
  await requireAdmin(locale);
  const ChevronBack = isHebrew ? ChevronRight : ChevronLeft;

  const [user, customRows, matchRows] = await Promise.all([
    fetchUserBasic(id),
    fetchUserBetsForAdmin(id),
    fetchUserMatchPicksForAdmin(id),
  ]);
  if (!user) notFound();

  console.info("[admin bet read]", {
    page: "user_editor",
    targetUserId: id,
    customBetCount: customRows.length,
    matchCount: matchRows.length,
  });

  const buckets = groupByScope(customRows);

  const totalCustom = customRows.length;
  const filledCustom = customRows.filter((r) => r.pickId != null).length;
  const totalMatch = matchRows.length;
  const filledMatch = matchRows.filter((r) => r.pickId != null).length;

  return (
    <section className="px-4 md:px-10 py-6 md:py-10 flex flex-col gap-8 max-w-3xl mx-auto w-full pb-24 md:pb-10">
      <header className="flex flex-col gap-2">
        <Link
          href={localePath(locale, "admin/users")}
          className="inline-flex items-center gap-1 text-sm text-on-surface-variant hover:text-primary self-start"
        >
          <ChevronBack className="h-4 w-4" />
          {isHebrew ? "חזרה למשתתפים" : "Back to users"}
        </Link>
        <h1 className="font-[family-name:var(--font-display)] text-[24px] leading-8 md:text-[36px] md:leading-[40px] font-bold text-primary inline-flex items-center gap-3">
          <ListChecks className="h-6 w-6 md:h-8 md:w-8" strokeWidth={1.75} />
          {isHebrew ? "הימורי המשתמש" : "User bets"}
        </h1>
        <p className="text-base text-on-surface-variant">
          <strong className="text-on-surface">{user.displayName}</strong>
          <span aria-hidden className="mx-2 opacity-40">·</span>
          <span className="font-mono text-sm">{user.phone}</span>
        </p>
      </header>

      <Card className="p-5 md:p-6 flex flex-col gap-4">
        <SectionHeading underline="thin" as="h2">
          {isHebrew ? "סיכום מילוי" : "Fill summary"}
        </SectionHeading>
        <div className="grid grid-cols-2 gap-4">
          <SummaryCell
            label={isHebrew ? "הימורי משחק (1/X/2)" : "Match picks (1/X/2)"}
            filled={filledMatch}
            total={totalMatch}
          />
          <SummaryCell
            label={isHebrew ? "הימורים מיוחדים" : "Custom bets"}
            filled={filledCustom}
            total={totalCustom}
          />
        </div>
      </Card>

      {buckets.tournament.length > 0 && (
        <ScopeSection
          icon={<Trophy className="h-5 w-5" strokeWidth={1.75} />}
          title={isHebrew ? "הימורי טורניר" : "Tournament bets"}
          rows={buckets.tournament}
          locale={locale}
          targetUserId={id}
          targetUserName={user.displayName}
        />
      )}

      {buckets.stage.length > 0 && (
        <ScopeSection
          icon={<Layers className="h-5 w-5" strokeWidth={1.75} />}
          title={isHebrew ? "הימורי שלב" : "Stage bets"}
          rows={buckets.stage}
          locale={locale}
          targetUserId={id}
          targetUserName={user.displayName}
        />
      )}

      {buckets.group.length > 0 && (
        <ScopeSection
          icon={<Layers className="h-5 w-5" strokeWidth={1.75} />}
          title={isHebrew ? "הימורי בית" : "Group bets"}
          rows={buckets.group}
          locale={locale}
          targetUserId={id}
          targetUserName={user.displayName}
        />
      )}

      {buckets.day.length > 0 && (
        <ScopeSection
          icon={<CalendarDays className="h-5 w-5" strokeWidth={1.75} />}
          title={isHebrew ? "הימורי יום" : "Day bets"}
          rows={buckets.day}
          locale={locale}
          targetUserId={id}
          targetUserName={user.displayName}
        />
      )}

      {buckets.match.length > 0 && (
        <ScopeSection
          icon={<Sparkles className="h-5 w-5" strokeWidth={1.75} />}
          title={isHebrew ? "הימורי לייב" : "Live bets"}
          rows={buckets.match}
          locale={locale}
          targetUserId={id}
          targetUserName={user.displayName}
        />
      )}

      {matchRows.length > 0 && (
        <MatchPicksSection
          rows={matchRows}
          locale={locale}
          targetUserId={id}
          targetUserName={user.displayName}
        />
      )}

      {customRows.length === 0 && matchRows.length === 0 && (
        <Card className="p-6 text-center text-on-surface-variant">
          {isHebrew
            ? "אין הימורים פתוחים במערכת."
            : "No open bets in the system."}
        </Card>
      )}
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

function SummaryCell({
  label,
  filled,
  total,
}: {
  label: string;
  filled: number;
  total: number;
}) {
  const ratio = total === 0 ? 0 : filled / total;
  const tone =
    total === 0
      ? "text-on-surface-variant"
      : ratio === 1
        ? "text-secondary"
        : ratio === 0
          ? "text-error"
          : "text-on-surface";
  return (
    <div className="flex flex-col gap-1">
      <LabelCaps>{label}</LabelCaps>
      <span
        className={`font-[family-name:var(--font-score)] text-2xl md:text-3xl font-bold tabular-nums ${tone}`}
      >
        <bdi>
          {filled}
          <span className="opacity-50"> / {total}</span>
        </bdi>
      </span>
    </div>
  );
}

function ScopeSection({
  icon,
  title,
  rows,
  locale,
  targetUserId,
  targetUserName,
}: {
  icon: React.ReactNode;
  title: string;
  rows: AdminUserBetRow[];
  locale: Locale;
  targetUserId: string;
  targetUserName: string;
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
            targetUserId={targetUserId}
            targetUserName={targetUserName}
          />
        ))}
      </div>
    </section>
  );
}

function BetRow({
  row,
  locale,
  targetUserId,
  targetUserName,
}: {
  row: AdminUserBetRow;
  locale: Locale;
  targetUserId: string;
  targetUserName: string;
}) {
  const isHebrew = locale === "he";
  const hasPick = row.pickId != null;
  const lockLabel = formatDateTime(row.lockAt, locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const answerLabel = renderAnswer(
    row.answerType,
    row.answerConfig,
    row.pickAnswer,
    isHebrew,
  );
  return (
    <Card className="p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <h3 className="text-sm md:text-base font-bold text-on-surface leading-snug min-w-0 flex-1">
          {isHebrew ? row.questionHe : row.questionEn}
        </h3>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Chip tone={row.status === "open" ? "primary" : "default"}>
            {row.status === "open"
              ? isHebrew ? "פתוח" : "Open"
              : isHebrew ? "נסגר" : "Locked"}
          </Chip>
          <span className="text-xs text-on-surface-variant tabular-nums inline-flex items-center gap-1">
            <Lock className="h-3 w-3" strokeWidth={2} />
            {lockLabel}
          </span>
          <AdminPickEditor
            surface="custom"
            customBetId={row.betId}
            questionHe={row.questionHe}
            questionEn={row.questionEn}
            answerType={row.answerType}
            answerConfig={row.answerConfig}
            currentAnswer={(row.pickAnswer ?? null) as PickAnswer | null}
            stake={row.stakeSnapshot}
            payout={row.payoutSnapshot}
            targetUserId={targetUserId}
            targetUserName={targetUserName}
            locale={locale}
            lockAt={row.lockAt}
          />
        </div>
      </div>
      {row.homeCode && row.awayCode && (
        <div className="text-xs text-on-surface-variant">
          <MatchupLabel
            home={isHebrew ? (row.homeNameHe ?? row.homeCode) : (row.homeNameEn ?? row.homeCode)}
            away={isHebrew ? (row.awayNameHe ?? row.awayCode) : (row.awayNameEn ?? row.awayCode)}
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
          <CircleHelp className="h-4 w-4 text-on-surface-variant shrink-0" strokeWidth={2} />
        )}
        <span
          className={`flex-1 ${hasPick ? "text-on-surface font-medium" : "text-on-surface-variant italic"}`}
        >
          {hasPick
            ? answerLabel
            : isHebrew ? "לא ניחש" : "Not picked"}
        </span>
        {hasPick && row.pickStakePaid != null && row.pickStakePaid > 0 && (
          <span className="text-xs text-on-surface-variant tabular-nums">
            {isHebrew ? "עלות:" : "Cost:"} {row.pickStakePaid}
          </span>
        )}
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
  targetUserId,
  targetUserName,
}: {
  rows: AdminUserMatchPickRow[];
  locale: Locale;
  targetUserId: string;
  targetUserName: string;
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
            targetUserId={targetUserId}
            targetUserName={targetUserName}
          />
        ))}
      </Card>
    </section>
  );
}

function MatchPickRow({
  row,
  locale,
  targetUserId,
  targetUserName,
}: {
  row: AdminUserMatchPickRow;
  locale: Locale;
  targetUserId: string;
  targetUserName: string;
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
  const editable = row.matchStatus === "scheduled";
  const matchupHe = `${row.homeNameHe} נגד ${row.awayNameHe}`;
  const matchupEn = `${row.homeNameEn} vs ${row.awayNameEn}`;
  return (
    <div
      className={`flex items-center gap-2 py-2 px-2 rounded border-b border-outline-variant last:border-b-0 ${
        hasPick ? "" : "opacity-90"
      }`}
    >
      <span className="text-xs text-on-surface-variant tabular-nums shrink-0 w-20 md:w-24">
        {kickoff}
      </span>
      <span className="text-sm flex-1 min-w-0 truncate">
        <MatchupLabel home={home} away={away} locale={locale} />
      </span>
      {hasPick ? (
        <span className="text-sm font-bold tabular-nums shrink-0 inline-flex items-center gap-1">
          <Check className="h-3.5 w-3.5 text-secondary" strokeWidth={2.5} />
          <bdi>
            {row.pickHomeScore}–{row.pickAwayScore}
          </bdi>
        </span>
      ) : (
        <span className="text-xs text-on-surface-variant italic shrink-0 inline-flex items-center gap-1">
          <X className="h-3.5 w-3.5" strokeWidth={2} />
          {isHebrew ? "—" : "—"}
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
      {editable && (
        <AdminPickEditor
          surface="match"
          matchId={row.matchId}
          matchupHe={matchupHe}
          matchupEn={matchupEn}
          currentHomeScore={row.pickHomeScore}
          currentAwayScore={row.pickAwayScore}
          targetUserId={targetUserId}
          targetUserName={targetUserName}
          locale={locale}
          lockAt={row.kickoffAt}
        />
      )}
    </div>
  );
}

// Renders the JSON `answer` blob as a human-readable label, resolving
// multi-choice values to their localized option label. Mirrors the
// helper in /admin/bets/[id]/page.tsx; not extracted to a shared lib
// yet because phase 2 will replace both call sites with a single
// shared modal that reuses the user-facing AnswerInput components.
function renderAnswer(
  answerType: string,
  config: unknown,
  answer: unknown,
  isHebrew: boolean,
): string {
  if (!answer || typeof answer !== "object") return "—";
  const a = answer as { type?: string; value?: unknown };
  if (a.type === "yes_no") {
    return a.value ? (isHebrew ? "כן" : "Yes") : (isHebrew ? "לא" : "No");
  }
  if (a.type === "number") return String(a.value ?? "—");
  if (a.type === "multi_choice" && typeof a.value === "string") {
    const c = config as
      | { options?: Array<{ value: string; labelHe: string; labelEn: string }> }
      | null;
    const opt = c?.options?.find((o) => o.value === a.value);
    if (opt) return isHebrew ? opt.labelHe : opt.labelEn;
    return a.value;
  }
  if (a.type === "free_text" && typeof a.value === "string") return a.value;
  return "—";
}
