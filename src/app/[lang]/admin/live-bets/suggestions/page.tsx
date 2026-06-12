import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, inArray } from "drizzle-orm";
import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import { clsx } from "clsx";
import { hasLocale, type Locale } from "../../../dictionaries";
import { Card, Chip, LabelCaps, SectionHeading } from "@/components/ui";
import { Flag } from "@/components/Flag";
import { db } from "@/db";
import { liveOddsSnapshot, settings } from "@/db/schema";
import { Plus } from "lucide-react";
import {
  listBetTemplates,
  listFixturesForDate,
  listLiveBetsDates,
  type BetTemplate,
} from "@/db/admin-queries";
import { localePath } from "@/lib/paths";
import { formatDateTime } from "@/lib/format";
import { fetchOddsForMatch, type MarketOdds } from "@/lib/odds";
import {
  normalizeOdds,
  type OddsNormConfig,
} from "@/lib/odds-normalize";
import { PublishRow } from "./PublishRow";
import { PublishMarketGroup } from "./PublishMarketGroup";
import { RefreshFixtureButton } from "./RefreshFixtureButton";
import { GenerateAiButton } from "./GenerateAiButton";
import { GenerateDayAiButton } from "./GenerateDayAiButton";
import { AiModelCard } from "./AiModelCard";
import { countRemainingMatches } from "./actions";
import { DEFAULT_SUGGEST_MODEL } from "@/lib/bets/suggest/models";

// The AI generate actions schedule the heavy work via `after()`, so it keeps
// running in this function AFTER the response is sent. With the dossier +
// focused web search a batch can take ~2 minutes (the generator's own loop
// deadline is 110s), so the function must stay alive well past that. 300s is
// the Vercel Pro ceiling; the action returns to the browser immediately and
// the admin is notified when the background run finishes.
export const maxDuration = 300;

// Markets we skip in the suggestions UI:
//   - Match Winner is already covered by the main 1/X/2 bet, so
//     republishing it as a custom bet would duplicate. Two API-Football
//     market IDs alias the same concept (1 and 19); skip both.
//   - Home/Away (no draw) is a Match Winner subset - skip 2 as well.
const SKIPPED_MARKET_IDS = new Set<number>([1, 2, 19]);

// Bilingual labels for the market shapes The Odds API surfaces. Keyed
// by the canonical English name we get from src/lib/the-odds-api.ts so
// the lookup survives wrapper-side relabels. Anything that misses the
// table renders the English string unchanged.
const MARKET_NAME_HE: Record<string, string> = {
  "Match Winner": "מנצח/ת המשחק",
  "Goals Over/Under": "מעל/מתחת לסך שערים",
  "Both Teams to Score": "שתי הקבוצות יבקיעו",
  "Asian Handicap": "הנדיקאפ אסייתי",
};

function localiseMarketName(en: string, isHebrew: boolean): string {
  if (!isHebrew) return en;
  return MARKET_NAME_HE[en] ?? en;
}

// Selection labels for the Hebrew side.
//   - h2h: constants Home/Draw/Away (pinned in aggregateH2H).
//   - totals: "<Over|Under> <point>" strings.
//   - btts: Yes/No.
//   - spreads: "<Home|Away> <signed point>" e.g. "Home -1.5".
function localiseSelectionLabel(
  en: string,
  isHebrew: boolean,
  homeName?: string,
  awayName?: string,
): string {
  if (!isHebrew) return en;
  if (en === "Home") return homeName ?? "בית מנצח";
  if (en === "Away") return awayName ?? "חוץ מנצח";
  if (en === "Draw") return "תיקו";
  if (en === "Yes") return "כן";
  if (en === "No") return "לא";
  // Totals: "Over 2.5" / "Under 2.5".
  const totals = /^(Over|Under)\s+([\d.]+)$/.exec(en.trim());
  if (totals) {
    const verb = totals[1] === "Over" ? "מעל" : "מתחת ל-";
    return `${verb}${totals[2]} שערים`;
  }
  // Spreads: "Home -1.5" / "Away +1.5".
  const spread = /^(Home|Away)\s+([+-]?[\d.]+)$/.exec(en.trim());
  if (spread) {
    const sideHe =
      spread[1] === "Home"
        ? (homeName ?? "בית")
        : (awayName ?? "חוץ");
    return `${sideHe} (${spread[2]})`;
  }
  return en;
}

