"use client";

import { useMemo, useState } from "react";
import {
  Sparkles,
  Trophy,
  CalendarDays,
  Layers,
  ListChecks,
  Check,
  X,
  Lock,
  CircleHelp,
  Search,
  FilterX,
  Swords,
} from "lucide-react";
import type { Locale } from "../../dictionaries";
import type {
  AdminUserAdvancePickRow,
  AdminUserBetRow,
  AdminUserMatchPickRow,
} from "../users/queries";
import { Card, Chip, SectionHeading, MatchupLabel, ScoreLine } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { renderPickAnswer, type PlayerNameMap } from "@/lib/bets/format";
import type { PickAnswer } from "@/lib/bets/types";
import { MyBetsEditor } from "./MyBetsEditor";

// Client-side filter + render shell for the self-backdate page. Holds every
// bet (score + custom) and narrows the list by type / matchday / match /
// status / text / unfilled — so the admin can jump straight to the bet that
// needs fixing instead of scrolling the whole tournament. Filtering is purely
// in-memory (a few hundred rows at most), so it's instant with no round-trips.

type TypeFilter =
  | "all"
  | "score"
  | "advance"
  | "match"
  | "day"
  | "group"
  | "stage"
  | "tournament";
type StatusFilter = "all" | "open" | "locked" | "settled";

const SCOPE_OF_TYPE: Record<
  Exclude<TypeFilter, "all" | "score" | "advance">,
  AdminUserBetRow["scope"]
> = {
  match: "match",
  day: "day",
  group: "group",
  stage: "stage",
  tournament: "tournament",
};

// YYYY-MM-DD in Asia/Jerusalem — the canonical matchday key the rest of the
// app groups by. Pure + deterministic (fixed timeZone).
function dayKeyFromTs(ts: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ts));
}

function scoreStatusBucket(matchStatus: string): StatusFilter {
  if (matchStatus === "scheduled") return "open";
  if (matchStatus === "live") return "locked";
  return "settled";
}

function customStatusBucket(status: AdminUserBetRow["status"]): StatusFilter {
  if (status === "open") return "open";
  if (status === "locked") return "locked";
  return "settled";
}

function customDayKey(row: AdminUserBetRow): string | null {
  if (row.matchdayDate) return row.matchdayDate;
  if (row.kickoffAt) return dayKeyFromTs(row.kickoffAt);
  return null;
}

