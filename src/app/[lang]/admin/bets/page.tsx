import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus, ChevronLeft, ChevronRight, Copy, RefreshCw, Zap, Swords } from "lucide-react";
import { hasLocale, type Locale } from "../../dictionaries";
import { Card, Chip, LabelCaps, PillButton, SectionHeading } from "@/components/ui";
import { localePath } from "@/lib/paths";
import { formatDateTime } from "@/lib/format";
import { isFreePickScope } from "@/lib/bets/free-pick-scopes";
import { formatLiveRatio, liveDisplayRatios } from "@/lib/bets/price-options";
import type { AnswerConfig } from "@/lib/bets/types";
import {
  BET_TYPES,
  betTypeLabel,
  duelScopeLabel,
  duelStatusLabel,
  duelStatusTone,
  parseBetType,
  scopeBelongsToType,
  scopesForBetType,
  type BetType,
  type CustomBetScope,
  type DuelScope,
  type DuelStatus,
} from "@/lib/bets/admin-bet-types";
import {
  countDuplicateCustomBets,
  listCustomBetMatches,
  listCustomBetMatchdays,
  listCustomBets,
  listDuelsForAdmin,
  listOpenLiveBetsForPush,
  type AdminBetMatchOption,
  type AdminBetMatchdayOption,
  type AdminCustomBetRow,
  type AdminDuelRow,
} from "@/db/admin-queries";
import { liveBetAnchor } from "@/lib/bets/live-bet-push";
import { parseDayFilter } from "@/lib/bets/admin-bet-filters";
import { canEditPublishedOdds } from "@/lib/bets/edit-odds";
import { BetsTableActions } from "./BetsTableActions";
import { BetsSearchBox } from "./BetsSearchBox";
import { BetsActiveFilters } from "./BetsActiveFilters";
import { BetsFilterMemory } from "./BetsFilterMemory";
import { DuelAdminActions } from "./DuelAdminActions";
import { LiveBetPushComposer, type LiveBetPushItem } from "./LiveBetPushComposer";

