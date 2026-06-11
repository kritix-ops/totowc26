"use client";

import {
  useState,
  useMemo,
  useDeferredValue,
  useEffect,
  useCallback,
  useTransition,
} from "react";
import { clsx } from "clsx";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Search,
  X,
  Check,
  CircleHelp,
  Trophy,
  Layers,
  CalendarDays,
  Sparkles,
  ListChecks,
  AlertCircle,
} from "lucide-react";
import type { Locale } from "../../dictionaries";
import { localePath } from "@/lib/paths";
import { formatDateTime } from "@/lib/format";
import { Card, LabelCaps, SectionHeading, MatchupLabel, ScoreLine } from "@/components/ui";
import { AdminPickEditor } from "../users/[id]/bets/AdminPickEditor";
import {
  loadUserBetDetail,
  type DrawerCustomBet,
  type UserBetDetail,
} from "./actions";
import type { PickAnswer } from "@/lib/bets/types";

// Client surface for /admin/bets-overview. Owns the search box, the
// completion filter, the desktop matrix / mobile cards, and the per-user
// drawer. Mirrors the UsersExplorer pattern (server fetches + admin-gates,
// client renders + filters) so the two admin "explorer" screens feel the
// same. The heavy per-user detail (every match scoreline, each bet's full
// config for editing) is NOT shipped up front — the drawer lazy-loads it
// per user and caches it.

type Scope = "match" | "day" | "stage" | "group" | "tournament";
type MatchPick = UserBetDetail["matchPicks"][number];

export type OverviewUser = { id: string; name: string };
export type OverviewBet = {
  betId: string;
  scope: Scope;
  questionHe: string;
  questionEn: string;
};

const SCOPE_ORDER: Scope[] = ["tournament", "stage", "group", "day", "match"];

const SCOPE_LABEL_HE: Record<Scope, string> = {
  tournament: "טורניר",
  stage: "שלב",
  group: "בית",
  day: "יום",
  match: "לייב",
};
const SCOPE_LABEL_EN: Record<Scope, string> = {
  tournament: "Tournament",
  stage: "Stage",
  group: "Group",
  day: "Day",
  match: "Live",
};
const SCOPE_ICON: Record<Scope, React.ReactNode> = {
  tournament: <Trophy className="h-4 w-4" strokeWidth={1.75} />,
  stage: <Layers className="h-4 w-4" strokeWidth={1.75} />,
  group: <Layers className="h-4 w-4" strokeWidth={1.75} />,
  day: <CalendarDays className="h-4 w-4" strokeWidth={1.75} />,
  match: <Sparkles className="h-4 w-4" strokeWidth={1.75} />,
};

type FilterKey = "all" | "missing" | "done";
const FILTERS_HE: Record<FilterKey, string> = {
  all: "הכל",
  missing: "חסר ניחוש",
  done: "השלימו הכל",
};
const FILTERS_EN: Record<FilterKey, string> = {
  all: "All",
  missing: "Has gaps",
  done: "Completed",
};

