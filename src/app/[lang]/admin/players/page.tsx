import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight, Languages } from "lucide-react";
import { hasLocale, type Locale } from "../../dictionaries";
import { localePath } from "@/lib/paths";
import { listPlayersForReview } from "@/db/admin-queries";
import { PlayerReviewBoard } from "./PlayerReviewBoard";
import type { PlayerVerdictKey } from "./player-filters";

// /admin/players — Hebrew translation review queue.
//
// Page is a thin server wrapper: it fetches every player row in one
// query and hands the list to the client board. All filter logic
// (search, verdict, team, source, position, lock) runs client-side
// for instant feedback and dynamic per-dimension counts. See
// _plans/2026-05-28-admin-players-filters.md.
//
// `?verdict=` is still honoured as an initial-state hint so existing
// bookmarks keep working; subsequent filter changes do not push back
// to the URL.

const VALID_VERDICTS: PlayerVerdictKey[] = [
  "all",
  "reject",
  "flag",
  "unreviewed",
  "approved",
];

function parseVerdict(raw: string | string[] | undefined): PlayerVerdictKey {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v && (VALID_VERDICTS as string[]).includes(v)) {
    return v as PlayerVerdictKey;
  }
  return "all";
}

export default async function AdminPlayersPage({
  params,
  searchParams,
}: PageProps<"/[lang]/admin/players">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const isHebrew = locale === "he";
  const ChevBack = isHebrew ? ChevronRight : ChevronLeft;

  const sp = await searchParams;
  const initialVerdict = parseVerdict(sp.verdict);

  // Load the whole queue once. The board does the filtering / sort /
  // count math in the browser. Cap = 2000 keeps the query bounded
  // even if a future sync somehow loads more than the 1,357 we
  // expect.
  const rows = await listPlayersForReview({ verdict: "all", limit: 2000 });

  return (
    <section className="px-4 md:px-10 py-6 md:py-10 flex flex-col gap-6 max-w-5xl mx-auto w-full pb-24">
      <header className="flex flex-col gap-3">
        <Link
          href={localePath(locale, "admin")}
          className="inline-flex items-center gap-1 text-sm text-on-surface-variant hover:text-on-surface w-fit"
        >
          <ChevBack className="h-4 w-4" strokeWidth={2} />
          {isHebrew ? "חזרה לדף הניהול" : "Back to admin"}
        </Link>
        <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-9 md:text-[40px] md:leading-[44px] font-bold text-primary inline-flex items-center gap-3">
          <Languages className="h-6 w-6 md:h-7 md:w-7" strokeWidth={1.75} />
          {isHebrew ? "תרגום שחקנים" : "Player translations"}
        </h1>
        <p className="text-sm text-on-surface-variant">
          {isHebrew
            ? "תור סקירה לכל השחקנים בטורניר. חיפוש חכם, פילטרים לכל פרמטר, ספירה דינמית לכל קטגוריה. עריכה ידנית של שם נועלת את השורה - סנכרון אוטומטי לא ידרוס אותה."
            : "Review queue for every tournament player. Smart search, filters across every parameter, dynamic per-bucket counts. A manual edit locks the row so future automatic syncs do not stomp it."}
        </p>
      </header>

      <PlayerReviewBoard
        locale={locale}
        initialVerdict={initialVerdict}
        rows={rows}
      />
    </section>
  );
}
