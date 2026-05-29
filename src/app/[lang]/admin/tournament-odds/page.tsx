import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight, ScrollText } from "lucide-react";
import { hasLocale, type Locale } from "../../dictionaries";
import { Card, LabelCaps } from "@/components/ui";
import { localePath } from "@/lib/paths";
import { formatDateTime } from "@/lib/format";
import { type OutrightSurface } from "@/db/schema";
import {
  loadPublishableBets,
  loadSurfaceCounts,
  loadSurfaceRows,
} from "./actions";
import { SurfaceEditor } from "./SurfaceEditor";

// Admin /tournament-odds editor. One page, one surface visible at a time
// (chosen via query string), full row-edit + publish-to-bet from inside
// the surface view. Mobile-first per the project rules — table collapses
// to stacked cards below md.
//
// Surfaces are listed in priority order (the bets users care about most
// up top: top scorer / champion / golden ball, then placements, then
// groups). Admin clicks one → the page re-renders with that surface's
// rows. Editing is server-action driven so each save round-trips through
// Postgres and the page revalidates.

type SurfaceMeta = {
  key: OutrightSurface;
  labelHe: string;
  labelEn: string;
  optionKind: "player" | "team";
};

const SURFACES: SurfaceMeta[] = [
  { key: "top_scorer",  labelHe: "מלך שערים",         labelEn: "Top scorer",     optionKind: "player" },
  { key: "golden_ball", labelHe: "כדור הזהב",          labelEn: "Golden Ball",    optionKind: "player" },
  { key: "champion",    labelHe: "אלוף המונדיאל",       labelEn: "Champion",       optionKind: "team" },
  { key: "runner_up",   labelHe: "מקום שני",            labelEn: "Runner-up",      optionKind: "team" },
  { key: "third",       labelHe: "מקום שלישי",         labelEn: "Third place",    optionKind: "team" },
  { key: "group_A",     labelHe: "קבוצה A",            labelEn: "Group A",        optionKind: "team" },
  { key: "group_B",     labelHe: "קבוצה B",            labelEn: "Group B",        optionKind: "team" },
  { key: "group_C",     labelHe: "קבוצה C",            labelEn: "Group C",        optionKind: "team" },
  { key: "group_D",     labelHe: "קבוצה D",            labelEn: "Group D",        optionKind: "team" },
  { key: "group_E",     labelHe: "קבוצה E",            labelEn: "Group E",        optionKind: "team" },
  { key: "group_F",     labelHe: "קבוצה F",            labelEn: "Group F",        optionKind: "team" },
  { key: "group_G",     labelHe: "קבוצה G",            labelEn: "Group G",        optionKind: "team" },
  { key: "group_H",     labelHe: "קבוצה H",            labelEn: "Group H",        optionKind: "team" },
  { key: "group_I",     labelHe: "קבוצה I",            labelEn: "Group I",        optionKind: "team" },
  { key: "group_J",     labelHe: "קבוצה J",            labelEn: "Group J",        optionKind: "team" },
  { key: "group_K",     labelHe: "קבוצה K",            labelEn: "Group K",        optionKind: "team" },
  { key: "group_L",     labelHe: "קבוצה L",            labelEn: "Group L",        optionKind: "team" },
];

const SURFACE_KEYS = new Set(SURFACES.map((s) => s.key));

type PageParams = {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ surface?: string | string[] }>;
};