export function BetsOverviewExplorer({
  users,
  bets,
  picks,
  locale,
}: {
  users: OverviewUser[];
  bets: OverviewBet[];
  // `${userId}|${betId}` -> resolved, localized pick label. Only filled
  // cells are present; a missing key means the user hasn't answered.
  picks: Record<string, string>;
  locale: Locale;
}) {
  const isHebrew = locale === "he";
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [openUserId, setOpenUserId] = useState<string | null>(null);

  const betsByScope = useMemo(() => {
    const map = new Map<Scope, OverviewBet[]>();
    for (const s of SCOPE_ORDER) map.set(s, []);
    for (const b of bets) map.get(b.scope)!.push(b);
    return map;
  }, [bets]);

  // Per-user filled count across all bets — drives the completion filter and
  // the count chips.
  const filledByUser = useMemo(() => {
    const counts = new Map<string, number>();
    for (const u of users) {
      let n = 0;
      for (const b of bets) {
        if (picks[`${u.id}|${b.betId}`] != null) n++;
      }
      counts.set(u.id, n);
    }
    return counts;
  }, [users, bets, picks]);

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    return users.filter((u) => {
      if (q && !u.name.toLowerCase().includes(q)) return false;
      const filled = filledByUser.get(u.id) ?? 0;
      if (filter === "missing") return filled < bets.length;
      if (filter === "done") return bets.length > 0 && filled === bets.length;
      return true;
    });
  }, [users, deferredQuery, filter, filledByUser, bets.length]);

  const openUser = users.find((u) => u.id === openUserId) ?? null;
  const F = isHebrew ? FILTERS_HE : FILTERS_EN;

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3">
        <div className="relative">
          <Search
            className="absolute top-1/2 -translate-y-1/2 start-3 h-4 w-4 text-outline pointer-events-none"
            strokeWidth={1.75}
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={isHebrew ? "חפש משתתף לפי שם" : "Search a player by name"}
            inputMode="search"
            className="w-full h-12 rounded-full bg-surface-container-lowest border border-outline-variant focus:border-primary focus:outline-none text-base text-on-surface placeholder:text-outline-variant ps-9 pe-10"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label={isHebrew ? "נקה" : "Clear"}
              className="absolute top-1/2 -translate-y-1/2 end-2 min-w-[36px] min-h-[36px] inline-flex items-center justify-center rounded-full hover:bg-surface-container"
            >
              <X className="h-4 w-4 text-on-surface-variant" />
            </button>
          )}
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 snap-x">
          {(Object.keys(F) as FilterKey[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setFilter(k)}
              className={clsx(
                "snap-start min-h-[40px] px-4 py-1.5 rounded-full text-sm font-bold border whitespace-nowrap transition-colors shrink-0",
                filter === k
                  ? "bg-primary text-on-primary border-primary"
                  : "bg-surface-container-lowest text-on-surface-variant border-outline-variant hover:bg-surface-container",
              )}
            >
              {F[k]}
            </button>
          ))}
          <span className="ms-auto inline-flex items-center px-2 text-xs text-on-surface-variant tabular-nums shrink-0">
            <bdi>
              {filtered.length}/{users.length}
            </bdi>
          </span>
        </div>
      </div>

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
            {filtered.map((user, idx) => (
              <tr
                key={user.id}
                className={`border-b border-outline-variant ${
                  idx % 2 === 0 ? "bg-surface" : "bg-surface-container-low"
                }`}
              >
                <td className="px-3 py-2 sticky start-0 bg-inherit z-10 font-medium">
                  <button
                    type="button"
                    onClick={() => setOpenUserId(user.id)}
                    className="text-start text-on-surface hover:text-primary underline-offset-2 hover:underline inline-flex items-center gap-2"
                  >
                    <span>{user.name}</span>
                    <span className="text-[10px] text-on-surface-variant tabular-nums">
                      <bdi>
                        {filledByUser.get(user.id) ?? 0}/{bets.length}
                      </bdi>
                    </span>
                  </button>
                </td>
                {SCOPE_ORDER.flatMap((scope) => {
                  const bs = betsByScope.get(scope) ?? [];
                  return bs.map((b) => (
                    <td
                      key={b.betId}
                      className="px-2 py-2 border-s border-outline-variant text-xs"
                    >
                      <PickCell
                        label={picks[`${user.id}|${b.betId}`] ?? null}
                        isHebrew={isHebrew}
                      />
                    </td>
                  ));
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="p-6 text-center text-on-surface-variant text-sm">
            {isHebrew ? "לא נמצאו משתתפים" : "No players match"}
          </p>
        )}
      </Card>

      {/* Mobile: per-user cards */}
      <div className="md:hidden flex flex-col gap-3">
        {filtered.length === 0 ? (
          <Card className="p-8 text-center text-on-surface-variant text-sm">
            {isHebrew ? "לא נמצאו משתתפים" : "No players match"}
          </Card>
        ) : (
          filtered.map((user) => (
            <MobileUserCard
              key={user.id}
              user={user}
              bets={bets}
              betsByScope={betsByScope}
              picks={picks}
              filled={filledByUser.get(user.id) ?? 0}
              locale={locale}
              onOpen={() => setOpenUserId(user.id)}
            />
          ))
        )}
      </div>

      {openUser && (
        <UserBetsDrawer
          key={openUser.id}
          userId={openUser.id}
          userName={openUser.name}
          locale={locale}
          onClose={() => setOpenUserId(null)}
        />
      )}
    </div>
  );
}

function PickCell({
  label,
  isHebrew,
}: {
  label: string | null;
  isHebrew: boolean;
}) {
  if (label == null) {
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
      <span className="truncate max-w-[120px]">{label}</span>
    </span>
  );
}

function MobileUserCard({
  user,
  bets,
  betsByScope,
  picks,
  filled,
  locale,
  onOpen,
}: {
  user: OverviewUser;
  bets: OverviewBet[];
  betsByScope: Map<Scope, OverviewBet[]>;
  picks: Record<string, string>;
  filled: number;
  locale: Locale;
  onOpen: () => void;
}) {
  const isHebrew = locale === "he";
  const summary: Array<{ scope: Scope; filled: number; total: number }> = [];
  for (const scope of SCOPE_ORDER) {
    const bs = betsByScope.get(scope) ?? [];
    if (bs.length === 0) continue;
    let f = 0;
    for (const b of bs) if (picks[`${user.id}|${b.betId}`] != null) f++;
    summary.push({ scope, filled: f, total: bs.length });
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      className="text-start w-full"
      aria-label={isHebrew ? `פתח את ${user.name}` : `Open ${user.name}`}
    >
      <Card className="p-4 flex flex-col gap-3 active:bg-surface-container transition-colors">
        <header className="flex items-center justify-between gap-3">
          <span className="text-base font-bold text-primary">{user.name}</span>
          <span className="text-xs font-bold text-on-surface-variant tabular-nums shrink-0">
            <bdi>
              {filled}/{bets.length}
            </bdi>
          </span>
        </header>
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
      </Card>
    </button>
  );
}

// In-memory cache of loaded per-user detail, keyed by userId. Survives drawer
// open/close within the session so re-opening a user is instant. Invalidated
// for a user after an inline edit so the read view reflects the change.
const detailCache = new Map<string, UserBetDetail>();

function UserBetsDrawer({
  userId,
  userName,
  locale,
  onClose,
}: {
  userId: string;
  userName: string;
  locale: Locale;
  onClose: () => void;
}) {
  const isHebrew = locale === "he";
  const router = useRouter();
  const [detail, setDetail] = useState<UserBetDetail | null>(
    () => detailCache.get(userId) ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const load = useCallback(() => {
    setError(null);
    startTransition(async () => {
      const res = await loadUserBetDetail(userId, locale);
      if (!res.ok) {
        setError(
          isHebrew ? "טעינת ההימורים נכשלה" : "Failed to load this user's bets",
        );
        return;
      }
      detailCache.set(userId, res.detail);
      setDetail(res.detail);
    });
  }, [userId, locale, isHebrew]);

  // Load on mount unless the module cache already has this user (the lazy
  // useState initializer above seeded `detail` from it). The drawer is keyed
  // by userId in the parent, so this runs once per opened user. This is the
  // "fetch from an external system on mount" effect the React docs permit; the
  // lint rule flags the setState that load() performs, hence the scoped
  // disable — same pattern as usePickerOptions.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!detailCache.has(userId)) load();
  }, [userId, load]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Close on Escape.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // After an inline edit: drop the stale cache entry, refetch the drawer, and
  // refresh the server tree so the matrix behind reflects it too.
  const onSaved = useCallback(() => {
    detailCache.delete(userId);
    load();
    router.refresh();
  }, [userId, load, router]);

  return (
    <div
      className="fixed inset-0 z-50 flex"
      role="dialog"
      aria-modal="true"
      aria-label={isHebrew ? `הימורי ${userName}` : `${userName}'s bets`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="absolute inset-0 bg-on-surface/40 backdrop-blur-[2px]" />
      <div className="relative ms-auto bg-surface w-full max-w-md h-full max-h-[100dvh] overflow-y-auto shadow-2xl flex flex-col md:rounded-s-2xl pb-[env(safe-area-inset-bottom)]">
        <header className="sticky top-0 bg-surface border-b border-outline-variant px-5 py-4 flex items-center justify-between gap-3 z-10">
          <div className="min-w-0 flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-full bg-primary text-on-primary flex items-center justify-center text-lg font-bold shrink-0"
              aria-hidden
            >
              {userName.charAt(0) || "?"}
            </div>
            <div className="min-w-0">
              <h2 className="font-[family-name:var(--font-display)] text-lg font-bold truncate">
                {userName}
              </h2>
              <p className="text-xs text-on-surface-variant">
                {isHebrew ? "כל ההימורים" : "All bets"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={isHebrew ? "סגור" : "Close"}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full hover:bg-surface-container shrink-0"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="p-5 flex flex-col gap-6">
          {error ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <AlertCircle className="h-6 w-6 text-error" />
              <p className="text-sm text-on-surface-variant">{error}</p>
              <button
                type="button"
                onClick={load}
                className="min-h-[44px] px-5 rounded-full bg-primary text-on-primary text-sm font-bold"
              >
                {isHebrew ? "נסה שוב" : "Retry"}
              </button>
            </div>
          ) : detail == null ? (
            <DrawerSkeleton />
          ) : (
            <DrawerBody
              detail={detail}
              userId={userId}
              userName={userName}
              locale={locale}
              onSaved={onSaved}
              refreshing={pending}
            />
          )}
        </div>

        <div className="mt-auto sticky bottom-0 bg-surface border-t border-outline-variant px-5 py-3">
          <Link
            href={localePath(locale, `admin/users/${userId}/bets`)}
            className="flex items-center justify-center gap-2 min-h-[48px] rounded-full bg-surface-container-lowest border border-outline-variant text-sm font-bold text-on-surface hover:bg-surface-container"
          >
            <ListChecks className="h-4 w-4" strokeWidth={1.75} />
            {isHebrew ? "פתח עריכה מלאה" : "Open full editor"}
          </Link>
        </div>
      </div>
    </div>
  );
}

function DrawerSkeleton() {
  return (
    <div className="flex flex-col gap-4 animate-pulse" aria-hidden>
      <div className="h-16 rounded-lg bg-surface-container-low" />
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="h-14 rounded-lg bg-surface-container-low" />
      ))}
    </div>
  );
}

