import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getDictionary, hasLocale, type Locale } from "../../../dictionaries";
import { BetsTabs } from "@/components/BetsTabs";
import { SurpriseMeButton } from "@/components/SurpriseMeButton";
import { PayGateBanner } from "@/components/PayGateBanner";
import type { CustomBetCardData } from "@/components/CustomBetCard";
import { getRequestUser } from "@/lib/request-user";
import { getUserAccess } from "@/lib/access";
import {
  getBankBreakdown,
  getLiveStakeConfig,
  getOverdraftConfig,
} from "@/lib/bank";
import { localePath } from "@/lib/paths";
import { formatDateTime, ilDateParts } from "@/lib/format";
import { serverNow } from "@/lib/server-now";
import { getPlayDayDetail } from "@/db/queries";
import type {
  AnswerConfig,
  PickAnswer,
} from "@/lib/bets/types";
import { BetsDayBoard, type FixtureItem, type BetItem } from "./BetsDayBoard";

// /bets/live/[date] — matchday live-bet detail. Same data shape as
// the legacy /play/[date]; the page moved to live under the
// unified Bets tab strip. The old URL redirects here so existing
// bookmarks and PWA shortcuts keep working through the cutover.

// Cap server-side execution well below Vercel's 300s function ceiling.
// This is the hot live-bet surface; under a matchday traffic burst a
// render — or a bet-placement Server Action, maxDuration covers both —
// that stalls waiting on a saturated DB pool should fail fast at 60s and
// free its function slot + connections instead of squatting for five
// minutes and 504-ing (the Jun 17 2026 alert). 60s leaves generous
// headroom over the heaviest legitimate action (a full-matchday
// "Surprise me" bulk fill). See _plans/2026-06-17-live-day-pool-fix.md.
export const maxDuration = 60;