export default async function AdminBetsPage({
  params,
  searchParams,
}: PageProps<"/[lang]/admin/bets">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const isHebrew = locale === "he";
  const Chev = isHebrew ? ChevronLeft : ChevronRight;
  const sp = await searchParams;

  // The primary facet. Defaults to "live" so the page opens on the
  // surface it has always managed; the other types are one tap away.
  const betType = parseBetType(sp.type) ?? "live";
  const queryFilter = parseQueryFilter(sp.q);

  // Each bet type owns its own status / scope vocabulary, so we parse
  // the shared ?status= / ?scope= params against the right enum and run
  // the matching query. Duels live in their own table; live + tournament
  // are two scope families of custom_bets.
  let bets: AdminCustomBetRow[] = [];
  let duels: AdminDuelRow[] = [];
  let betMatches: AdminBetMatchOption[] = [];
  let matchdays: AdminBetMatchdayOption[] = [];
  let customStatus: AdminCustomBetRow["status"] | null = null;
  let customScope: CustomBetScope | null = null;
  let duelStatus: DuelStatus | null = null;
  let duelScope: DuelScope | null = null;
  let matchFilter: string | null = null;
  let dayFilter: string | null = null;
  // Open live bets a manager can announce via push (live view only).
  let pushItems: LiveBetPushItem[] = [];

  if (betType === "duel") {
    duelStatus = parseDuelStatus(sp.status);
    duelScope = parseDuelScope(sp.scope);
    duels = await listDuelsForAdmin({
      status: duelStatus,
      scope: duelScope,
      q: queryFilter,
      limit: 200,
    });
  } else {
    customStatus = parseStatusFilter(sp.status);
    // Drop a scope sub-filter that doesn't belong to the selected family
    // (e.g. scope=group while type=live) so the list never comes back
    // empty after a type switch.
    const rawScope = parseScopeFilter(sp.scope);
    customScope =
      rawScope && scopeBelongsToType(betType, rawScope) ? rawScope : null;
    // The match picker only makes sense for the live family (match-scoped
    // bets). Tournament-scoped bets have no fixture, so we neither fetch
    // the picker options nor honour a hand-edited ?match= there.
    const useMatchFilter = betType === "live";
    matchFilter = useMatchFilter ? parseMatchFilter(sp.match) : null;
    // Matchday (calendar-date) sub-filter rides the live family only, the
    // same surface that owns match-scoped questions. The date captures the
    // whole day — the day-bet plus every match-bet of that date.
    dayFilter = useMatchFilter ? parseDayFilter(sp.day) : null;
    const [betRows, betMatchRows, matchdayRows] = await Promise.all([
      listCustomBets({
        status: customStatus,
        scope: customScope,
        scopeIn: scopesForBetType(betType),
        q: queryFilter,
        matchId: matchFilter,
        matchdayDate: dayFilter,
        limit: 200,
      }),
      useMatchFilter ? listCustomBetMatches() : Promise.resolve([]),
      useMatchFilter ? listCustomBetMatchdays() : Promise.resolve([]),
    ]);
    bets = betRows;
    betMatches = betMatchRows;
    matchdays = matchdayRows;

    // The push composer announces match/day bets, so it only belongs on
    // the live view. Resolve each open live bet to its display anchor via
    // the same helper the server action uses, so the preview matches the
    // sent push exactly.
    if (betType === "live") {
      const openLive = await listOpenLiveBetsForPush(200);
      pushItems = openLive.map((b) => {
        const anchor = liveBetAnchor(
          {
            scope: b.scope,
            matchId: b.matchId,
            homeName: isHebrew ? b.homeNameHe : b.homeNameEn,
            awayName: isHebrew ? b.awayNameHe : b.awayNameEn,
            matchdayDate: b.matchdayDate,
          },
          locale,
        );
        return {
          id: b.id,
          question: isHebrew ? b.questionHe : b.questionEn,
          anchorKey: anchor.key,
          anchorLabel: anchor.label,
        };
      });
    }
  }

  const duplicateCount = await countDuplicateCustomBets();

  // [admin bets] one diagnostic line per render so a "nothing shows up"
  // report can be traced to the resolved filter set + row count.
  console.info("[admin bets] list", {
    betType,
    status: betType === "duel" ? duelStatus : customStatus,
    scope: betType === "duel" ? duelScope : customScope,
    q: queryFilter,
    match: matchFilter,
    day: dayFilter,
    rows: betType === "duel" ? duels.length : bets.length,
  });

  // Active narrowing filters, resolved to human labels + a "remove this
  // one" href on the server so the summary bar stays a dumb client island.
  const activeFilters = buildActiveFilters({
    isHebrew,
    locale,
    betType,
    customStatus,
    customScope,
    duelStatus,
    duelScope,
    queryFilter,
    matchFilter,
    dayFilter,
    betMatches,
  });
  // "Clear all" drops every narrowing filter but keeps the current bet
  // type — clearing filters shouldn't yank the admin off the duel /
  // tournament view back to live.
  const clearFiltersHref = buildBetsHref({
    betType,
    status: null,
    scope: null,
    q: null,
    match: null,
    day: null,
  });

  const isEmpty = betType === "duel" ? duels.length === 0 : bets.length === 0;

  return (
    <section className="px-4 md:px-16 py-6 md:py-12 flex flex-col gap-6 md:gap-8 max-w-5xl mx-auto w-full pb-24">
      <header className="flex flex-col gap-3">
        <Link
          href={localePath(locale, "admin")}
          className="inline-flex items-center gap-1 text-sm text-on-surface-variant hover:text-on-surface w-fit"
        >
          <Chev className="h-4 w-4" strokeWidth={2} />
          {isHebrew ? "חזרה לדף הניהול" : "Back to admin"}
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-9 md:text-[40px] md:leading-[44px] font-bold text-primary">
              {isHebrew ? "ניהול הימורים" : "Bets management"}
            </h1>
            <p className="text-sm text-on-surface-variant">
              {isHebrew
                ? "סנן לפי סוג הימור — לייב, טורניר או דו-קרב — ונהל הכל מכאן: פרסום, סגירה, ניקוד, הכרעת דו-קרב וביטול."
                : "Filter by bet type — live, tournament or duel — and manage it all here: publish, lock, grade, settle duels and cancel."}
            </p>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
            <Link
              href={localePath(locale, "admin/system")}
              title={
                isHebrew
                  ? "פותח את עמוד הסנכרון. הכפתור שם מושך תוצאות חדשות ומנקד את הימורי הבתים בלי לחכות ל-cron."
                  : "Opens the sync page. The button there pulls fresh results and grades group bets without waiting for cron."
              }
            >
              <PillButton
                type="button"
                variant="ghost"
                className="min-h-[48px] inline-flex items-center gap-1.5"
              >
                <RefreshCw className="h-4 w-4" strokeWidth={2} />
                {isHebrew ? "סנכרון ידני" : "Sync now"}
              </PillButton>
            </Link>
            <Link href={localePath(locale, "admin/live-bets/suggestions")}>
              <PillButton
                type="button"
                variant="ghost"
                className="min-h-[48px]"
              >
                {isHebrew ? "הצעות יום משחקים" : "Matchday"}
              </PillButton>
            </Link>
            <Link href={localePath(locale, "admin/tournament-suggestions")}>
              <PillButton
                type="button"
                variant="ghost"
                className="min-h-[48px]"
              >
                {isHebrew ? "הימורי טורניר" : "Tournament bets"}
              </PillButton>
            </Link>
            <Link href={localePath(locale, "admin/bets/quick-add")}>
              <PillButton
                type="button"
                variant="ghost"
                className="min-h-[48px] inline-flex items-center gap-1.5"
              >
                <Zap className="h-4 w-4" strokeWidth={2} />
                {isHebrew ? "הוספה מהירה" : "Quick add"}
              </PillButton>
            </Link>
            <Link href={localePath(locale, "admin/bets/new")}>
              <PillButton type="button" className="min-h-[48px]">
                <Plus className="h-5 w-5" strokeWidth={2.5} />
                {isHebrew ? "הימור חדש" : "New bet"}
              </PillButton>
            </Link>
          </div>
        </div>
      </header>

      {duplicateCount > 0 && (
        <Link
          href={localePath(locale, "admin/bets/duplicates")}
          className="press-down block"
        >
          <Card className="p-4 md:p-5 flex items-center justify-between gap-3 bg-tertiary-fixed text-on-tertiary-fixed-variant border-tertiary-fixed-dim hover:brightness-105">
            <div className="flex items-center gap-3 min-w-0">
              <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-tertiary-fixed-dim/40 shrink-0">
                <Copy className="h-5 w-5" strokeWidth={2} />
              </span>
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="font-bold text-base">
                  {isHebrew
                    ? `נמצאו ${duplicateCount} הימורים כפולים פעילים`
                    : `${duplicateCount} active bets are duplicates`}
                </span>
                <span className="text-xs">
                  {isHebrew
                    ? "לחץ לסקירה ובחירת איזו רשומה להשאיר."
                    : "Tap to review and pick which copy to keep."}
                </span>
              </div>
            </div>
            <span className="text-sm font-bold underline shrink-0">
              {isHebrew ? "פתח" : "Open"}
            </span>
          </Card>
        </Link>
      )}

      {betType === "live" && (
        <LiveBetPushComposer locale={locale} items={pushItems} />
      )}

      <FilterBar
        locale={locale}
        betType={betType}
        customStatus={customStatus}
        customScope={customScope}
        duelStatus={duelStatus}
        duelScope={duelScope}
        queryFilter={queryFilter}
        matchFilter={matchFilter}
        dayFilter={dayFilter}
        betMatches={betMatches}
        matchdays={matchdays}
      />

      <BetsActiveFilters
        locale={locale}
        items={activeFilters}
        clearHref={clearFiltersHref}
      />
      <BetsFilterMemory />

      {isEmpty ? (
        <Card className="p-6 text-center text-on-surface-variant">
          {betType === "duel"
            ? isHebrew
              ? "אין דו-קרבים שמתאימים לסינון."
              : "No duels match the filters."
            : isHebrew
              ? "אין הימורים שמתאימים לסינון. נסה לאפס את הסינון או ליצור הימור חדש."
              : "No bets match the filters. Clear filters or create a new bet."}
        </Card>
      ) : betType === "duel" ? (
        <div className="flex flex-col gap-3">
          {duels.map((duel) => (
            <DuelCard key={duel.id} duel={duel} locale={locale} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {bets.map((bet) => (
            <BetCard key={bet.id} bet={bet} locale={locale} />
          ))}
        </div>
      )}
    </section>
  );
}

function parseQueryFilter(raw: string | string[] | undefined): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  // Cap the length so a junked URL can't push a 100KB ILIKE pattern into
  // postgres. 100 chars covers every realistic admin search.
  return trimmed === "" ? null : trimmed.slice(0, 100);
}

// Only accept a well-formed UUID so a junked ?match= value falls through
// to "no match filter" instead of throwing on the ::uuid cast in SQL.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseMatchFilter(raw: string | string[] | undefined): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return UUID_RE.test(trimmed) ? trimmed : null;
}

function parseStatusFilter(
  raw: string | string[] | undefined,
): AdminCustomBetRow["status"] | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (
    v === "draft" ||
    v === "open" ||
    v === "locked" ||
    v === "graded" ||
    v === "reversed" ||
    v === "cancelled"
  )
    return v;
  return null;
}

