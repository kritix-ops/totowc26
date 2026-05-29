import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import { clsx } from "clsx";
import { hasLocale, type Locale } from "../../../dictionaries";
import { Card, Chip, LabelCaps, SectionHeading } from "@/components/ui";
import { Flag } from "@/components/Flag";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { listFixturesForDate, listLiveBetsDates } from "@/db/admin-queries";
import { localePath } from "@/lib/paths";
import { formatDateTime } from "@/lib/format";
import { fetchOddsForMatch, type MarketOdds } from "@/lib/odds";
import {
  normalizeOdds,
  type OddsNormConfig,
} from "@/lib/odds-normalize";
import { PublishRow } from "./PublishRow";
import { RefreshFixtureButton } from "./RefreshFixtureButton";

// Markets we skip in the suggestions UI:
//   - Match Winner is already covered by the main 1/X/2 bet, so
//     republishing it as a custom bet would duplicate. Two API-Football
//     market IDs alias the same concept (1 and 19); skip both.
//   - Home/Away (no draw) is a Match Winner subset - skip 2 as well.
const SKIPPED_MARKET_IDS = new Set<number>([1, 2, 19]);

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

  const [fixtures, oddsConfig, availableDates] = await Promise.all([
    listFixturesForDate(date),
    loadOddsConfig(),
    listLiveBetsDates(),
  ]);

  // Resolve odds for every fixture in parallel. fetchOddsForMatch
  // already swallows errors (returns null), so a single bad fixture
  // can't poison the whole page. Under the hood the wrapper fetches
  // the entire WC board once and shares it across these calls — see
  // src/lib/the-odds-api.ts.
  const oddsByFixture = new Map<string, MarketOdds[] | null>();
  await Promise.all(
    fixtures.map(async (f) => {
      const markets = await fetchOddsForMatch({
        homeTeamEn: f.homeNameEn,
        awayTeamEn: f.awayNameEn,
        kickoffAt: new Date(f.kickoffAt),
      });
      oddsByFixture.set(f.id, markets);
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

      <DatePicker locale={locale} date={date} availableDates={availableDates} />

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
  return (
    <div className="flex flex-col gap-2 p-3 rounded-lg bg-surface-container-low border border-outline-variant">
      <SectionHeading underline="thin" as="h3">
        <span className="inline-flex items-center gap-2">
          <span>{market.name}</span>
          <Chip className="text-xs">
            {market.selections.length}{" "}
            {isHebrew ? "אפשרויות" : "options"}
          </Chip>
        </span>
      </SectionHeading>
      <ul className="flex flex-col gap-2">
        {market.selections.map((sel) => {
          const { stake, payout } = normalizeOdds(sel.decimalOdds, oddsConfig);
          const { questionHe, questionEn, gradingRuleHe, gradingRuleEn } =
            buildBetCopy({
              marketName: market.name,
              selectionLabel: sel.label,
              homeName,
              awayName,
            });
          return (
            <li key={`${market.marketId}-${sel.label}`}>
              <PublishRow
                locale={locale}
                matchId={matchId}
                marketName={market.name}
                selectionLabel={sel.label}
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
    </div>
  );
}

// Generate plain-language question + grading rule copy for a market+selection.
// Kept dumb on purpose - the admin can edit the strings inline before
// publishing if a market needs special phrasing.
function buildBetCopy({
  marketName,
  selectionLabel,
  homeName,
  awayName,
}: {
  marketName: string;
  selectionLabel: string;
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
    questionHe: `${marketName} - ${selectionLabel} (${fixtureHe})`,
    questionEn: `${marketName} - ${selectionLabel} (${fixtureEn})`,
    gradingRuleHe: `כן אם השוק "${marketName}" סגר על "${selectionLabel}" במשחק ${fixtureHe}, אחרת לא.`,
    gradingRuleEn: `Yes if market "${marketName}" settles on "${selectionLabel}" for ${fixtureEn}, otherwise no.`,
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