function DrawerBody({
  detail,
  userId,
  userName,
  locale,
  onSaved,
  refreshing,
}: {
  detail: UserBetDetail;
  userId: string;
  userName: string;
  locale: Locale;
  onSaved: () => void;
  refreshing: boolean;
}) {
  const isHebrew = locale === "he";
  const { customBets, matchPicks } = detail;

  const filledCustom = customBets.filter((r) => r.pickId != null).length;
  const filledMatch = matchPicks.filter((r) => r.pickId != null).length;

  // Group the custom bets by scope, preserving the query's scope-first order.
  const byScope = useMemo(() => {
    const map = new Map<Scope, DrawerCustomBet[]>();
    for (const s of SCOPE_ORDER) map.set(s, []);
    for (const r of customBets) map.get(r.scope as Scope)?.push(r);
    return map;
  }, [customBets]);

  return (
    <div className={clsx("flex flex-col gap-6", refreshing && "opacity-60")}>
      {/* Fill summary */}
      <div className="grid grid-cols-2 gap-3">
        <SummaryCell
          label={isHebrew ? "הימורי משחק" : "Match picks"}
          filled={filledMatch}
          total={matchPicks.length}
        />
        <SummaryCell
          label={isHebrew ? "הימורים מיוחדים" : "Special bets"}
          filled={filledCustom}
          total={customBets.length}
        />
      </div>

      {/* Custom bets per scope */}
      {SCOPE_ORDER.map((scope) => {
        const rows = byScope.get(scope) ?? [];
        if (rows.length === 0) return null;
        return (
          <section key={scope} className="flex flex-col gap-2">
            <SectionHeading as="h3" underline="thin">
              <span className="inline-flex items-center gap-2 text-sm">
                {SCOPE_ICON[scope]}
                {isHebrew ? SCOPE_LABEL_HE[scope] : SCOPE_LABEL_EN[scope]}
                <span className="text-xs font-normal text-on-surface-variant tabular-nums">
                  ({rows.filter((r) => r.pickId != null).length}/{rows.length})
                </span>
              </span>
            </SectionHeading>
            {rows.map((r) => (
              <DrawerCustomRow
                key={r.betId}
                row={r}
                userId={userId}
                userName={userName}
                locale={locale}
                onSaved={onSaved}
              />
            ))}
          </section>
        );
      })}

      {/* Match scorelines */}
      {matchPicks.length > 0 && (
        <section className="flex flex-col gap-2">
          <SectionHeading as="h3" underline="thin">
            <span className="inline-flex items-center gap-2 text-sm">
              <ListChecks className="h-4 w-4" strokeWidth={1.75} />
              {isHebrew ? "ניחושי תוצאות" : "Score picks"}
              <span className="text-xs font-normal text-on-surface-variant tabular-nums">
                ({filledMatch}/{matchPicks.length})
              </span>
            </span>
          </SectionHeading>
          <Card className="p-2 flex flex-col">
            {matchPicks.map((r) => (
              <DrawerMatchRow
                key={r.matchId}
                row={r}
                userId={userId}
                userName={userName}
                locale={locale}
                onSaved={onSaved}
              />
            ))}
          </Card>
        </section>
      )}
    </div>
  );
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
    <div className="bg-surface-container-low border border-outline-variant rounded-lg p-3 flex flex-col gap-1">
      <LabelCaps>{label}</LabelCaps>
      <span
        className={`font-[family-name:var(--font-score)] text-2xl font-bold tabular-nums ${tone}`}
      >
        <bdi>
          {filled}
          <span className="opacity-50"> / {total}</span>
        </bdi>
      </span>
    </div>
  );
}

