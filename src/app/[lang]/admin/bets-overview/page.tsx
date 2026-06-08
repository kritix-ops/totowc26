import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Grid3x3,
  Check,
  CircleHelp,
  Trophy,
  Layers,
  CalendarDays,
  Sparkles,
} from "lucide-react";
import { hasLocale, type Locale } from "../../dictionaries";
import { requireAdmin } from "@/lib/admin";
import {
  fetchAllUsersBetMatrix,
  type AdminBetMatrixCell,
} from "../users/queries";
import { Card, LabelCaps } from "@/components/ui";
import { localePath } from "@/lib/paths";

// All-users × all-open-bets overview. The point: in ONE screen, scan
// who has and hasn't filled each tournament-wide / group / stage bet
// before the deadline. Per-user drill is at /admin/users/[id]/bets;
// from any "—" cell you can jump there to fix it.
//
// Mobile: the matrix folds into one section per user (display-name
// sorted), with that user's filled / total per surface and a tap to
// their per-user page. Desktop: the same data but laid out as a
// proper table with the bets along the columns.

const SCOPE_ORDER: Array<AdminBetMatrixCell["scope"]> = [
  "tournament",
  "stage",
  "group",
  "day",
  "match",
];

const SCOPE_LABEL_HE: Record<AdminBetMatrixCell["scope"], string> = {
  tournament: "טורניר",
  stage: "שלב",
  group: "בית",
  day: "יום",
  match: "לייב",
};

const SCOPE_LABEL_EN: Record<AdminBetMatrixCell["scope"], string> = {
  tournament: "Tournament",
  stage: "Stage",
  group: "Group",
  day: "Day",
  match: "Live",
};

const SCOPE_ICON: Record<AdminBetMatrixCell["scope"], React.ReactNode> = {
  tournament: <Trophy className="h-4 w-4" strokeWidth={1.75} />,
  stage: <Layers className="h-4 w-4" strokeWidth={1.75} />,
  group: <Layers className="h-4 w-4" strokeWidth={1.75} />,
  day: <CalendarDays className="h-4 w-4" strokeWidth={1.75} />,
  match: <Sparkles className="h-4 w-4" strokeWidth={1.75} />,
};

