import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, ChevronRight, Stamp } from "lucide-react";
import { getDictionary, hasLocale, type Locale } from "../../../dictionaries";
import { Card, LabelCaps, ScoreLine } from "@/components/ui";
import { BetsTabs } from "@/components/BetsTabs";
import { SurpriseMeButton } from "@/components/SurpriseMeButton";
import { Flag } from "@/components/Flag";
import { PayGateBanner } from "@/components/PayGateBanner";
import {
  CustomBetCard,
  type CustomBetCardData,
} from "@/components/CustomBetCard";
import { getRequestUser } from "@/lib/request-user";
import { getUserAccess } from "@/lib/access";
import {
  getBankBalance,
  getLiveStakeConfig,
  getOverdraftConfig,
} from "@/lib/bank";
import { localePath } from "@/lib/paths";
import { formatDateTime } from "@/lib/format";
import { serverNow } from "@/lib/server-now";
import { getPlayDayDetail } from "@/db/queries";
import type {
  AnswerConfig,
  PickAnswer,
} from "@/lib/bets/types";

// /bets/live/[date] — matchday live-bet detail. Same data shape as
// the legacy /play/[date]; the page moved to live under the
// unified Bets tab strip. The old URL redirects here so existing
// bookmarks and PWA shortcuts keep working through the cutover.

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
    bankBalance = await getBankBalance(user.id);
  } catch (err) {
    console.error("[bets/live/date] getBankBalance threw", { date, err });
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

  const dayBets = detail.bets.filter((b) => b.scope === "day");
  const matchBets = detail.bets.filter((b) => b.scope === "match");
  // Group match-scope bets by the matchId they target so we can render
  // them beneath their fixture card.
  const matchBetsByMatchId = new Map<string, typeof matchBets>();
  for (const b of matchBets) {
    if (!b.matchId) continue;
    const arr = matchBetsByMatchId.get(b.matchId) ?? [];
    arr.push(b);
    matchBetsByMatchId.set(b.matchId, arr);
  }

  const headerLabel = formatDateTime(detail.fixtures[0]?.kickoffAt ?? `${date}T12:00:00Z`, locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

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
            ? `${detail.fixtures.length} משחקים · ${detail.bets.length} הימורים`
            : `${detail.fixtures.length} matches · ${detail.bets.length} bets`}
        </p>
      </header>

      {!access.canEdit && <PayGateBanner locale={locale} dict={dict} />}

      {access.canEdit && detail.bets.length > 0 && (
        <SurpriseMeButton locale={locale} target={{ surface: "live", date }} />
      )}

      {/* Section 1: Fixtures with link to 1/X/2 form */}
      {detail.fixtures.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionTitle>
            {isHebrew ? "המשחקים של היום" : "Today's fixtures"}
          </SectionTitle>
          <ul className="flex flex-col gap-3">
            {detail.fixtures.map((m) => {
              const homeName = isHebrew ? m.homeNameHe : m.homeNameEn;
              const awayName = isHebrew ? m.awayNameHe : m.awayNameEn;
              const hasPick = m.myHome !== null && m.myAway !== null;
              return (
                <li key={m.id}>
                  <Link
                    href={localePath(locale, `bets/${m.id}`)}
                    className="press-down block"
                  >
                    <Card className="p-4 md:p-5 flex items-center justify-between gap-3 hover:bg-surface-container transition-colors">
                      <div className="flex items-center gap-2 md:gap-3 flex-1 min-w-0">
                        <Flag code={m.homeCode} size={28} />
                        <span className="text-sm md:text-base font-bold truncate">
                          {homeName}
                        </span>
                        <span className="text-on-surface-variant text-xs md:text-sm px-1">
                          vs
                        </span>
                        <span className="text-sm md:text-base font-bold truncate">
                          {awayName}
                        </span>
                        <Flag code={m.awayCode} size={28} />
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        {hasPick ? (
                          <div className="text-end">
                            <LabelCaps as="div" className="mb-0.5">
                              {isHebrew ? "תחזית" : "Prediction"}
                            </LabelCaps>
                            <ScoreLine
                              home={m.myHome!}
                              away={m.myAway!}
                              className="font-[family-name:var(--font-score)] text-base md:text-lg font-bold text-primary"
                            />
                          </div>
                        ) : (
                          <div className="text-end">
                            <LabelCaps as="div" className="mb-0.5">
                              {isHebrew ? "פתיחה" : "Kickoff"}
                            </LabelCaps>
                            <span className="font-[family-name:var(--font-label)] text-xs font-bold tabular-nums">
                              {formatDateTime(m.kickoffAt, locale, {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          </div>
                        )}
                        <Chev className="h-5 w-5 text-outline shrink-0" />
                      </div>
                    </Card>
                  </Link>

                  {/* Match-scope bets attached to this fixture */}
                  {(matchBetsByMatchId.get(m.id) ?? []).length > 0 && (
                    <div className="mt-3 ms-4 ps-3 border-s-2 border-outline-variant flex flex-col gap-3">
                      {matchBetsByMatchId.get(m.id)!.map((b) => (
                        <CustomBetCard
                          key={b.id}
                          locale={locale}
                          bankBalance={bankBalance}
                          editable={isEditable(b)}
                          liveStakeConfig={liveStakeConfig}
                          maxOverdraft={overdraft.maxOverdraft}
                          lockedFromBetting={lockedFromBetting}
                          bet={toCardData(b, "match", isHebrew, m.homeCode, m.awayCode)}
                        />
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Section 2: Day-scope bets (aggregate across all today's matches) */}
      {dayBets.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionTitle>
            <span className="inline-flex items-center gap-2">
              <Stamp className="h-5 w-5 text-tertiary-fixed-dim" strokeWidth={1.75} />
              {dict.live.dayWideTitle}
            </span>
          </SectionTitle>
          <p className="text-sm text-on-surface-variant -mt-1">
            {dict.live.dayWideHint}
          </p>
          <div className="flex flex-col gap-3">
            {dayBets.map((b) => (
              <CustomBetCard
                key={b.id}
                locale={locale}
                bankBalance={bankBalance}
                editable={isEditable(b)}
                liveStakeConfig={liveStakeConfig}
                maxOverdraft={overdraft.maxOverdraft}
                lockedFromBetting={lockedFromBetting}
                bet={toCardData(b, "day", isHebrew)}
              />
            ))}
          </div>
        </section>
      )}

      {dayBets.length === 0 && matchBets.length === 0 && (
        <Card className="p-6 text-center text-on-surface-variant">
          {dict.live.emptyDay}
        </Card>
      )}
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

function SectionTitle({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <h2 className="font-[family-name:var(--font-display)] text-xl md:text-2xl font-bold text-on-surface">
      {children}
    </h2>
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