export default async function TournamentOddsPage({
  params,
  searchParams,
}: PageParams) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const isHebrew = locale === "he";
  const ChevBack = isHebrew ? ChevronRight : ChevronLeft;

  const sp = await searchParams;
  const requested = Array.isArray(sp.surface) ? sp.surface[0] : sp.surface;
  const activeKey: OutrightSurface =
    requested && SURFACE_KEYS.has(requested as OutrightSurface)
      ? (requested as OutrightSurface)
      : "top_scorer";

  const [rows, counts, publishableBets] = await Promise.all([
    loadSurfaceRows(activeKey),
    loadSurfaceCounts(),
    loadPublishableBets(),
  ]);

  const activeMeta = SURFACES.find((s) => s.key === activeKey)!;
  const lastFetchedAt =
    rows.length > 0
      ? rows.reduce<Date>((acc, r) => (r.fetchedAt > acc ? r.fetchedAt : acc),
          rows[0].fetchedAt)
      : null;

  return (
    <section className="px-4 md:px-16 py-6 md:py-12 flex flex-col gap-6 md:gap-8 max-w-5xl mx-auto w-full pb-24">
      <header className="flex flex-col gap-3">
        <Link
          href={localePath(locale, "admin")}
          className="inline-flex items-center gap-1 text-sm text-on-surface-variant hover:text-on-surface w-fit"
        >
          <ChevBack className="h-4 w-4" strokeWidth={2} />
          {isHebrew ? "חזרה לאדמין" : "Back to admin"}
        </Link>
        <div className="flex flex-col gap-2">
          <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-9 md:text-[40px] md:leading-[44px] font-bold text-primary inline-flex items-center gap-3">
            <ScrollText className="h-6 w-6 md:h-7 md:w-7" strokeWidth={1.75} />
            {isHebrew ? "יחסי טורניר" : "Tournament odds"}
          </h1>
          <p className="text-sm text-on-surface-variant">
            {isHebrew
              ? "Snapshot של יחסי בוקמייקרים פר אופציה. ייבוא נעשה דרך npm run outright:ingest. עריכה ידנית מוצמדת ב-admin_override. \"פרסם\" משכפל את ה-snapshot ל-payoutOverride של אופציה בהימור פעיל."
              : "Per-option bookmaker snapshot. Import via npm run outright:ingest. Manual edits pin a row with admin_override. Publish writes payoutOverride onto a live bet's options."}
          </p>
        </div>
      </header>

      <SurfacePicker
        locale={locale}
        active={activeKey}
        surfaces={SURFACES}
        counts={counts}
      />

      <Card className="p-4 md:p-5 flex flex-col gap-4">
        <header className="flex flex-col gap-2">
          <h2 className="text-lg md:text-xl font-bold inline-flex items-center gap-2 flex-wrap">
            <span>
              {isHebrew ? activeMeta.labelHe : activeMeta.labelEn}
            </span>
            <LabelCaps>
              {rows.length} {isHebrew ? "שורות" : "rows"}
            </LabelCaps>
            <LabelCaps>
              {activeMeta.optionKind === "player"
                ? isHebrew ? "שחקנים" : "players"
                : isHebrew ? "נבחרות" : "teams"}
            </LabelCaps>
          </h2>
          <p className="text-xs text-on-surface-variant">
            {lastFetchedAt
              ? isHebrew
                ? `נטען לאחרונה: ${formatDateTime(lastFetchedAt, locale, {
                    hour: "2-digit",
                    minute: "2-digit",
                    day: "2-digit",
                    month: "2-digit",
                  })}`
                : `Last fetched: ${formatDateTime(lastFetchedAt, locale, {
                    hour: "2-digit",
                    minute: "2-digit",
                    day: "2-digit",
                    month: "2-digit",
                  })}`
              : isHebrew
                ? "ריק. הרץ ingest כדי למלא."
                : "Empty. Run ingest to populate."}
          </p>
        </header>

        <SurfaceEditor
          locale={locale}
          surface={activeKey}
          rows={rows.map((r) => ({
            id: r.id,
            optionKind: r.optionKind as "player" | "team",
            optionId: r.optionId,
            displayName: r.displayName,
            decimalOdds: Number(r.decimalOdds),
            source: r.source,
            adminOverride: r.adminOverride,
            notes: r.notes ?? "",
          }))}
          publishableBets={publishableBets}
        />
      </Card>
    </section>
  );
}

function SurfacePicker({
  locale,
  active,
  surfaces,
  counts,
}: {
  locale: Locale;
  active: OutrightSurface;
  surfaces: SurfaceMeta[];
  counts: Record<string, number>;
}) {
  const isHebrew = locale === "he";
  return (
    <div className="flex gap-2 overflow-x-auto snap-x snap-mandatory -mx-1 px-1 pb-1">
      {surfaces.map((s) => {
        const isActive = s.key === active;
        const n = counts[s.key] ?? 0;
        return (
          <Link
            key={s.key}
            href={`${localePath(locale, "admin/tournament-odds")}?surface=${s.key}`}
            className={[
              "snap-start press-down inline-flex flex-col items-center justify-center min-w-[112px] h-12 px-3 rounded-lg border text-xs font-bold tabular-nums",
              isActive
                ? "bg-primary text-on-primary border-primary"
                : "bg-surface-container-lowest text-on-surface border-outline-variant hover:bg-surface-container",
            ].join(" ")}
          >
            <span>{isHebrew ? s.labelHe : s.labelEn}</span>
            <span className="opacity-70">
              {n} {isHebrew ? "שורות" : "rows"}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