export function MyBetsBrowser({
  locale,
  targetUserId,
  targetName,
  matchRows,
  customRows,
  advanceRows,
  playerNames,
  stakeBounds,
}: {
  locale: Locale;
  targetUserId: string;
  targetName: string;
  matchRows: AdminUserMatchPickRow[];
  customRows: AdminUserBetRow[];
  advanceRows: AdminUserAdvancePickRow[];
  playerNames: PlayerNameMap;
  stakeBounds: { minStake: number; maxStake: number };
}) {
  const isHebrew = locale === "he";
  const [search, setSearch] = useState("");
  const [type, setType] = useState<TypeFilter>("all");
  const [matchday, setMatchday] = useState<string>("all");
  const [matchId, setMatchId] = useState<string>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [onlyUnfilled, setOnlyUnfilled] = useState(false);

  // Matchday dropdown options: every distinct day across score picks + custom
  // bets that carry a day, sorted ascending.
  const matchdayOptions = useMemo(() => {
    const keys = new Set<string>();
    for (const m of matchRows) keys.add(dayKeyFromTs(m.kickoffAt));
    for (const c of customRows) {
      const k = customDayKey(c);
      if (k) keys.add(k);
    }
    return Array.from(keys).sort();
  }, [matchRows, customRows]);

  // Match dropdown options: every match, labelled with the matchup.
  const matchOptions = useMemo(
    () =>
      matchRows.map((m) => ({
        id: m.matchId,
        label: isHebrew
          ? `${m.homeNameHe} – ${m.awayNameHe}`
          : `${m.homeNameEn} – ${m.awayNameEn}`,
      })),
    [matchRows, isHebrew],
  );

  const q = search.trim().toLowerCase();
  const anyFilter =
    q !== "" ||
    type !== "all" ||
    matchday !== "all" ||
    matchId !== "all" ||
    status !== "all" ||
    onlyUnfilled;

  const filteredMatchRows = useMemo(() => {
    if (type !== "all" && type !== "score") return [];
    return matchRows.filter((m) => {
      if (matchday !== "all" && dayKeyFromTs(m.kickoffAt) !== matchday) return false;
      if (matchId !== "all" && m.matchId !== matchId) return false;
      if (status !== "all" && scoreStatusBucket(m.matchStatus) !== status) return false;
      if (onlyUnfilled && m.pickId != null) return false;
      if (q) {
        const hay = `${m.homeNameHe} ${m.awayNameHe} ${m.homeNameEn} ${m.awayNameEn}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [matchRows, type, matchday, matchId, status, onlyUnfilled, q]);

  const filteredCustomRows = useMemo(() => {
    if (type === "score" || type === "advance") return [];
    return customRows.filter((c) => {
      if (type !== "all" && c.scope !== SCOPE_OF_TYPE[type]) return false;
      if (matchday !== "all" && customDayKey(c) !== matchday) return false;
      if (matchId !== "all" && c.matchId !== matchId) return false;
      if (status !== "all" && customStatusBucket(c.status) !== status) return false;
      if (onlyUnfilled && c.pickId != null) return false;
      if (q) {
        const hay = `${c.questionHe} ${c.questionEn} ${c.homeNameHe ?? ""} ${c.awayNameHe ?? ""} ${c.homeNameEn ?? ""} ${c.awayNameEn ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [customRows, type, matchday, matchId, status, onlyUnfilled, q]);

  // "Who advances?" rows share the score surface's status buckets (they lock on
  // the same 1/X/2 deadline and settle when the knockout is final).
  const filteredAdvanceRows = useMemo(() => {
    if (type !== "all" && type !== "advance") return [];
    return advanceRows.filter((a) => {
      if (matchday !== "all" && dayKeyFromTs(a.kickoffAt) !== matchday) return false;
      if (matchId !== "all" && a.matchId !== matchId) return false;
      if (status !== "all" && scoreStatusBucket(a.matchStatus) !== status) return false;
      if (onlyUnfilled && a.pickId != null) return false;
      if (q) {
        const hay = `${a.homeNameHe} ${a.awayNameHe} ${a.homeNameEn} ${a.awayNameEn}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [advanceRows, type, matchday, matchId, status, onlyUnfilled, q]);

  const buckets = groupByScope(filteredCustomRows);
  const totalShown =
    filteredMatchRows.length +
    filteredAdvanceRows.length +
    filteredCustomRows.length;

  function clearFilters() {
    setSearch("");
    setType("all");
    setMatchday("all");
    setMatchId("all");
    setStatus("all");
    setOnlyUnfilled(false);
  }

  // Keep the native select chevron (no appearance-none) so it's obviously
  // tappable and opens the OS picker on mobile.
  const selectClass =
    "min-h-12 w-full px-3 rounded-lg border border-outline-variant bg-surface text-base text-on-surface focus:outline-none focus:border-primary";

  return (
    <div className="flex flex-col gap-6">
      {/* Filter bar */}
      <Card className="p-4 md:p-5 flex flex-col gap-3">
        <div className="relative">
          <Search
            className="absolute top-1/2 -translate-y-1/2 start-3 h-4 w-4 text-on-surface-variant pointer-events-none"
            strokeWidth={2}
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={
              isHebrew ? "חיפוש לפי שאלה או נבחרת…" : "Search question or team…"
            }
            className="min-h-12 w-full ps-9 pe-3 rounded-lg border border-outline-variant bg-surface text-base text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:border-primary"
            dir={isHebrew ? "rtl" : "ltr"}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FilterField label={isHebrew ? "סוג הימור" : "Bet type"}>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as TypeFilter)}
              className={selectClass}
              dir={isHebrew ? "rtl" : "ltr"}
            >
              <option value="all">{isHebrew ? "הכל" : "All"}</option>
              <option value="score">{isHebrew ? "תוצאה (1/X/2)" : "Score (1/X/2)"}</option>
              <option value="advance">{isHebrew ? "מי עולה" : "Who advances"}</option>
              <option value="match">{isHebrew ? "לייב" : "Live"}</option>
              <option value="day">{isHebrew ? "יום" : "Day"}</option>
              <option value="group">{isHebrew ? "בית" : "Group"}</option>
              <option value="stage">{isHebrew ? "שלב" : "Stage"}</option>
              <option value="tournament">{isHebrew ? "טורניר" : "Tournament"}</option>
            </select>
          </FilterField>

          <FilterField label={isHebrew ? "יום משחקים" : "Matchday"}>
            <select
              value={matchday}
              onChange={(e) => setMatchday(e.target.value)}
              className={selectClass}
              dir={isHebrew ? "rtl" : "ltr"}
            >
              <option value="all">{isHebrew ? "כל הימים" : "All days"}</option>
              {matchdayOptions.map((key) => (
                <option key={key} value={key}>
                  {formatDayLabel(key, locale)}
                </option>
              ))}
            </select>
          </FilterField>

          <FilterField label={isHebrew ? "משחק" : "Match"}>
            <select
              value={matchId}
              onChange={(e) => setMatchId(e.target.value)}
              className={selectClass}
              dir={isHebrew ? "rtl" : "ltr"}
            >
              <option value="all">{isHebrew ? "כל המשחקים" : "All matches"}</option>
              {matchOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </FilterField>

          <FilterField label={isHebrew ? "סטטוס" : "Status"}>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusFilter)}
              className={selectClass}
              dir={isHebrew ? "rtl" : "ltr"}
            >
              <option value="all">{isHebrew ? "הכל" : "All"}</option>
              <option value="open">{isHebrew ? "פתוח" : "Open"}</option>
              <option value="locked">{isHebrew ? "נעול / חי" : "Locked / live"}</option>
              <option value="settled">{isHebrew ? "נגמר" : "Settled"}</option>
            </select>
          </FilterField>
        </div>

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <label className="inline-flex items-center gap-2 cursor-pointer min-h-11">
            <input
              type="checkbox"
              checked={onlyUnfilled}
              onChange={(e) => setOnlyUnfilled(e.target.checked)}
              className="h-5 w-5 accent-primary"
            />
            <span className="text-sm text-on-surface">
              {isHebrew ? "רק מה שלא מילאתי" : "Only unfilled"}
            </span>
          </label>
          <div className="flex items-center gap-3">
            <span className="text-xs text-on-surface-variant tabular-nums">
              {isHebrew ? `${totalShown} תוצאות` : `${totalShown} results`}
            </span>
            {anyFilter && (
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex items-center gap-1.5 px-3 min-h-11 rounded-full border border-outline-variant text-sm font-bold text-on-surface hover:bg-surface-container-low transition-colors"
              >
                <FilterX className="h-4 w-4" strokeWidth={2} />
                {isHebrew ? "נקה" : "Clear"}
              </button>
            )}
          </div>
        </div>
      </Card>

      {/* Results */}
      {totalShown === 0 ? (
        <Card className="p-6 text-center text-on-surface-variant">
          {anyFilter
            ? isHebrew
              ? "אין הימורים שתואמים את הסינון."
              : "No bets match the filter."
            : isHebrew
              ? "אין הימורים במערכת."
              : "No bets in the system."}
        </Card>
      ) : (
        <>
          {filteredMatchRows.length > 0 && (
            <MatchPicksSection
              rows={filteredMatchRows}
              locale={locale}
              targetUserId={targetUserId}
              targetName={targetName}
            />
          )}
          {filteredAdvanceRows.length > 0 && (
            <AdvancePicksSection
              rows={filteredAdvanceRows}
              locale={locale}
              targetUserId={targetUserId}
              targetName={targetName}
            />
          )}
          {buckets.match.length > 0 && (
            <ScopeSection
              icon={<Sparkles className="h-5 w-5" strokeWidth={1.75} />}
              title={isHebrew ? "הימורי לייב" : "Live bets"}
              rows={buckets.match}
              locale={locale}
              targetUserId={targetUserId}
              targetName={targetName}
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
              targetUserId={targetUserId}
              targetName={targetName}
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
              targetUserId={targetUserId}
              targetName={targetName}
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
              targetUserId={targetUserId}
              targetName={targetName}
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
              targetUserId={targetUserId}
              targetName={targetName}
              playerNames={playerNames}
              stakeBounds={stakeBounds}
            />
          )}
        </>
      )}
    </div>
  );
}

function FilterField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-[family-name:var(--font-label)] text-[11px] font-bold uppercase tracking-[0.05em] text-on-surface-variant">
        {label}
      </span>
      {children}
    </label>
  );
}

function formatDayLabel(key: string, locale: Locale): string {
  // key is YYYY-MM-DD. Build a noon-UTC date so the displayed day can't slip
  // across a timezone boundary, then format day + month.
  const d = new Date(`${key}T12:00:00Z`);
  return formatDateTime(d.toISOString(), locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
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
  targetUserId,
  targetName,
  playerNames,
  stakeBounds,
}: {
  icon: React.ReactNode;
  title: string;
  rows: AdminUserBetRow[];
  locale: Locale;
  targetUserId: string;
  targetName: string;
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
            targetUserId={targetUserId}
            targetName={targetName}
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
  targetUserId,
  targetName,
  playerNames,
  stakeBounds,
}: {
  row: AdminUserBetRow;
  locale: Locale;
  targetUserId: string;
  targetName: string;
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
            targetUserId={targetUserId}
            targetUserName={targetName}
            locale={locale}
            lockAt={row.lockAt}
            triggerLabel={
              hasPick ? (isHebrew ? "תקן" : "Fix") : isHebrew ? "הוסף" : "Add"
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
  targetName,
}: {
  rows: AdminUserMatchPickRow[];
  locale: Locale;
  targetUserId: string;
  targetName: string;
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
            targetName={targetName}
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
  targetName,
}: {
  row: AdminUserMatchPickRow;
  locale: Locale;
  targetUserId: string;
  targetName: string;
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
        targetUserId={targetUserId}
        targetUserName={targetName}
        locale={locale}
        lockAt={row.kickoffAt}
        triggerLabel={
          hasPick ? (isHebrew ? "תקן" : "Fix") : isHebrew ? "הוסף" : "Add"
        }
      />
    </div>
  );
}

function AdvancePicksSection({
  rows,
  locale,
  targetUserId,
  targetName,
}: {
  rows: AdminUserAdvancePickRow[];
  locale: Locale;
  targetUserId: string;
  targetName: string;
}) {
  const isHebrew = locale === "he";
  const filled = rows.filter((r) => r.pickId != null).length;
  return (
    <section className="flex flex-col gap-3">
      <SectionHeading as="h2" underline="thin">
        <span className="inline-flex items-center gap-2">
          <Swords className="h-5 w-5" strokeWidth={1.75} />
          {isHebrew ? "מי עולה?" : "Who advances?"}
          <span className="text-xs font-normal text-on-surface-variant tabular-nums">
            ({filled} / {rows.length})
          </span>
        </span>
      </SectionHeading>
      <Card className="p-3 md:p-4 flex flex-col gap-1">
        {rows.map((r) => (
          <AdvancePickRow
            key={r.matchId}
            row={r}
            locale={locale}
            targetUserId={targetUserId}
            targetName={targetName}
          />
        ))}
      </Card>
    </section>
  );
}

function AdvancePickRow({
  row,
  locale,
  targetUserId,
  targetName,
}: {
  row: AdminUserAdvancePickRow;
  locale: Locale;
  targetUserId: string;
  targetName: string;
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
  const started = row.matchStatus !== "scheduled";
  // Map a team code to the display name of one of the two fixture teams.
  const nameOf = (code: string | null): string | null => {
    if (code == null) return null;
    if (code === row.homeCode) return home;
    if (code === row.awayCode) return away;
    return code;
  };
  const pickName = nameOf(row.pickTeam);
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
        <span className="text-sm font-bold shrink-0 inline-flex items-center gap-1 max-w-[7rem] md:max-w-[10rem]">
          <Check className="h-3.5 w-3.5 text-secondary shrink-0" strokeWidth={2.5} />
          <span className="truncate">{pickName}</span>
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
        surface="advance"
        matchId={row.matchId}
        matchupHe={matchupHe}
        matchupEn={matchupEn}
        homeCode={row.homeCode}
        awayCode={row.awayCode}
        homeTeamHe={row.homeNameHe}
        homeTeamEn={row.homeNameEn}
        awayTeamHe={row.awayNameHe}
        awayTeamEn={row.awayNameEn}
        currentTeam={row.pickTeam}
        targetUserId={targetUserId}
        targetUserName={targetName}
        locale={locale}
        lockAt={row.kickoffAt}
        triggerLabel={
          hasPick ? (isHebrew ? "תקן" : "Fix") : isHebrew ? "הוסף" : "Add"
        }
      />
    </div>
  );
}
