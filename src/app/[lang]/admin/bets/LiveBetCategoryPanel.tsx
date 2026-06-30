"use client";

// Read-only odds reference for the admin authoring a NEW live bet. Shows the
// chosen category and how that category has actually paid out historically
// (EV%, hit-rate, sample), so the admin can sanity-check their odds before
// publishing — "offside bets returned -34% over 250 picks, consider a higher
// ratio". Phase 1 of the data-driven-odds work: it NEVER changes the price,
// it only informs. See _plans/2026-06-30-data-driven-live-bet-odds.md.

import {
  LIVE_BET_CATEGORIES,
  liveBetCategoryLabel,
  type LiveBetCategory,
} from "@/lib/bets/live-bet-category";
import type { CategoryStat } from "@/lib/bets/category-history";

// EV below this (percent) is a real drain worth flagging in red; above the
// upper bound the category is notably generous. Between them it reads as
// roughly balanced and stays neutral.
const EV_DRAIN_PCT = -15;
const EV_GENEROUS_PCT = 25;

export function LiveBetCategoryPanel({
  locale,
  category,
  onCategoryChange,
  history,
}: {
  locale: "he" | "en";
  category: LiveBetCategory;
  onCategoryChange: (category: LiveBetCategory) => void;
  history: CategoryStat[];
}) {
  const isHebrew = locale === "he";
  const stat = history.find((s) => s.category === category) ?? null;
  const hasHistory = stat != null && stat.bets > 0 && stat.evPct != null;

  return (
    <div className="flex flex-col gap-3">
      {/* Category picker — pre-filled from the question, admin can override. */}
      <select
        value={category}
        onChange={(e) => onCategoryChange(e.target.value as LiveBetCategory)}
        className="min-h-[48px] w-full px-3 rounded border border-outline bg-surface-container-lowest text-base"
        aria-label={isHebrew ? "קטגוריית ההימור" : "Bet category"}
      >
        {LIVE_BET_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {liveBetCategoryLabel(c, isHebrew ? "he" : "en")}
          </option>
        ))}
      </select>

      {/* Historical reference — only when this category has real data. */}
      {hasHistory ? (
        <CategoryReference stat={stat} isHebrew={isHebrew} />
      ) : (
        <p className="text-sm text-on-surface-variant">
          {isHebrew
            ? "אין מספיק היסטוריה לקטגוריה הזו — תמחר לפי שיקול דעתך."
            : "Not enough history for this category — price it on your judgement."}
        </p>
      )}
    </div>
  );
}

function CategoryReference({
  stat,
  isHebrew,
}: {
  stat: CategoryStat;
  isHebrew: boolean;
}) {
  const ev = stat.evPct ?? 0;
  const isDrain = ev <= EV_DRAIN_PCT;
  const isGenerous = ev >= EV_GENEROUS_PCT;
  const lowSample = !stat.meetsSampleGate;

  const evText = `${ev > 0 ? "+" : ""}${ev.toFixed(1)}%`;
  const hitText =
    stat.hitRate != null ? `${Math.round(stat.hitRate * 100)}%` : "—";

  // Directional steer in plain language. Drain → raise odds; generous → lower
  // odds; otherwise it's roughly fair. Softened when the sample is thin.
  const hint = isDrain
    ? isHebrew
      ? "שחקנים מפסידים כאן. שקול יחס גבוה יותר."
      : "Players lose on this. Consider higher odds."
    : isGenerous
      ? isHebrew
        ? "קטגוריה נדיבה. שקול יחס נמוך יותר."
        : "Generous category. Consider lower odds."
      : isHebrew
        ? "בקירוב מאוזן היסטורית."
        : "Roughly balanced historically.";

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-outline-variant bg-surface-container-lowest p-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-xs font-bold uppercase tracking-wide text-on-surface-variant">
          {isHebrew ? "החזר היסטורי" : "Historical return"}
        </span>
        <span
          dir="ltr"
          className={
            isDrain
              ? "text-lg font-bold tabular-nums text-error"
              : "text-lg font-bold tabular-nums text-on-surface"
          }
        >
          {evText}
        </span>
      </div>

      <p className="text-sm text-on-surface-variant" dir={isHebrew ? "rtl" : "ltr"}>
        {isHebrew ? "פגיעה" : "Hit rate"}{" "}
        <span dir="ltr" className="font-bold tabular-nums text-on-surface">
          {hitText}
        </span>{" "}
        ·{" "}
        <span dir="ltr" className="tabular-nums">
          {stat.bets}
        </span>{" "}
        {isHebrew ? "הימורים" : "bets"} /{" "}
        <span dir="ltr" className="tabular-nums">
          {stat.picks}
        </span>{" "}
        {isHebrew ? "פיקים" : "picks"}
      </p>

      <p
        className={
          isDrain
            ? "text-sm font-medium text-error"
            : "text-sm font-medium text-on-surface"
        }
      >
        {hint}
      </p>

      {lowSample && (
        <p className="text-xs text-on-surface-variant">
          {isHebrew
            ? "מדגם קטן — להתייחס בזהירות."
            : "Small sample — treat with caution."}
        </p>
      )}
    </div>
  );
}