function parseScopeFilter(
  raw: string | string[] | undefined,
): CustomBetScope | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (
    v === "match" ||
    v === "day" ||
    v === "stage" ||
    v === "group" ||
    v === "tournament"
  )
    return v;
  return null;
}

function parseDuelStatus(
  raw: string | string[] | undefined,
): DuelStatus | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === "open" || v === "matched" || v === "settled" || v === "cancelled")
    return v;
  return null;
}

function parseDuelScope(raw: string | string[] | undefined): DuelScope | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === "match" || v === "day" || v === "tournament") return v;
  return null;
}

function FilterBar({
  locale,
  betType,
  customStatus,
  customScope,
  duelStatus,
  duelScope,
  queryFilter,
  matchFilter,
  dayFilter,
  betMatches,
  matchdays,
}: {
  locale: Locale;
  betType: BetType;
  customStatus: AdminCustomBetRow["status"] | null;
  customScope: CustomBetScope | null;
  duelStatus: DuelStatus | null;
  duelScope: DuelScope | null;
  queryFilter: string | null;
  matchFilter: string | null;
  dayFilter: string | null;
  betMatches: AdminBetMatchOption[];
  matchdays: AdminBetMatchdayOption[];
}) {
  const isHebrew = locale === "he";
  const isDuel = betType === "duel";

  // Drill-down context: a selected matchday is either the explicit ?day=
  // filter or the day implied by a selected ?match= (so deep-linking to a
  // fixture still lights up its day and reveals that day's match pills).
  // The match strip only appears once a day is in context — that's the
  // whole point of the drill-down: keep the pill count tiny.
  const selectedMatch = matchFilter
    ? betMatches.find((m) => m.matchId === matchFilter) ?? null
    : null;
  const contextDay = dayFilter ?? selectedMatch?.matchdayDate ?? null;
  const dayMatches = contextDay
    ? betMatches.filter((m) => m.matchdayDate === contextDay)
    : [];

  // The contextual status / scope chip sets depend on the bet type.
  const statusChips: Array<{ key: string | "all"; label: string }> = isDuel
    ? [
        { key: "all", label: isHebrew ? "הכל" : "All" },
        { key: "open", label: duelStatusLabel("open", isHebrew) },
        { key: "matched", label: duelStatusLabel("matched", isHebrew) },
        { key: "settled", label: duelStatusLabel("settled", isHebrew) },
        { key: "cancelled", label: duelStatusLabel("cancelled", isHebrew) },
      ]
    : [
        { key: "all", label: isHebrew ? "הכל" : "All" },
        { key: "draft", label: isHebrew ? "טיוטה" : "Draft" },
        { key: "open", label: isHebrew ? "פתוח" : "Open" },
        { key: "locked", label: isHebrew ? "נסגר" : "Locked" },
        { key: "graded", label: isHebrew ? "נמדד" : "Graded" },
        { key: "cancelled", label: isHebrew ? "בוטל" : "Cancelled" },
      ];

  const scopeChips: Array<{ key: string | "all"; label: string }> = isDuel
    ? [
        { key: "all", label: isHebrew ? "הכל" : "All scopes" },
        { key: "match", label: duelScopeLabel("match", isHebrew) },
        { key: "day", label: duelScopeLabel("day", isHebrew) },
        { key: "tournament", label: duelScopeLabel("tournament", isHebrew) },
      ]
    : [
        { key: "all", label: isHebrew ? "הכל" : "All scopes" },
        ...scopesForBetType(betType).map((s) => ({
          key: s,
          label: customScopeLabel(s, isHebrew),
        })),
      ];

  const activeStatus = isDuel ? duelStatus : customStatus;
  const activeScope = isDuel ? duelScope : customScope;

  return (
    <div className="flex flex-col gap-3">
      {/* Primary facet — bet type. Sits at the top because it drives every
          other filter below it. */}
      <div className="flex flex-col gap-2">
        <LabelCaps>{isHebrew ? "סוג הימור" : "Bet type"}</LabelCaps>
        <div className="flex flex-wrap gap-2">
          {BET_TYPES.map((t) => (
            <TypeChip
              key={t}
              type={t}
              label={betTypeLabel(t, isHebrew)}
              active={betType === t}
              queryFilter={queryFilter}
            />
          ))}
        </div>
      </div>

      {betType === "live" && matchdays.length > 0 && (
        <div className="flex flex-col gap-2">
          <LabelCaps>{isHebrew ? "יום משחק" : "Matchday"}</LabelCaps>
          <FilterScroller>
            <MatchdayChip
              label={isHebrew ? "הכל" : "All"}
              date={null}
              active={contextDay === null}
              betType={betType}
              statusValue={activeStatus}
              scopeValue={activeScope}
              queryFilter={queryFilter}
            />
            {matchdays.map((md) => (
              <MatchdayChip
                key={md.date}
                label={`${formatMatchdayShort(md.date, locale)} · ${md.betCount}`}
                date={md.date}
                active={contextDay === md.date}
                betType={betType}
                statusValue={activeStatus}
                scopeValue={activeScope}
                queryFilter={queryFilter}
              />
            ))}
          </FilterScroller>
        </div>
      )}

      {betType === "live" && contextDay !== null && dayMatches.length > 0 && (
        <div className="flex flex-col gap-2">
          <LabelCaps>{isHebrew ? "משחק" : "Match"}</LabelCaps>
          <FilterScroller>
            <MatchChip
              label={isHebrew ? "כל המשחקים" : "All matches"}
              matchId={null}
              day={contextDay}
              active={matchFilter === null}
              betType={betType}
              statusValue={activeStatus}
              scopeValue={activeScope}
              queryFilter={queryFilter}
            />
            {dayMatches.map((m) => (
              <MatchChip
                key={m.matchId}
                label={`${m.homeCode}–${m.awayCode} · ${m.betCount}`}
                matchId={m.matchId}
                day={contextDay}
                active={matchFilter === m.matchId}
                betType={betType}
                statusValue={activeStatus}
                scopeValue={activeScope}
                queryFilter={queryFilter}
              />
            ))}
          </FilterScroller>
        </div>
      )}
      <div className="flex flex-col gap-2">
        <LabelCaps>{isHebrew ? "חיפוש" : "Search"}</LabelCaps>
        <BetsSearchBox locale={locale} initialQuery={queryFilter ?? ""} />
      </div>
      <div className="flex flex-col gap-2">
        <LabelCaps>{isHebrew ? "סטטוס" : "Status"}</LabelCaps>
        <div className="flex flex-wrap gap-2">
          {statusChips.map((s) => (
            <FilterChip
              key={s.key}
              label={s.label}
              paramKey="status"
              paramValue={s.key === "all" ? null : s.key}
              active={
                s.key === "all" ? activeStatus === null : activeStatus === s.key
              }
              betType={betType}
              statusValue={activeStatus}
              scopeValue={activeScope}
              queryFilter={queryFilter}
              matchFilter={matchFilter}
              dayFilter={dayFilter}
            />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <LabelCaps>{isHebrew ? "שלב / סוג" : "Scope"}</LabelCaps>
        <div className="flex flex-wrap gap-2">
          {scopeChips.map((s) => (
            <FilterChip
              key={s.key}
              label={s.label}
              paramKey="scope"
              paramValue={s.key === "all" ? null : s.key}
              active={
                s.key === "all" ? activeScope === null : activeScope === s.key
              }
              betType={betType}
              statusValue={activeStatus}
              scopeValue={activeScope}
              queryFilter={queryFilter}
              matchFilter={matchFilter}
              dayFilter={dayFilter}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// Single source of truth for a bets-list URL. Every chip rebuilds the
// FULL param set so the OTHER dimensions carry through instead of getting
// wiped — chaining filters never forces the admin back to square one. The
// per-type gates keep meaningless params off a URL where they don't apply
// (live is the implicit default type; match/day belong to the live family).
function buildBetsHref(parts: {
  betType: BetType;
  status: string | null;
  scope: string | null;
  q: string | null;
  match: string | null;
  day: string | null;
}): string {
  const next = new URLSearchParams();
  if (parts.betType !== "live") next.set("type", parts.betType);
  if (parts.status) next.set("status", parts.status);
  if (parts.scope) next.set("scope", parts.scope);
  if (parts.q) next.set("q", parts.q);
  if (parts.day && parts.betType === "live") next.set("day", parts.day);
  if (parts.match && parts.betType !== "duel") next.set("match", parts.match);
  const qs = next.toString();
  return qs ? `?${qs}` : "?";
}

// Compact matchday label: weekday + D.M projected onto Asia/Jerusalem. A
// UTC-midnight date string stays on the same calendar day there, so no
// off-by-one drift across the date boundary.
function formatMatchdayShort(date: string, locale: Locale): string {
  return formatDateTime(date, locale, {
    weekday: "short",
    day: "numeric",
    month: "numeric",
  });
}

// Horizontal, snap-scrolling rail for the quick-filter pill strips. Bleeds
// to the screen edges on mobile so a long day/match list scrolls edge to
// edge, then wraps normally from md up. Scrollbar hidden — the snap and the
// partial last pill are the "there's more" affordance.
function FilterScroller({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-2 overflow-x-auto snap-x snap-mandatory -mx-4 px-4 md:mx-0 md:px-0 md:flex-wrap pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
      {children}
    </div>
  );
}

// The primary type chip. Switching type resets status / scope / match / day
// (each type owns its own vocabulary) but carries the free-text query
// through, so the admin can keep a search term while flipping families.
function TypeChip({
  type,
  label,
  active,
  queryFilter,
}: {
  type: BetType;
  label: string;
  active: boolean;
  queryFilter: string | null;
}) {
  const href = buildBetsHref({
    betType: type,
    status: null,
    scope: null,
    q: queryFilter,
    match: null,
    day: null,
  });
  return (
    <Link href={href} replace scroll={false}>
      <Chip tone={active ? "primary" : "default"} className="min-h-[44px] px-4 cursor-pointer font-bold">
        {type === "duel" && <Swords className="h-4 w-4" strokeWidth={2} />}
        {label}
      </Chip>
    </Link>
  );
}

function FilterChip({
  label,
  paramKey,
  paramValue,
  active,
  betType,
  statusValue,
  scopeValue,
  queryFilter,
  matchFilter,
  dayFilter,
}: {
  label: string;
  paramKey: "status" | "scope";
  paramValue: string | null;
  active: boolean;
  betType: BetType;
  statusValue: string | null;
  scopeValue: string | null;
  queryFilter: string | null;
  matchFilter: string | null;
  dayFilter: string | null;
}) {
  // `replace: true` keeps history clean while the admin scrolls options.
  const href = buildBetsHref({
    betType,
    status: paramKey === "status" ? paramValue : statusValue,
    scope: paramKey === "scope" ? paramValue : scopeValue,
    q: queryFilter,
    match: matchFilter,
    day: dayFilter,
  });
  return (
    <Link href={href} replace scroll={false}>
      <Chip tone={active ? "primary" : "default"} className="min-h-[44px] cursor-pointer">
        {label}
      </Chip>
    </Link>
  );
}

// Matchday quick-filter pill. Picking a day starts a fresh fixture context,
// so it sets ?day= and CLEARS ?match= (a match from another day no longer
// applies). "All" (date=null) clears both.
function MatchdayChip({
  label,
  date,
  active,
  betType,
  statusValue,
  scopeValue,
  queryFilter,
}: {
  label: string;
  date: string | null;
  active: boolean;
  betType: BetType;
  statusValue: string | null;
  scopeValue: string | null;
  queryFilter: string | null;
}) {
  const href = buildBetsHref({
    betType,
    status: statusValue,
    scope: scopeValue,
    q: queryFilter,
    match: null,
    day: date,
  });
  return (
    <Link href={href} replace scroll={false} className="shrink-0 snap-start">
      <Chip tone={active ? "primary" : "default"} className="min-h-[44px] px-4 cursor-pointer whitespace-nowrap tabular-nums">
        {label}
      </Chip>
    </Link>
  );
}

// Match quick-filter pill, shown only inside a selected matchday. Sets
// ?match= and pins ?day= to the context day so the URL is explicit and
// stable across back/forward. "All matches" keeps the day, clears match.
function MatchChip({
  label,
  matchId,
  day,
  active,
  betType,
  statusValue,
  scopeValue,
  queryFilter,
}: {
  label: string;
  matchId: string | null;
  day: string | null;
  active: boolean;
  betType: BetType;
  statusValue: string | null;
  scopeValue: string | null;
  queryFilter: string | null;
}) {
  const href = buildBetsHref({
    betType,
    status: statusValue,
    scope: scopeValue,
    q: queryFilter,
    match: matchId,
    day,
  });
  return (
    <Link href={href} replace scroll={false} className="shrink-0 snap-start">
      <Chip tone={active ? "primary" : "default"} className="min-h-[44px] px-4 cursor-pointer whitespace-nowrap tabular-nums">
        <bdi>{label}</bdi>
      </Chip>
    </Link>
  );
}

// Resolve the active narrowing filters (everything but the always-visible
// type facet) to { label, href-with-it-removed } so the client summary bar
// can render removable chips without re-deriving any label logic.
function buildActiveFilters(args: {
  isHebrew: boolean;
  locale: Locale;
  betType: BetType;
  customStatus: AdminCustomBetRow["status"] | null;
  customScope: CustomBetScope | null;
  duelStatus: DuelStatus | null;
  duelScope: DuelScope | null;
  queryFilter: string | null;
  matchFilter: string | null;
  dayFilter: string | null;
  betMatches: AdminBetMatchOption[];
}): Array<{ key: string; label: string; href: string }> {
  const { isHebrew, locale, betType } = args;
  const isDuel = betType === "duel";
  const status = isDuel ? args.duelStatus : args.customStatus;
  const scope = isDuel ? args.duelScope : args.customScope;
  const base = {
    betType,
    status: status as string | null,
    scope: scope as string | null,
    q: args.queryFilter,
    match: args.matchFilter,
    day: args.dayFilter,
  };
  const items: Array<{ key: string; label: string; href: string }> = [];
  if (status) {
    items.push({
      key: "status",
      label: isDuel
        ? duelStatusLabel(status as DuelStatus, isHebrew)
        : statusLabel(status as AdminCustomBetRow["status"], isHebrew),
      href: buildBetsHref({ ...base, status: null }),
    });
  }
  if (scope) {
    items.push({
      key: "scope",
      label: isDuel
        ? duelScopeLabel(scope as DuelScope, isHebrew)
        : customScopeLabel(scope as CustomBetScope, isHebrew),
      href: buildBetsHref({ ...base, scope: null }),
    });
  }
  if (args.dayFilter) {
    items.push({
      key: "day",
      label: formatMatchdayShort(args.dayFilter, locale),
      href: buildBetsHref({ ...base, day: null }),
    });
  }
  if (args.matchFilter) {
    const m = args.betMatches.find((x) => x.matchId === args.matchFilter);
    items.push({
      key: "match",
      label: m ? `${m.homeCode}–${m.awayCode}` : isHebrew ? "משחק" : "Match",
      href: buildBetsHref({ ...base, match: null }),
    });
  }
  if (args.queryFilter) {
    items.push({
      key: "q",
      label: `"${args.queryFilter}"`,
      href: buildBetsHref({ ...base, q: null }),
    });
  }
  return items;
}

// Flatten a bet's live answer config into {label, ratio} rows for the
// list card. Yes/No becomes two rows; multi_choice maps each option that
// has captured odds to its localized label. Returns [] for free-pick /
// legacy / number / free-text bets so the card renders no ratios row.
function liveRatioRows(
  bet: AdminCustomBetRow,
  isHebrew: boolean,
): Array<{ label: string; ratio: number }> {
  const cfg = bet.answerConfig as AnswerConfig | null | undefined;
  const ratios = liveDisplayRatios(cfg);
  if (!ratios) return [];
  if (ratios.kind === "yes_no") {
    const rows: Array<{ label: string; ratio: number }> = [];
    if (ratios.yes != null) rows.push({ label: isHebrew ? "כן" : "Yes", ratio: ratios.yes });
    if (ratios.no != null) rows.push({ label: isHebrew ? "לא" : "No", ratio: ratios.no });
    return rows;
  }
  if (cfg?.kind !== "multi_choice") return [];
  return cfg.options
    .filter((o) => ratios.byValue[o.value] != null)
    .map((o) => ({
      label: isHebrew ? o.labelHe : o.labelEn,
      ratio: ratios.byValue[o.value],
    }));
}

function BetCard({
  bet,
  locale,
}: {
  bet: AdminCustomBetRow;
  locale: Locale;
}) {
  const isHebrew = locale === "he";
  const question = isHebrew ? bet.questionHe : bet.questionEn;
  const lockLabel = formatDateTime(bet.lockAt, locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  // Per-option live ratios (×N) so a manager scanning the list sees the
  // multiplier on every outcome without opening the bet. Empty for free-pick
  // / legacy bets that carry no live odds.
  const ratioRows = liveRatioRows(bet, isHebrew);

  return (
    <Card className="p-4 md:p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <SectionHeading as="h3" underline="thin" className="text-lg md:text-xl !leading-tight">
            {question}
          </SectionHeading>
          <div className="flex flex-wrap gap-2 items-center mt-1">
            <Chip tone={statusTone(bet.status)}>
              {statusLabel(bet.status, isHebrew)}
            </Chip>
            <Chip tone="secondary">{scopeLabel(bet, isHebrew)}</Chip>
            <Chip>{answerTypeLabel(bet.answerType, isHebrew)}</Chip>
            <Chip>{gradingSourceLabel(bet.gradingSource, isHebrew)}</Chip>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <LabelCaps>{isHebrew ? "נסגר" : "Locks"}</LabelCaps>
          <span className="font-[family-name:var(--font-label)] text-sm font-bold tabular-nums">
            {lockLabel}
          </span>
          <LabelCaps className="mt-1">{isHebrew ? "הימרו" : "Picks"}</LabelCaps>
          <span className="font-[family-name:var(--font-label)] text-sm font-bold tabular-nums">
            <bdi>{bet.pickCount}</bdi>
          </span>
        </div>
      </div>
      {ratioRows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-outline-variant">
          <LabelCaps>{isHebrew ? "יחסים" : "Ratios"}</LabelCaps>
          {ratioRows.map((r, i) => (
            <Chip key={i} tone="secondary" className="tabular-nums">
              <bdi>{r.label}</bdi>{" "}
              <span dir="ltr">{formatLiveRatio(r.ratio)}</span>
            </Chip>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between gap-3 flex-wrap pt-3 border-t border-outline-variant">
        <p className="text-sm text-on-surface-variant">
          {isFreePickScope(bet.scope)
            ? isHebrew
              ? `ללא עלות · זכייה ${bet.payoutSnapshot}`
              : `Free · Payout ${bet.payoutSnapshot}`
            : isHebrew
              ? `עלות ${bet.stakeSnapshot} · זכייה ${bet.payoutSnapshot}`
              : `Stake ${bet.stakeSnapshot} · Payout ${bet.payoutSnapshot}`}
        </p>
        <BetsTableActions
          locale={locale}
          id={bet.id}
          status={bet.status}
          canEditOdds={canEditPublishedOdds({
            status: bet.status,
            scope: bet.scope,
            lockAt: bet.lockAt,
            answerConfig: bet.answerConfig,
          })}
        />
      </div>
    </Card>
  );
}

// Admin duel card. Surfaces the same lifecycle facts the public detail
// page shows (sides, picks, stake, deadline / resolve) plus the inline
// settle / cancel controls a manager needs without leaving the list.
function DuelCard({
  duel,
  locale,
}: {
  duel: AdminDuelRow;
  locale: Locale;
}) {
  const isHebrew = locale === "he";
  const question = isHebrew ? duel.questionHe : duel.questionEn;
  const isActive = duel.status === "open" || duel.status === "matched";
  // Active duels look toward the join deadline; resolved ones toward the
  // resolve time. Show whichever is meaningful for the row's state.
  const timeLabel = formatDateTime(
    isActive ? duel.joinDeadlineAt : duel.resolveAt,
    locale,
    { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" },
  );

  return (
    <Card className="p-4 md:p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <SectionHeading as="h3" underline="thin" className="text-lg md:text-xl !leading-tight inline-flex items-start gap-2">
            <Swords className="h-5 w-5 mt-0.5 shrink-0" strokeWidth={1.75} />
            <span>{question}</span>
          </SectionHeading>
          <div className="flex flex-wrap gap-2 items-center mt-1">
            <Chip tone={duelStatusTone(duel.status)}>
              {duelStatusLabel(duel.status, isHebrew)}
            </Chip>
            <Chip tone="secondary">{duelScopeLabel(duel.scope, isHebrew)}</Chip>
            {duel.matchLabel && <Chip>{duel.matchLabel}</Chip>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <LabelCaps>{isActive ? (isHebrew ? "ננעל" : "Closes") : (isHebrew ? "הוכרע" : "Resolved")}</LabelCaps>
          <span className="font-[family-name:var(--font-label)] text-sm font-bold tabular-nums">
            {timeLabel}
          </span>
          <LabelCaps className="mt-1">{isHebrew ? "סכום" : "Stake"}</LabelCaps>
          <span className="font-[family-name:var(--font-score)] text-lg font-bold tabular-nums">
            <bdi>{duel.stake}</bdi>
          </span>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 sm:gap-6 text-xs text-on-surface-variant pt-2">
        <span>
          <span className="font-bold">{isHebrew ? "פותח" : "Opener"}:</span>{" "}
          {duel.openerName}
        </span>
        <span>
          <span className="font-bold">{isHebrew ? "מצטרף" : "Joiner"}:</span>{" "}
          {duel.joinerName ?? (isHebrew ? "— אין עדיין" : "— none yet")}
        </span>
      </div>

      <div className="pt-3 border-t border-outline-variant">
        <DuelAdminActions
          locale={locale}
          duelId={duel.id}
          status={duel.status}
          options={duel.options}
          openerOption={duel.openerOption}
          joinerOption={duel.joinerOption}
        />
      </div>
    </Card>
  );
}

function statusTone(s: AdminCustomBetRow["status"]): "default" | "primary" | "secondary" | "warning" {
  switch (s) {
    case "draft":     return "default";
    case "open":      return "primary";
    case "locked":    return "warning";
    case "graded":    return "secondary";
    case "reversed":  return "warning";
    case "cancelled": return "default";
  }
}

function statusLabel(s: AdminCustomBetRow["status"], isHebrew: boolean): string {
  const map: Record<AdminCustomBetRow["status"], [string, string]> = {
    draft:     ["טיוטה", "Draft"],
    open:      ["פתוח", "Open"],
    locked:    ["נסגר", "Locked"],
    graded:    ["נמדד", "Graded"],
    reversed:  ["הוחזר", "Reversed"],
    cancelled: ["בוטל", "Cancelled"],
  };
  return map[s][isHebrew ? 0 : 1];
}

function scopeLabel(bet: AdminCustomBetRow, isHebrew: boolean): string {
  switch (bet.scope) {
    case "match":
      return bet.matchLabel ?? (isHebrew ? "משחק" : "Match");
    case "day":
      return bet.matchdayDate ?? (isHebrew ? "יום" : "Day");
    case "stage":
      return `${isHebrew ? "שלב" : "Stage"}: ${bet.stage}`;
    case "group":
      return `${isHebrew ? "בית" : "Group"} ${bet.groupId}`;
    case "tournament":
      return isHebrew ? "טורניר" : "Tournament";
  }
}

// Scope chip label for the live / tournament families (custom_bets).
function customScopeLabel(scope: CustomBetScope, isHebrew: boolean): string {
  const map: Record<CustomBetScope, [string, string]> = {
    match:      ["משחק", "Match"],
    day:        ["יום", "Day"],
    stage:      ["שלב", "Stage"],
    group:      ["בית", "Group"],
    tournament: ["טורניר", "Tournament"],
  };
  return map[scope][isHebrew ? 0 : 1];
}

function answerTypeLabel(
  t: AdminCustomBetRow["answerType"],
  isHebrew: boolean,
): string {
  const map: Record<AdminCustomBetRow["answerType"], [string, string]> = {
    yes_no:       ["כן/לא", "Yes/No"],
    number:       ["מספר", "Number"],
    multi_choice: ["בחירה", "Choice"],
    free_text:    ["טקסט", "Text"],
  };
  return map[t][isHebrew ? 0 : 1];
}

function gradingSourceLabel(
  s: AdminCustomBetRow["gradingSource"],
  isHebrew: boolean,
): string {
  const map: Record<AdminCustomBetRow["gradingSource"], [string, string]> = {
    auto_api_football:  ["אוטו (API-Football)", "Auto (API-Football)"],
    auto_football_data: ["אוטו (תוצאה)", "Auto (score)"],
    manual:             ["ידני", "Manual"],
  };
  return map[s][isHebrew ? 0 : 1];
}