export default async function BetsLiveDayPage({
  params,
}: PageProps<"/[lang]/bets/live/[date]">) {
  const { lang, date } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const dict = await getDictionary(locale);
  const isHebrew = locale === "he";
  const Chev = isHebrew ? ChevronLeft : ChevronRight;

  // Malformed dates 404. Valid-but-empty dates fall through to the empty-
  // state card a bit further down instead - the agent run on 2026-06-05
  // surfaced that clicking a date with no published custom bets bounced
  // users to a generic "page not found" instead of a friendly message.
  if (!isValidIsoDate(date)) notFound();

  const user = await getRequestUser();
  if (!user) redirect(localePath(locale, "login"));

  // Defensive: every data dependency gets its own try/catch with a
  // logged error and a safe default. The 2026-06-05 agent run kept
  // surfacing /he/bets/live/2026-06-11 rendering completely empty
  // while June 12/14 worked - same code path, different data, almost
  // certainly a query throw on that specific date. Adding the wrap
  // around getUserAccess too because if it throws here (it queries
  // profiles + payments) the previous wrap missed it.
  let access: Awaited<ReturnType<typeof getUserAccess>> = {
    isAdmin: false,
    isPaid: false,
    canEdit: false,
    canSeeAdminMenu: false,
    viewingAs: null,
  };
  try {
    access = await getUserAccess(user.id);
  } catch (err) {
    console.error("[bets/live/date] getUserAccess threw", { date, err });
  }
  let detail: NonNullable<Awaited<ReturnType<typeof getPlayDayDetail>>>;
  let bankBalance = 0;
  try {
    detail = (await getPlayDayDetail(date, user.id)) ?? {
      date,
      matchdayId: null,
      fixtures: [],
      bets: [],
    };
  } catch (err) {
    console.error("[bets/live/date] getPlayDayDetail threw", { date, err });
    detail = { date, matchdayId: null, fixtures: [], bets: [] };
  }
  try {
    // Cross-request cached (bankCacheTag), busted by every bet/duel
    // mutation — so the hot live surface reads the bank from the Data
    // Cache instead of issuing the 6-subquery balance recompute on every
    // load. The number is advisory for the board's display + negative
    // lock; placement re-checks the live balance inside its own txn.
    bankBalance = (await getBankBreakdown(user.id)).balance;
  } catch (err) {
    console.error("[bets/live/date] getBankBreakdown threw", { date, err });
  }
  // Live-bet stake bounds + payout cap, read once per render and
  // threaded through every CustomBetCard so the pill row matches the
  // server-side payout math byte-for-byte.
  const liveStakeConfig = await getLiveStakeConfig();
  // Negative-balance lock + overdraft cap — see
  // _plans/2026-06-11-negative-balance-lock.md. Read once so every
  // CustomBetCard on the page shares the same gate state.
  const overdraft = await getOverdraftConfig();
  const lockedFromBetting =
    overdraft.lockBetsWhenNegative && bankBalance < 0;
  // Compute "is this bet still editable?" once on the server so the
  // CustomBetCard client component doesn't have to call Date.now()
  // during its render.
  const nowMs = serverNow();
  const isEditable = (b: { status: string; lockAt: string }) =>
    access.canEdit && b.status === "open" && new Date(b.lockAt).getTime() > nowMs;

  // A matchday is "past" once its date is before today in Asia/Jerusalem —
  // the same boundary listPastPlayDays uses to build the past list. This
  // page is shared between the upcoming surface and that past list (each
  // past-day card links straight here), so we branch on it below.
  const todayIL = (() => {
    const p = ilDateParts(serverNow());
    return `${p.year}-${p.month}-${p.day}`;
  })();
  const isPastDay = date < todayIL;

  // On the upcoming surface, hide finished matches — once a fixture is
  // final it just adds visual noise and pushes the still-actionable
  // kickoffs further down the page; the match-scope bets nested under
  // those fixtures fall out with them. On a past day every fixture is
  // final, so applying that filter would blank the whole page (the
  // empty-state card fires even though the player has graded picks to
  // review). Past days therefore show the full board read-only — the bets
  // are already non-editable (graded/locked), so no extra guard is needed.
  const shownFixtures = isPastDay
    ? detail.fixtures
    : detail.fixtures.filter((f) => f.status !== "final");
  const shownFixtureIds = new Set(shownFixtures.map((f) => f.id));

  const dayBets = detail.bets.filter((b) => b.scope === "day");
  const matchBets = detail.bets
    .filter((b) => b.scope === "match")
    .filter((b) => !b.matchId || shownFixtureIds.has(b.matchId));
  // Group match-scope bets by the matchId they target so we can render
  // them beneath their fixture card.
  const matchBetsByMatchId = new Map<string, typeof matchBets>();
  for (const b of matchBets) {
    if (!b.matchId) continue;
    const arr = matchBetsByMatchId.get(b.matchId) ?? [];
    arr.push(b);
    matchBetsByMatchId.set(b.matchId, arr);
  }

  // Project server rows onto the client-board shape. The board is the
  // search + filter island that owns presentation; the server still does
  // all the per-bet editability math (lockAt vs serverNow + access check)
  // so the client never needs Date.now() at render.
  const fixtureItems: FixtureItem[] = shownFixtures.map((m) => ({
    id: m.id,
    kickoffAt: m.kickoffAt,
    homeCode: m.homeCode,
    homeNameHe: m.homeNameHe,
    homeNameEn: m.homeNameEn,
    awayCode: m.awayCode,
    awayNameHe: m.awayNameHe,
    awayNameEn: m.awayNameEn,
    status: m.status,
    myHome: m.myHome,
    myAway: m.myAway,
    matchBets: (matchBetsByMatchId.get(m.id) ?? []).map<BetItem>((b) => ({
      cardData: toCardData(b, "match", isHebrew, m.homeCode, m.awayCode),
      editable: isEditable(b),
    })),
  }));
  const dayBetItems: BetItem[] = dayBets.map((b) => ({
    cardData: toCardData(b, "day", isHebrew),
    editable: isEditable(b),
  }));

  const headerLabel = formatDateTime(detail.fixtures[0]?.kickoffAt ?? `${date}T12:00:00Z`, locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const hiddenFinalCount = detail.fixtures.length - shownFixtures.length;

  return (
    <section className="px-4 md:px-16 py-6 md:py-12 flex flex-col gap-6 md:gap-8 max-w-3xl mx-auto w-full pb-24">
      <header className="flex flex-col gap-3">
        <Link
          href={localePath(locale, "bets/live")}
          className="inline-flex items-center gap-1 text-sm text-on-surface-variant hover:text-on-surface w-fit"
        >
          <Chev className="h-4 w-4" strokeWidth={2} />
          {dict.live.backToLive}
        </Link>
        <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-9 md:text-[40px] md:leading-[44px] font-bold text-primary">
          {isHebrew ? "הימורים" : "Bets"}
        </h1>
        <BetsTabs locale={locale} active="live" />
        <h2 className="font-[family-name:var(--font-display)] text-lg md:text-xl font-bold text-on-surface mt-2">
          {headerLabel}
        </h2>
        <p className="text-sm text-on-surface-variant">
          {isHebrew
            ? `${shownFixtures.length} משחקים · ${matchBets.length + dayBets.length} הימורים`
            : `${shownFixtures.length} matches · ${matchBets.length + dayBets.length} bets`}
          {hiddenFinalCount > 0 && (
            <>
              {" · "}
              <span className="text-on-surface-variant/80">
                {isHebrew
                  ? `${hiddenFinalCount} נגמרו (מוסתרים)`
                  : `${hiddenFinalCount} finished (hidden)`}
              </span>
            </>
          )}
        </p>
      </header>

      {!access.canEdit && <PayGateBanner locale={locale} dict={dict} />}

      {access.canEdit && !isPastDay && (matchBets.length > 0 || dayBets.length > 0) && (
        <SurpriseMeButton locale={locale} target={{ surface: "live", date }} />
      )}

      <BetsDayBoard
        locale={locale}
        fixtures={fixtureItems}
        dayBets={dayBetItems}
        bankBalance={bankBalance}
        liveStakeConfig={liveStakeConfig}
        maxOverdraft={overdraft.maxOverdraft}
        lockedFromBetting={lockedFromBetting}
        dayWideTitle={dict.live.dayWideTitle}
        dayWideHint={dict.live.dayWideHint}
        emptyDay={dict.live.emptyDay}
      />
    </section>
  );
}

// Accepts YYYY-MM-DD AND requires the values to round-trip through Date so
// formatted-but-impossible dates like 2026-99-99 or 2026-02-31 get a clean
// 404 instead of a server-component crash.
function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, mo, d] = value.split("-").map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const parsed = new Date(Date.UTC(y, mo - 1, d));
  return (
    parsed.getUTCFullYear() === y &&
    parsed.getUTCMonth() === mo - 1 &&
    parsed.getUTCDate() === d
  );
}