function DrawerCustomRow({
  row,
  userId,
  userName,
  locale,
  onSaved,
}: {
  row: DrawerCustomBet;
  userId: string;
  userName: string;
  locale: Locale;
  onSaved: () => void;
}) {
  const isHebrew = locale === "he";
  const hasPick = row.pickId != null;
  return (
    <div className="rounded-lg border border-outline-variant bg-surface-container-low p-3 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-bold text-on-surface leading-snug min-w-0 flex-1">
          {isHebrew ? row.questionHe : row.questionEn}
        </p>
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
          targetUserId={userId}
          targetUserName={userName}
          locale={locale}
          lockAt={row.lockAt}
          onSaved={onSaved}
        />
      </div>
      <div
        className={`flex items-center gap-2 text-sm rounded p-2 ${
          hasPick
            ? "bg-surface border border-outline-variant"
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
          className={`flex-1 min-w-0 ${
            hasPick ? "text-on-surface font-medium" : "text-on-surface-variant italic"
          }`}
        >
          {hasPick ? row.pickLabel : isHebrew ? "לא ניחש" : "Not picked"}
        </span>
        {row.pickPointsEarned != null && (
          <span
            className={`text-xs tabular-nums font-bold shrink-0 ${
              row.pickWasCorrect ? "text-secondary" : "text-error"
            }`}
          >
            {row.pickWasCorrect ? "+" : ""}
            {row.pickPointsEarned}
          </span>
        )}
      </div>
    </div>
  );
}

function DrawerMatchRow({
  row,
  userId,
  userName,
  locale,
  onSaved,
}: {
  row: MatchPick;
  userId: string;
  userName: string;
  locale: Locale;
  onSaved: () => void;
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
    <div className="flex items-center gap-2 py-2 px-1 border-b border-outline-variant last:border-b-0">
      <span className="text-[11px] text-on-surface-variant tabular-nums shrink-0 w-16">
        {kickoff}
      </span>
      <span className="text-sm flex-1 min-w-0 truncate">
        <MatchupLabel home={home} away={away} locale={locale} />
      </span>
      {hasPick ? (
        <span className="text-sm font-bold tabular-nums shrink-0 inline-flex items-center gap-1">
          <Check className="h-3.5 w-3.5 text-secondary" strokeWidth={2.5} />
          {/* ScoreLine so the home digit sits on the home side in RTL —
              same fix as /transparency, /live and the per-user admin bets
              list. A bdi-isolated "H–A" run rendered LTR and flipped the
              score relative to the team names. */}
          <ScoreLine home={row.pickHomeScore!} away={row.pickAwayScore!} separator="–" />
        </span>
      ) : (
        <span className="text-xs text-on-surface-variant italic shrink-0">—</span>
      )}
      {row.pickPointsEarned != null && (
        <span
          className={`text-[11px] font-bold tabular-nums shrink-0 w-8 text-end ${
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
          targetUserId={userId}
          targetUserName={userName}
          locale={locale}
          lockAt={row.kickoffAt}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}