export default async function AdminBetsOverviewPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const isHebrew = locale === "he";
  await requireAdmin(locale);
  const ChevronBack = isHebrew ? ChevronRight : ChevronLeft;

  const cells = await fetchAllUsersBetMatrix();

  console.info("[admin bet read]", {
    page: "overview_matrix",
    cellCount: cells.length,
  });

  // Group cells: unique users (preserving SQL display-name sort), unique
  // bets (preserving the scope/lock sort), and a (user,bet)->cell map.
  const userOrder: Array<{ id: string; name: string }> = [];
  const seenUsers = new Set<string>();
  const betOrder: AdminBetMatrixCell[] = [];
  const seenBets = new Set<string>();
  const pickByKey = new Map<string, AdminBetMatrixCell>();
  for (const c of cells) {
    if (!seenUsers.has(c.userId)) {
      seenUsers.add(c.userId);
      userOrder.push({ id: c.userId, name: c.userDisplayName });
    }
    if (!seenBets.has(c.betId)) {
      seenBets.add(c.betId);
      betOrder.push(c);
    }
    pickByKey.set(c.userId + "|" + c.betId, c);
  }

  // Bets bucketed by scope for desktop column groupings + mobile
  // per-surface filtering.
  const betsByScope = new Map<AdminBetMatrixCell["scope"], AdminBetMatrixCell[]>();
  for (const s of SCOPE_ORDER) betsByScope.set(s, []);
  for (const b of betOrder) betsByScope.get(b.scope)!.push(b);

  return (
    <section className="px-4 md:px-10 py-6 md:py-10 flex flex-col gap-6 md:gap-8 max-w-[1400px] mx-auto w-full pb-24 md:pb-10">
      <header className="flex flex-col gap-2">
        <Link
          href={localePath(locale, "admin")}
          className="inline-flex items-center gap-1 text-sm text-on-surface-variant hover:text-primary self-start"
        >
          <ChevronBack className="h-4 w-4" />
          {isHebrew ? "חזרה לאדמין" : "Back to admin"}
        </Link>
        <h1 className="font-[family-name:var(--font-display)] text-[24px] leading-8 md:text-[36px] md:leading-[40px] font-bold text-primary inline-flex items-center gap-3">
          <Grid3x3 className="h-6 w-6 md:h-8 md:w-8" strokeWidth={1.75} />
          {isHebrew ? "מצב הימורי כולם" : "Everyone's bets"}
        </h1>
        <p className="text-sm text-on-surface-variant">
          {isHebrew
            ? `${userOrder.length} משתתפים · ${betOrder.length} הימורים פתוחים. לחץ על שם משתמש כדי לערוך עבורו.`
            : `${userOrder.length} players · ${betOrder.length} open bets. Tap a name to edit on their behalf.`}
        </p>
      </header>

      {/* Desktop matrix */}
      <Card className="hidden md:block overflow-x-auto p-0">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-surface-container z-10">
            <tr className="border-b-2 border-outline-variant">
              <th className="px-3 py-2 text-start text-xs font-bold text-on-surface-variant sticky start-0 bg-surface-container z-20 min-w-[160px]">
                {isHebrew ? "משתתף" : "Player"}
              </th>
              {SCOPE_ORDER.map((scope) => {
                const bs = betsByScope.get(scope) ?? [];
                if (bs.length === 0) return null;
                return (
                  <th
                    key={`scope-${scope}`}
                    colSpan={bs.length}
                    className="px-2 py-1 text-center text-[11px] font-bold uppercase tracking-wide text-on-surface-variant border-s border-outline-variant"
                  >
                    <span className="inline-flex items-center gap-1">
                      {SCOPE_ICON[scope]}
                      {isHebrew ? SCOPE_LABEL_HE[scope] : SCOPE_LABEL_EN[scope]}
                    </span>
                  </th>
                );
              })}
            </tr>
            <tr className="border-b border-outline-variant">
              <th className="sticky start-0 bg-surface-container z-20"></th>
              {SCOPE_ORDER.flatMap((scope) => {
                const bs = betsByScope.get(scope) ?? [];
                return bs.map((b) => (
                  <th
                    key={b.betId}
                    className="px-2 py-2 text-start text-[10px] font-normal text-on-surface-variant border-s border-outline-variant min-w-[100px] max-w-[160px]"
                  >
                    <span className="line-clamp-2 leading-tight">
                      {isHebrew ? b.questionHe : b.questionEn}
                    </span>
                  </th>
                ));
              })}
            </tr>
          </thead>
          <tbody>
            {userOrder.map((user, idx) => (
              <tr
                key={user.id}
                className={`border-b border-outline-variant ${
                  idx % 2 === 0 ? "bg-surface" : "bg-surface-container-low"
                }`}
              >
                <td className="px-3 py-2 sticky start-0 bg-inherit z-10 font-medium">
                  <Link
                    href={localePath(locale, `admin/users/${user.id}/bets`)}
                    className="text-on-surface hover:text-primary underline-offset-2 hover:underline"
                  >
                    {user.name}
                  </Link>
                </td>
                {SCOPE_ORDER.flatMap((scope) => {
                  const bs = betsByScope.get(scope) ?? [];
                  return bs.map((b) => {
                    const cell = pickByKey.get(user.id + "|" + b.betId);
                    return (
                      <td
                        key={b.betId}
                        className="px-2 py-2 border-s border-outline-variant text-xs"
                      >
                        <PickCell cell={cell} locale={locale} />
                      </td>
                    );
                  });
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Mobile: per-user accordion */}
      <div className="md:hidden flex flex-col gap-3">
        {userOrder.map((user) => (
          <MobileUserCard
            key={user.id}
            user={user}
            betsByScope={betsByScope}
            pickByKey={pickByKey}
            locale={locale}
          />
        ))}
      </div>

      {userOrder.length === 0 && (
        <Card className="p-6 text-center text-on-surface-variant">
          {isHebrew ? "אין משתתפים." : "No players yet."}
        </Card>
      )}
    </section>
  );
}

function PickCell({
  cell,
  locale,
}: {
  cell: AdminBetMatrixCell | undefined;
  locale: Locale;
}) {
  const isHebrew = locale === "he";
  if (!cell || cell.pickAnswer == null) {
    return (
      <span className="inline-flex items-center gap-1 text-on-surface-variant italic opacity-60">
        <CircleHelp className="h-3 w-3" strokeWidth={2} />
        {isHebrew ? "—" : "—"}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-on-surface">
      <Check className="h-3 w-3 text-secondary shrink-0" strokeWidth={2.5} />
      <span className="truncate max-w-[120px]">
        {renderAnswer(cell.answerType, cell.answerConfig, cell.pickAnswer, isHebrew)}
      </span>
    </span>
  );
}

function MobileUserCard({
  user,
  betsByScope,
  pickByKey,
  locale,
}: {
  user: { id: string; name: string };
  betsByScope: Map<AdminBetMatrixCell["scope"], AdminBetMatrixCell[]>;
  pickByKey: Map<string, AdminBetMatrixCell>;
  locale: Locale;
}) {
  const isHebrew = locale === "he";
  // Per-surface fill counts for the header chip.
  const summary: Array<{ scope: AdminBetMatrixCell["scope"]; filled: number; total: number }> = [];
  for (const scope of SCOPE_ORDER) {
    const bs = betsByScope.get(scope) ?? [];
    if (bs.length === 0) continue;
    let filled = 0;
    for (const b of bs) {
      const c = pickByKey.get(user.id + "|" + b.betId);
      if (c?.pickAnswer != null) filled++;
    }
    summary.push({ scope, filled, total: bs.length });
  }
  return (
    <Card className="p-4 flex flex-col gap-3">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <Link
          href={localePath(locale, `admin/users/${user.id}/bets`)}
          className="text-base font-bold text-primary hover:underline"
        >
          {user.name}
        </Link>
        <div className="flex flex-wrap gap-2">
          {summary.map((s) => {
            const allDone = s.filled === s.total;
            return (
              <span
                key={s.scope}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold tabular-nums ${
                  allDone
                    ? "bg-secondary-container text-secondary"
                    : "bg-error-container text-error"
                }`}
              >
                {isHebrew ? SCOPE_LABEL_HE[s.scope] : SCOPE_LABEL_EN[s.scope]}{" "}
                <bdi>
                  {s.filled}/{s.total}
                </bdi>
              </span>
            );
          })}
        </div>
      </header>
      <ul className="flex flex-col gap-1.5">
        {SCOPE_ORDER.flatMap((scope) => {
          const bs = betsByScope.get(scope) ?? [];
          return bs.map((b) => {
            const cell = pickByKey.get(user.id + "|" + b.betId);
            return (
              <li
                key={b.betId}
                className="flex items-start gap-2 text-xs py-1.5 px-2 rounded border border-outline-variant bg-surface"
              >
                <LabelCaps className="shrink-0 w-14 mt-0.5">
                  {isHebrew ? SCOPE_LABEL_HE[b.scope] : SCOPE_LABEL_EN[b.scope]}
                </LabelCaps>
                <span className="flex-1 text-on-surface leading-snug">
                  {isHebrew ? b.questionHe : b.questionEn}
                </span>
                <span className="shrink-0 max-w-[110px] truncate">
                  <PickCell cell={cell} locale={locale} />
                </span>
              </li>
            );
          });
        })}
      </ul>
    </Card>
  );
}

// Same shape as the helper in /admin/users/[id]/bets/page.tsx. Kept
// local because phase 2 didn't extract it; if a third caller appears
// it'll move to src/lib/bets/format.ts.
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
