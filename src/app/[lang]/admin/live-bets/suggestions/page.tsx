import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { ChevronLeft, ChevronRight, Plus, Sparkles } from "lucide-react";
import { clsx } from "clsx";
import { hasLocale, type Locale } from "../../../dictionaries";
import { Card, LabelCaps } from "@/components/ui";
import { Flag } from "@/components/Flag";
import { db } from "@/db";
import { settings } from "@/db/schema";
import {
  listBetTemplates,
  listFixturesForDate,
  listLiveBetsDates,
  type BetTemplate,
} from "@/db/admin-queries";
import { localePath } from "@/lib/paths";
import { formatDateTime } from "@/lib/format";
import { GenerateAiButton } from "./GenerateAiButton";
import { GenerateDayAiButton } from "./GenerateDayAiButton";
import { AiModelCard } from "./AiModelCard";
import { GenerationLog } from "./GenerationLog";
import { PromptEditor } from "./PromptEditor";
import {
  countRemainingMatches,
  getPromptInfo,
  listRecentGenRuns,
} from "./actions";
import { DEFAULT_SUGGEST_MODEL } from "@/lib/bets/suggest/models";

// The AI generate actions schedule the heavy work via `after()`, so it keeps
// running in this function AFTER the response is sent. With the dossier +
// focused web search a batch can take ~2 minutes (the generator's own loop
// deadline is 110s), so the function must stay alive well past that. 300s is
// the Vercel Pro ceiling; the action returns to the browser immediately and
// the admin is notified when the background run finishes.
export const maxDuration = 300;

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

  const [
    fixtures,
    availableDates,
    templates,
    aiSettings,
    remainingMatches,
    recentRuns,
    promptInfo,
  ] = await Promise.all([
    listFixturesForDate(date),
    listLiveBetsDates(),
    listBetTemplates(50),
    loadAiSettings(),
    countRemainingMatches(),
    listRecentGenRuns(12),
    getPromptInfo(),
  ]);
  // Split templates by scope so the per-fixture row only shows match
  // templates and the per-day row only shows day templates. Limited to
  // 8 each to keep the chip strip short on mobile.
  const matchTemplates = templates.filter((t) => t.scope === "match").slice(0, 8);
  const dayTemplates = templates.filter((t) => t.scope === "day").slice(0, 8);

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
              ? "ה-AI מנסח הצעות להימורי לייב למשחק בודד או ליום שלם. בוחרים משחק, מבקשים הצעות, והן נוחתות כטיוטות לעריכה ופרסום."
              : "The AI drafts live-bet ideas for a single match or a whole matchday. Pick a fixture, ask for suggestions, and they land as drafts you can edit and publish."}
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

      <GenerationLog initialRuns={recentRuns} locale={locale} />

      {promptInfo.ok && (
        <PromptEditor scopes={promptInfo.scopes} locale={locale} />
      )}

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
                  <LabelCaps>
                    {formatDateTime(f.kickoffAt, locale, {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </LabelCaps>
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