// Cast the SQL-shaped row into the strongly-typed card props. SQL row has
// `unknown` for JSONB columns; we narrow at this boundary. `scope` is
// supplied by the caller — match-scope rows render inside a per-fixture
// section, day-scope rows render in the day-wide list, so the caller
// always knows which kind it has.
function toCardData(
  row: {
    id: string;
    questionHe: string;
    questionEn: string;
    gradingRuleHe: string;
    gradingRuleEn: string;
    answerType: "yes_no" | "number" | "multi_choice" | "free_text";
    answerConfig: unknown;
    stakeSnapshot: number;
    payoutSnapshot: number;
    decimalOdds: string | null;
    lockAt: string;
    status: "open" | "locked" | "graded" | "reversed";
    matchLabel: string | null;
    myAnswer: unknown;
    myStakePaid: number | null;
  },
  scope: "match" | "day",
  isHebrew: boolean,
  homeCode?: string,
  awayCode?: string,
): CustomBetCardData {
  const scopeLabel =
    homeCode && awayCode
      ? `${homeCode} ${isHebrew ? "נגד" : "vs"} ${awayCode}`
      : row.matchLabel ?? undefined;
  return {
    id: row.id,
    questionHe: row.questionHe,
    questionEn: row.questionEn,
    gradingRuleHe: row.gradingRuleHe,
    gradingRuleEn: row.gradingRuleEn,
    answerType: row.answerType,
    answerConfig: row.answerConfig as AnswerConfig,
    scope,
    stakeSnapshot: row.stakeSnapshot,
    payoutSnapshot: row.payoutSnapshot,
    decimalOdds: row.decimalOdds,
    lockAt: row.lockAt,
    status: row.status,
    myAnswer: (row.myAnswer ?? null) as PickAnswer | null,
    myStakePaid: row.myStakePaid,
    scopeLabel,
  };
}
