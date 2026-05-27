import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight, Languages } from "lucide-react";
import { hasLocale, type Locale } from "../../dictionaries";
import { requireAdmin } from "@/lib/admin";
import { localePath } from "@/lib/paths";
import { Card } from "@/components/ui";
import {
  listPlayersForReview,
  getPlayerReviewCounts,
} from "@/db/admin-queries";
import { PlayerReviewRow } from "./PlayerReviewRow";

// /admin/players — Hebrew translation review queue.
//
// The page is read-only on its own; every edit goes through the
// server actions in ./actions.ts via the PlayerReviewRow client
// component. Rows are sorted by verdict bucket first (reject →
// flag → unreviewed → approved) then by confidence ascending so
// the lowest-trust rows surface near the top.
//
// Until the translation pipeline (PR-3b) runs, this page mostly
// shows unreviewed rows with name_he = NULL. The admin can still
// type a Hebrew name manually for any row right now, which is the
// useful capability this PR ships.

type ReviewVerdict = "all" | "reject" | "flag" | "unreviewed" | "approved";

const VALID_VERDICTS: ReviewVerdict[] = [
  "all",
  "reject",
  "flag",
  "unreviewed",
  "approved",
];

function parseVerdict(raw: string | string[] | undefined): ReviewVerdict {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v && (VALID_VERDICTS as string[]).includes(v)) {
    return v as ReviewVerdict;
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
  await requireAdmin(locale);
  const isHebrew = locale === "he";
  const ChevBack = isHebrew ? ChevronRight : ChevronLeft;

  const sp = await searchParams;
  const verdict = parseVerdict(sp.verdict);

  const [rows, counts] = await Promise.all([
    listPlayersForReview({ verdict, limit: 800 }),
    getPlayerReviewCounts(),
  ]);

  return (
    <section className="px-4 md:px-10 py-6 md:py-10 flex flex-col gap-6 max-w-5xl mx-auto w-full pb-24">
      <header className="flex flex-col gap-3">
        <Link
          href={localePath(locale, "admin")}
          className="inline-flex items-center gap-1 text-sm text-on-surface-variant hover:text-on-surface w-fit"
        >
          <ChevBack className="h-4 w-4" strokeWidth={2} />
          {isHebrew ? "חזרה לניהול" : "Back to admin"}
        </Link>
        <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-9 md:text-[40px] md:leading-[44px] font-bold text-primary inline-flex items-center gap-3">
          <Languages className="h-6 w-6 md:h-7 md:w-7" strokeWidth={1.75} />
          {isHebrew ? "תרגום שחקנים" : "Player translations"}
        </h1>
        <p className="text-sm text-on-surface-variant">
          {isHebrew
            ? "תור סקירה לכל השחקנים בטורניר. השחקנים ממוינים כך שמה שצריך הכי הרבה תשומת לב באדמין נמצא למעלה: דחיות, סימוני בעיה, אחר כך נמוכי ביטחון. עריכה ידנית של שם נועלת את השורה — סנכרון אוטומטי לא ידרוס אותה."
            : "Review queue for every tournament player. Rows are ordered so the items that need admin attention surface first: rejects, then flagged, then low-confidence approved. A manual edit locks the row so future automatic syncs do not stomp it."}
        </p>
      </header>

      <CountsRow locale={locale} counts={counts} currentVerdict={verdict} />

      {rows.length === 0 ? (
        <Card className="p-6 text-center text-on-surface-variant">
          {counts.total === 0
            ? isHebrew
              ? 'אין שחקנים במאגר. הרץ קודם "pnpm run api-football:squads".'
              : "No players yet. Run `pnpm run api-football:squads` first."
            : isHebrew
              ? "אין שורות בקטגוריה הזו."
              : "No rows in this category."}
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <PlayerReviewRow key={row.id} locale={locale} row={row} />
          ))}
        </ul>
      )}
    </section>
  );
}

// Verdict filter chip strip. Five chips: all / reject / flag /
// unreviewed / approved. Each links back to this page with the
// matching ?verdict= query string so the filter is shareable / a
// back-button restores it.
function CountsRow({
  locale,
  counts,
  currentVerdict,
}: {
  locale: Locale;
  counts: {
    reject: number;
    flag: number;
    approved: number;
    unreviewed: number;
    total: number;
  };
  currentVerdict: ReviewVerdict;
}) {
  const isHebrew = locale === "he";
  const items: Array<{
    key: ReviewVerdict;
    labelHe: string;
    labelEn: string;
    n: number;
    tone: "neutral" | "error" | "warn" | "info" | "success";
  }> = [
    { key: "all",         labelHe: "הכל",       labelEn: "All",        n: counts.total,      tone: "neutral" },
    { key: "reject",      labelHe: "דחויים",    labelEn: "Rejected",   n: counts.reject,     tone: "error" },
    { key: "flag",        labelHe: "מסומנים",   labelEn: "Flagged",    n: counts.flag,       tone: "warn" },
    { key: "unreviewed",  labelHe: "טרם נסקרו", labelEn: "Unreviewed", n: counts.unreviewed, tone: "info" },
    { key: "approved",    labelHe: "מאושרים",   labelEn: "Approved",   n: counts.approved,   tone: "success" },
  ];
  return (
    <nav
      aria-label={isHebrew ? "סינון לפי סטטוס" : "Filter by status"}
      className="flex gap-2 overflow-x-auto snap-x snap-mandatory -mx-1 px-1"
    >
      {items.map((it) => {
        const active = it.key === currentVerdict;
        const href =
          it.key === "all"
            ? localePath(locale, "admin/players")
            : `${localePath(locale, "admin/players")}?verdict=${it.key}`;
        const palette = active
          ? activePalette(it.tone)
          : "bg-surface-container-lowest text-on-surface border-outline-variant hover:bg-surface-container";
        return (
          <Link
            key={it.key}
            href={href}
            className={`snap-start press-down inline-flex items-center gap-2 h-10 px-4 rounded-full border text-sm font-bold whitespace-nowrap ${palette}`}
          >
            <span>{isHebrew ? it.labelHe : it.labelEn}</span>
            <span className="tabular-nums opacity-80 bidi-ltr">{it.n}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function activePalette(tone: "neutral" | "error" | "warn" | "info" | "success"): string {
  switch (tone) {
    case "error":   return "bg-error-container text-on-error-container border-error";
    case "warn":    return "bg-tertiary-container text-on-tertiary-container border-tertiary-fixed-dim";
    case "info":    return "bg-primary-container text-on-primary-container border-primary";
    case "success": return "bg-secondary-container text-on-secondary-container border-secondary-fixed";
    case "neutral":
    default:        return "bg-primary text-on-primary border-primary";
  }
}
