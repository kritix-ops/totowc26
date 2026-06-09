import Link from "next/link";
import { ArrowUpRight, Eye, ListChecks, Sparkles, Trophy, Users, Zap } from "lucide-react";
import { Card, Chip, LabelCaps, SectionHeading } from "@/components/ui";
import type { Locale } from "@/app/[lang]/dictionaries";
import { localePath } from "@/lib/paths";
import {
  fillTemplate,
  isUnanimous,
  votePercent,
} from "@/lib/pool-digest-format";
import type {
  TransparencyCategory,
  TransparencyDigest,
} from "@/db/queries";

// PoolDigestSection — surfaces today's locked picks as a single
// social-proof card on the home dashboard. Sits between the upcoming
// matches strip and the bottom grid; reads digestible aggregates from
// getTransparencyDigest and links into the full /transparency view.
//
// Empty state still renders so the card never silently vanishes once
// the tournament has started; the link to the full feed keeps the
// affordance discoverable even on quiet matchdays.

type Dict = {
  poolDigestTitle: string;
  poolDigestSummary: string;
  poolDigestEmpty: string;
  poolDigestCta: string;
  poolDigestVoteSingle: string;
  poolDigestUnanimous: string;
};

type TransparencyDict = {
  categoryMatch: string;
  categoryLive: string;
  categoryTournament: string;
  categoryGroup: string;
  categoryDuel: string;
};

export function PoolDigestSection({
  locale,
  dict,
  transparencyDict,
  digest,
}: {
  locale: Locale;
  dict: Dict;
  transparencyDict: TransparencyDict;
  digest: TransparencyDigest;
}) {
  const isHebrew = locale === "he";
  const hasActivity = digest.totalPickersToday > 0;
  const transparencyHref =
    localePath(locale, "transparency") + `?date=${digest.date}`;

  return (
    <section
      aria-labelledby="pool-digest-heading"
      className="flex flex-col gap-4 md:gap-6"
    >
      <div className="flex justify-between items-end gap-3">
        <SectionHeading as="h3">
          <span id="pool-digest-heading" className="inline-flex items-center gap-2">
            <Eye className="h-5 w-5 md:h-6 md:w-6" strokeWidth={1.75} />
            {dict.poolDigestTitle}
          </span>
        </SectionHeading>
        <Link
          href={transparencyHref}
          className="font-[family-name:var(--font-label)] text-[12px] font-bold tracking-[0.05em] text-primary hover:underline inline-flex items-center gap-1 min-h-[44px] whitespace-nowrap"
        >
          {dict.poolDigestCta}
          <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2} />
        </Link>
      </div>

      {hasActivity ? (
        <Card className="p-0 overflow-hidden">
          <div className="px-4 md:px-5 py-3 md:py-4 bg-surface-container border-b border-outline-variant flex items-center gap-3 flex-wrap">
            <span className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-primary-fixed text-on-primary-fixed-variant shrink-0">
              <Users className="h-4 w-4" strokeWidth={2} />
            </span>
            <p className="text-sm md:text-base font-bold text-on-surface">
              {fillTemplate(dict.poolDigestSummary, {
                pickers: digest.totalPickersToday,
                questions: digest.totalQuestionsToday,
              })}
            </p>
          </div>
          <ul className="flex flex-col">
            {digest.highlights.map((item, i) => (
              <li
                key={`${item.category}:${i}`}
                className={i > 0 ? "border-t border-outline-variant" : ""}
              >
                <DigestRow
                  item={item}
                  dict={dict}
                  transparencyDict={transparencyDict}
                  isHebrew={isHebrew}
                />
              </li>
            ))}
          </ul>
          <Link
            href={transparencyHref}
            className="press-down flex items-center justify-center gap-1.5 px-4 py-3 min-h-[48px] bg-surface-container-lowest border-t border-outline-variant text-primary font-[family-name:var(--font-label)] text-[12px] font-bold tracking-[0.05em] hover:bg-surface-container transition-colors"
          >
            {dict.poolDigestCta}
            <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2} />
          </Link>
        </Card>
      ) : (
        <Card className="p-6 md:p-7 flex flex-col items-center gap-3 text-center">
          <span className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-surface-variant text-on-surface-variant">
            <ListChecks className="h-5 w-5" strokeWidth={1.75} />
          </span>
          <p className="text-sm text-on-surface-variant max-w-md">
            {dict.poolDigestEmpty}
          </p>
          <Link
            href={transparencyHref}
            className="press-down inline-flex items-center gap-1.5 mt-1 px-4 py-2 rounded-full bg-surface-container-low border border-outline text-on-surface font-bold text-sm hover:bg-surface-container transition-colors"
          >
            {dict.poolDigestCta}
            <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2} />
          </Link>
        </Card>
      )}
    </section>
  );
}