type SearchSP = { date?: string | string[] };

// Explicit prop typing - this route lives under [lang] so the auto-
// generated AppRoutes typing doesn't always pick it up until after a
// `next build`. Defining the shape here avoids a build-order coupling.
type PageParams = {
  params: Promise<{ lang: string }>;
  searchParams: Promise<SearchSP>;
};

export default async function LiveBetSuggestionsPage({
  params,
  searchParams,
}: PageParams) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const isHebrew = locale === "he";
  const ChevBack = isHebrew ? ChevronRight : ChevronLeft;

  const sp = await searchParams;
  const date = resolveDate(sp.date);

  const [fixtures, oddsConfig, availableDates, templates, aiSettings, remainingMatches] =
    await Promise.all([
      listFixturesForDate(date),
      loadOddsConfig(),
      listLiveBetsDates(),
      listBetTemplates(50),
      loadAiSettings(),
      countRemainingMatches(),
    ]);
  // Split templates by scope so the per-fixture row only shows match
  // templates and the per-day row only shows day templates. Limited to
  // 8 each to keep the chip strip short on mobile.
  const matchTemplates = templates.filter((t) => t.scope === "match").slice(0, 8);
  const dayTemplates = templates.filter((t) => t.scope === "day").slice(0, 8);

  // Resolve odds per fixture. Two-tier strategy:
  //   1. Read from live_odds_snapshot — the cron keeps this fresh
  //      every 6h. Instant, no credit cost.
  //   2. For fixtures the snapshot is missing on, fall back to the
  //      live fetchOddsForMatch wrapper. The wrapper's module-level
  //      cache shares one round-trip across all fallback calls.
  //
  // The "snapshot present" path is the hot path during normal admin
  // sessions; the fallback only matters right after a new fixture
  // lands in the DB or before the first cron run after deploy.
  const oddsByFixture = new Map<string, MarketOdds[] | null>();
  const lastFetchedAt = new Map<string, Date | null>();
  const fixtureIds = fixtures.map((f) => f.id);
  if (fixtureIds.length > 0) {
    const cachedRows = await db
      .select({
        matchId: liveOddsSnapshot.matchId,
        markets: liveOddsSnapshot.markets,
        fetchedAt: liveOddsSnapshot.fetchedAt,
      })
      .from(liveOddsSnapshot)
      .where(inArray(liveOddsSnapshot.matchId, fixtureIds));
    for (const row of cachedRows) {
      oddsByFixture.set(row.matchId, row.markets as MarketOdds[]);
      lastFetchedAt.set(row.matchId, row.fetchedAt);
    }
  }
  await Promise.all(
    fixtures
      .filter((f) => !oddsByFixture.has(f.id))
      .map(async (f) => {
        const markets = await fetchOddsForMatch({
          homeTeamEn: f.homeNameEn,
          awayTeamEn: f.awayNameEn,
          kickoffAt: new Date(f.kickoffAt),
        });
        oddsByFixture.set(f.id, markets);
        lastFetchedAt.set(f.id, markets ? new Date() : null);
      }),
  );

  const apiKeyMissing = !process.env.THE_ODDS_API_KEY;

  return (
    <section className="px-4 md:px-16 py-6 md:py-12 flex flex-col gap-6 md:gap-8 max-w-5xl mx-auto w-full pb-24">
      <header className="flex flex-col gap-3">
        <Link
          href={localePath(locale, "admin/bets")}
          className="inline-flex items-center gap-1 text-sm text-on-surface-variant hover:text-on-surface w-fit"
        >
          <ChevBack className="h-4 w-4" strokeWidth={2} />
          {isHebrew ? "חזרה להימורים" : "Back to bets"}
        </Link>
        <div className="flex flex-col gap-2">
          <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-9 md:text-[40px] md:leading-[44px] font-bold text-primary inline-flex items-center gap-3">
            <Sparkles className="h-6 w-6 md:h-7 md:w-7" strokeWidth={1.75} />
            {isHebrew ? "הצעות הימורי לייב" : "Live-bet suggestions"}
          </h1>
          <p className="text-sm text-on-surface-variant">
            {isHebrew
              ? "אנחנו מושכים את היחסים האמיתיים מ-API-Football, מנרמלים לסקלת הנקודות שלך, ואתה בוחר אילו הימורים לפרסם ליום משחקים."
              : "Pulls live bookmaker odds from API-Football, normalises them to your point scale, and lets you choose which markets to publish for the matchday."}
          </p>
        </div>
      </header>

      <AiModelCard
        currentModelId={aiSettings.suggestModel}
        remainingMatches={remainingMatches}
        autogenEnabled={aiSettings.autogenEnabled}
        autogenLeadHours={aiSettings.autogenLeadHours}
        locale={locale}
      />

      <DatePicker locale={locale} date={date} availableDates={availableDates} />

      {fixtures.length > 0 && <GenerateDayAiButton date={date} locale={locale} />}

      {dayTemplates.length > 0 && (
        <QuickAddRow
          locale={locale}
          title={isHebrew ? "הוספה מהירה ליום" : "Quick add for this day"}
          templates={dayTemplates}
          targetParam={`matchdayDate=${date}`}
        />
      )}

      {apiKeyMissing && (
        <Card className="p-4 md:p-5 bg-error-container text-on-error-container border border-error">
          <p className="text-sm font-bold">
            {isHebrew
              ? "THE_ODDS_API_KEY לא מוגדר"
              : "THE_ODDS_API_KEY is not set"}
          </p>
          <p className="text-xs mt-1">
            {isHebrew
              ? "אי אפשר למשוך יחסים מבוקמייקר עד שהמפתח יוגדר ב-Vercel → Environment Variables. מפתח חינמי ב-the-odds-api.com (500 credits/חודש)."
              : "Bookmaker odds can't be pulled until the key is added in Vercel → Environment Variables. Free key at the-odds-api.com (500 credits / month)."}
          </p>
        </Card>
      )}

      {fixtures.length === 0 ? (
        <Card className="p-6 text-center text-on-surface-variant">
          {isHebrew
            ? "אין משחקים בתאריך הזה."
            : "No fixtures on this date."}
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          {fixtures.map((f) => {
            const homeName = isHebrew ? f.homeNameHe : f.homeNameEn;
            const awayName = isHebrew ? f.awayNameHe : f.awayNameEn;
            const markets = oddsByFixture.get(f.id);
            return (
              <Card key={f.id} className="p-4 md:p-5 flex flex-col gap-4">
                <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="flex items-center gap-2 md:gap-3 flex-1 min-w-0">
                    <Flag code={f.homeCode} size={28} />
                    <span className="text-sm md:text-base font-bold truncate">
                      {homeName}
                    </span>
                    <span className="text-on-surface-variant text-xs md:text-sm px-1">
                      vs
                    </span>
                    <span className="text-sm md:text-base font-bold truncate">
                      {awayName}
                    </span>
                    <Flag code={f.awayCode} size={28} />
                  </div>
                  <div className="flex items-center gap-2">
                    <LabelCaps>
                      {formatDateTime(f.kickoffAt, locale, {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </LabelCaps>
                    <RefreshFixtureButton matchId={f.id} locale={locale} />
                  </div>
                </header>

                <GenerateAiButton matchId={f.id} locale={locale} />

                {matchTemplates.length > 0 && (
                  <QuickAddRow
                    locale={locale}
                    title={isHebrew ? "הוספה מהירה למשחק" : "Quick add for this match"}
                    templates={matchTemplates}
                    targetParam={`matchId=${f.id}`}
                  />
                )}

                {!markets ? (
                  <p className="text-xs text-on-surface-variant">
                    {isHebrew
                      ? "לא הצלחנו למשוך יחסים. בדוק את הלוג או נסה לרענן."
                      : "Couldn't pull odds. Check the log or try refresh."}
                  </p>
                ) : markets.length === 0 ? (
                  <p className="text-xs text-on-surface-variant">
                    {isHebrew
                      ? "אין יחסים זמינים למשחק הזה ב-The Odds API. ייתכן שהבוקמייקרים עוד לא פרסמו, או שיש אי-התאמת שמות נבחרות. אם הבעיה נמשכת — בדוק את הלוג שלא היה matched."
                      : "No odds available for this match at The Odds API yet. Bookmakers may not have priced it, or there is a team-name mismatch. Check the [the-odds-api no event] log if the issue persists."}
                  </p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {markets
                      .filter((m) => !SKIPPED_MARKET_IDS.has(m.marketId))
                      .map((m) => (
                        <MarketGroup
                          key={m.marketId}
                          market={m}
                          locale={locale}
                          matchId={f.id}
                          homeName={homeName}
                          awayName={awayName}
                          oddsConfig={oddsConfig}
                        />
                      ))}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}

// Per-anchor quick-add chip row. Each chip links to /admin/bets/new
// pre-filled with the template + the target match/day, so one tap
// jumps the admin into a draft that's 90% ready — they just review the
// odds + question wording and publish.
function QuickAddRow({
  locale,
  title,
  templates,
  targetParam,
}: {
  locale: Locale;
  title: string;
  templates: BetTemplate[];
  targetParam: string;
}) {
  const isHebrew = locale === "he";
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <LabelCaps>{title}</LabelCaps>
        <Link
          href={localePath(locale, `admin/bets/new${targetParam ? `?${targetParam}` : ""}`)}
          className="text-xs font-bold text-on-surface-variant hover:text-primary"
        >
          {isHebrew ? "הוסף מאפס +" : "From scratch +"}
        </Link>
      </div>
      <div className="flex flex-wrap gap-2">
        {templates.map((t) => (
          <Link
            key={t.id}
            href={localePath(
              locale,
              `admin/bets/new?templateId=${t.id}&${targetParam}`,
            )}
            className="press-down inline-flex items-center gap-1.5 min-h-11 px-3 rounded-full border border-outline bg-surface-container-lowest text-sm font-bold text-on-surface hover:border-primary hover:bg-surface-container max-w-full"
          >
            <Plus className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />
            <span className="truncate">
              {isHebrew ? t.questionHe : t.questionEn}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function DatePicker({
  locale,
  date,
  availableDates,
}: {
  locale: Locale;
  date: string;
  availableDates: Array<{ date: string; fixtureCount: number }>;
}) {
  const isHebrew = locale === "he";
  return (
    <div className="flex flex-col gap-3">
      <form
        method="GET"
        action={localePath(locale, "admin/live-bets/suggestions")}
        className="flex items-end gap-3"
      >
        <div className="flex flex-col gap-1.5 flex-1 max-w-xs">
          <label
            htmlFor="suggestions-date"
            className="font-bold text-sm text-on-surface"
          >
            {isHebrew ? "תאריך" : "Date"}
          </label>
          <input
            id="suggestions-date"
            name="date"
            type="date"
            defaultValue={date}
            className="h-12 px-3 bg-surface-container-lowest border border-outline rounded-lg text-on-surface text-base font-bold tabular-nums focus:outline-none focus:border-primary"
            dir="ltr"
          />
        </div>
        <button
          type="submit"
          className="press-down h-12 px-5 rounded-full bg-primary text-on-primary font-bold text-sm"
        >
          {isHebrew ? "טען" : "Load"}
        </button>
      </form>
      {availableDates.length > 0 && (
        <div className="flex gap-2 overflow-x-auto snap-x snap-mandatory -mx-1 px-1 pb-1">
          {availableDates.map((d) => {
            const active = d.date === date;
            return (
              <Link
                key={d.date}
                href={`${localePath(locale, "admin/live-bets/suggestions")}?date=${d.date}`}
                className={clsx(
                  "snap-start press-down inline-flex flex-col items-center justify-center min-w-[88px] h-12 px-3 rounded-lg border text-xs font-bold tabular-nums",
                  active
                    ? "bg-primary text-on-primary border-primary"
                    : "bg-surface-container-lowest text-on-surface border-outline-variant hover:bg-surface-container",
                )}
              >
                <span>{d.date}</span>
                <span className="opacity-70">
                  {d.fixtureCount} {isHebrew ? "משחקים" : "fx"}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MarketGroup({
  market,
  locale,
  matchId,
  homeName,
  awayName,
  oddsConfig,
}: {
  market: MarketOdds;
  locale: Locale;
  matchId: string;
  homeName: string;
  awayName: string;
  oddsConfig: OddsNormConfig;
}) {
  const isHebrew = locale === "he";
  const marketNameDisplay = localiseMarketName(market.name, isHebrew);
  return (
    <div className="flex flex-col gap-2 p-3 rounded-lg bg-surface-container-low border border-outline-variant">
      <SectionHeading underline="thin" as="h3">
        <span className="inline-flex items-center gap-2">
          <span>{marketNameDisplay}</span>
          <Chip className="text-xs">
            {market.selections.length}{" "}
            {isHebrew ? "אפשרויות" : "options"}
          </Chip>
        </span>
      </SectionHeading>
      {market.selections.length >= 2 ? (
        // Grouped markets (Over/Under at a line, BTTS Yes/No, Handicap
        // Home/Away) publish as ONE multi_choice bet so the friend
        // picks the side rather than seeing both sides as unrelated
        // yes/no rows.
        (() => {
          const options = market.selections.map((sel) => {
            const { stake, payout } = normalizeOdds(sel.decimalOdds, oddsConfig);
            return {
              label: localiseSelectionLabel(sel.label, isHebrew, homeName, awayName),
              decimalOdds: sel.decimalOdds,
              stake,
              payout,
            };
          });
          const { questionHe, questionEn, gradingRuleHe, gradingRuleEn } =
            buildGroupBetCopy({
              marketNameHe: localiseMarketName(market.name, true),
              marketNameEn: market.name,
              homeName,
              awayName,
            });
          return (
            <PublishMarketGroup
              locale={locale}
              matchId={matchId}
              marketName={marketNameDisplay}
              options={options}
              questionHe={questionHe}
              questionEn={questionEn}
              gradingRuleHe={gradingRuleHe}
              gradingRuleEn={gradingRuleEn}
            />
          );
        })()
      ) : (
        <ul className="flex flex-col gap-2">
          {market.selections.map((sel) => {
            const { stake, payout } = normalizeOdds(sel.decimalOdds, oddsConfig);
            const selectionLabelDisplay = localiseSelectionLabel(
              sel.label,
              isHebrew,
              homeName,
              awayName,
            );
            const { questionHe, questionEn, gradingRuleHe, gradingRuleEn } =
              buildBetCopy({
                marketNameHe: localiseMarketName(market.name, true),
                marketNameEn: market.name,
                selectionLabelHe: localiseSelectionLabel(
                  sel.label,
                  true,
                  homeName,
                  awayName,
                ),
                selectionLabelEn: sel.label,
                homeName,
                awayName,
              });
            return (
              <li key={`${market.marketId}-${sel.label}`}>
                <PublishRow
                  locale={locale}
                  matchId={matchId}
                  marketName={marketNameDisplay}
                  selectionLabel={selectionLabelDisplay}
                  decimalOdds={sel.decimalOdds}
                  stake={stake}
                  payout={payout}
                  questionHe={questionHe}
                  questionEn={questionEn}
                  gradingRuleHe={gradingRuleHe}
                  gradingRuleEn={gradingRuleEn}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// Group-shaped bet copy: the question asks WHAT the outcome will be,
// not "yes or no", since the options themselves are the answers in a
// multi_choice bet.
function buildGroupBetCopy({
  marketNameHe,
  marketNameEn,
  homeName,
  awayName,
}: {
  marketNameHe: string;
  marketNameEn: string;
  homeName: string;
  awayName: string;
}): {
  questionHe: string;
  questionEn: string;
  gradingRuleHe: string;
  gradingRuleEn: string;
} {
  const fixtureHe = `${homeName} נגד ${awayName}`;
  const fixtureEn = `${homeName} vs ${awayName}`;
  return {
    questionHe: `${marketNameHe} - ${fixtureHe}`,
    questionEn: `${marketNameEn} - ${fixtureEn}`,
    gradingRuleHe: `התשובה היא האפשרות שעליה השוק "${marketNameHe}" סגר במשחק ${fixtureHe}.`,
    gradingRuleEn: `The answer is the option the market "${marketNameEn}" settled on for ${fixtureEn}.`,
  };
}

// Generate plain-language question + grading rule copy for a market+selection.
// Kept dumb on purpose - the admin can edit the strings inline before
// publishing if a market needs special phrasing. Takes bilingual labels
// so the Hebrew side actually reads as Hebrew and the English side stays
// canonical — previously the same English string was reused on both
// sides, which left Hebrew users reading "Goals Over/Under - Over 2.5"
// even when the page locale was 'he'.
function buildBetCopy({
  marketNameHe,
  marketNameEn,
  selectionLabelHe,
  selectionLabelEn,
  homeName,
  awayName,
}: {
  marketNameHe: string;
  marketNameEn: string;
  selectionLabelHe: string;
  selectionLabelEn: string;
  homeName: string;
  awayName: string;
}): {
  questionHe: string;
  questionEn: string;
  gradingRuleHe: string;
  gradingRuleEn: string;
} {
  const fixtureHe = `${homeName} נגד ${awayName}`;
  const fixtureEn = `${homeName} vs ${awayName}`;
  return {
    questionHe: `${marketNameHe} - ${selectionLabelHe} (${fixtureHe})`,
    questionEn: `${marketNameEn} - ${selectionLabelEn} (${fixtureEn})`,
    gradingRuleHe: `כן אם השוק "${marketNameHe}" סגר על "${selectionLabelHe}" במשחק ${fixtureHe}, אחרת לא.`,
    gradingRuleEn: `Yes if market "${marketNameEn}" settles on "${selectionLabelEn}" for ${fixtureEn}, otherwise no.`,
  };
}

// ---------- data helpers ----------

function resolveDate(raw: string | string[] | undefined): string {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  if (!raw) return today;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : today;
}

async function loadOddsConfig(): Promise<OddsNormConfig> {
  const [s] = await db
    .select({
      baseStake: settings.liveOddsBaseStake,
      maxPayout: settings.liveOddsMaxPayout,
      houseEdgePct: settings.liveOddsHouseEdgePct,
    })
    .from(settings)
    .where(eq(settings.id, 1))
    .limit(1);
  return {
    baseStake: s?.baseStake ?? 3,
    maxPayout: s?.maxPayout ?? 25,
    houseEdgePct: s?.houseEdgePct ?? 5,
  };
}

async function loadAiSettings(): Promise<{
  suggestModel: string;
  autogenEnabled: boolean;
  autogenLeadHours: number;
}> {
  const [s] = await db
    .select({
      suggestModel: settings.suggestModel,
      autogenEnabled: settings.liveAutogenEnabled,
      autogenLeadHours: settings.liveAutogenLeadHours,
    })
    .from(settings)
    .where(eq(settings.id, 1))
    .limit(1);
  return {
    suggestModel: s?.suggestModel ?? DEFAULT_SUGGEST_MODEL,
    autogenEnabled: s?.autogenEnabled ?? false,
    autogenLeadHours: s?.autogenLeadHours ?? 30,
  };
}