function DigestRow({
  item,
  dict,
  transparencyDict,
  isHebrew,
}: {
  item: TransparencyDigest["highlights"][number];
  dict: Dict;
  transparencyDict: TransparencyDict;
  isHebrew: boolean;
}) {
  const unanimous = isUnanimous(
    item.topPickCount,
    item.totalPickers,
    item.altPickCount,
  );
  return (
    <div className="px-4 md:px-5 py-4 flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="inline-flex items-center justify-center w-9 h-9 rounded-full shrink-0 bg-surface-container"
        >
          <CategoryIcon category={item.category} />
        </span>
        <div className="flex-1 min-w-0 flex flex-col gap-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <Chip tone={categoryTone(item.category)} className="text-[11px] py-0.5">
              {categoryLabel(item.category, transparencyDict)}
            </Chip>
            <LabelCaps className="text-[10px] tracking-[0.04em]">
              {isHebrew ? `${item.totalPickers} משתתפים` : `${item.totalPickers} players`}
            </LabelCaps>
          </div>
          <p className="text-sm md:text-base font-bold text-on-surface leading-snug">
            {item.question}
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-2 ps-12 md:ps-12">
        <VoteRow
          label={item.topPickLabel}
          count={item.topPickCount}
          total={item.totalPickers}
          highlight
          dict={dict}
          unanimousCopy={unanimous ? dict.poolDigestUnanimous : null}
        />
        {item.altPickLabel && item.altPickCount !== null && item.altPickCount > 0 && (
          <VoteRow
            label={item.altPickLabel}
            count={item.altPickCount}
            total={item.totalPickers}
            highlight={false}
            dict={dict}
            unanimousCopy={null}
          />
        )}
      </div>
    </div>
  );
}

function VoteRow({
  label,
  count,
  total,
  highlight,
  dict,
  unanimousCopy,
}: {
  label: string;
  count: number;
  total: number;
  highlight: boolean;
  dict: Dict;
  unanimousCopy: string | null;
}) {
  const pct = votePercent({ count, total });
  const prefix = unanimousCopy
    ? unanimousCopy
    : fillTemplate(dict.poolDigestVoteSingle, { count, total });
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2 text-xs md:text-sm">
        <span className="font-bold text-on-surface truncate">
          {prefix}{" "}
          <span className="text-on-surface-variant font-normal">
            {label}
          </span>
        </span>
        <span className="bidi-ltr font-[family-name:var(--font-display)] text-[14px] font-bold text-surface-tint tabular-nums">
          {pct}%
        </span>
      </div>
      <div
        aria-hidden
        className="h-1.5 w-full rounded-full bg-surface-variant overflow-hidden"
      >
        <div
          className={`h-full rounded-full ${highlight ? "bg-primary" : "bg-surface-tint"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function CategoryIcon({ category }: { category: TransparencyCategory }) {
  const cls = "h-4 w-4 text-surface-tint";
  switch (category) {
    case "match":
      return <ListChecks className={cls} strokeWidth={1.75} />;
    case "live":
      return <Zap className={cls} strokeWidth={1.75} />;
    case "tournament":
      return <Trophy className={cls} strokeWidth={1.75} />;
    case "group":
      return <Users className={cls} strokeWidth={1.75} />;
    case "duel":
      return <Sparkles className={cls} strokeWidth={1.75} />;
  }
}

function categoryLabel(
  category: TransparencyCategory,
  d: TransparencyDict,
): string {
  switch (category) {
    case "match":
      return d.categoryMatch;
    case "live":
      return d.categoryLive;
    case "tournament":
      return d.categoryTournament;
    case "group":
      return d.categoryGroup;
    case "duel":
      return d.categoryDuel;
  }
}

function categoryTone(
  category: TransparencyCategory,
): "default" | "primary" | "secondary" | "warning" {
  switch (category) {
    case "match":
      return "default";
    case "live":
      return "primary";
    case "tournament":
      return "warning";
    case "group":
      return "default";
    case "duel":
      return "secondary";
  }
}

