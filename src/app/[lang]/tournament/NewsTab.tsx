import Image from "next/image";
import { ExternalLink, Newspaper } from "lucide-react";
import { Card, LabelCaps, SectionHeading } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { getNewsForLocale, type NewsItem, type NewsSource } from "@/lib/news";
import type { Dictionary, Locale } from "../dictionaries";

// Server-rendered news list. Hebrew users get Walla (with Ynet as a
// silent fallback); English users get BBC World Cup. Cache TTL lives on
// the fetch in `@/lib/news`, so this component is just presentation.

export async function NewsTab({
  locale,
  dict,
}: {
  locale: Locale;
  dict: Dictionary;
}) {
  const { items } = await getNewsForLocale(locale);
  const isHebrew = locale === "he";

  if (items.length === 0) {
    return (
      <section className="flex justify-center py-6 md:py-10">
        <Card className="max-w-xl w-full p-8 md:p-10 flex flex-col items-center text-center gap-4">
          <div className="w-14 h-14 rounded-full bg-tertiary-container flex items-center justify-center text-on-tertiary-container">
            <Newspaper className="h-7 w-7" strokeWidth={1.75} />
          </div>
          <h2 className="font-[family-name:var(--font-display)] text-xl md:text-2xl font-bold text-on-surface">
            {dict.tournament.newsEmptyTitle}
          </h2>
          <p className="text-sm md:text-base text-on-surface-variant leading-relaxed">
            {dict.tournament.newsEmptyBody}
          </p>
        </Card>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <SectionHeading as="h2" underline="thin">
        {dict.tournament.newsHeading}
      </SectionHeading>
      <ul className="flex flex-col gap-3 md:gap-4">
        {items.map((item) => (
          <li key={item.id}>
            <NewsCard
              item={item}
              locale={locale}
              dict={dict}
              isHebrew={isHebrew}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function NewsCard({
  item,
  locale,
  dict,
  isHebrew,
}: {
  item: NewsItem;
  locale: Locale;
  dict: Dictionary;
  isHebrew: boolean;
}) {
  const dateLabel = formatDateTime(item.publishedAt, locale, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const sourceLabel = sourceName(item.source, dict);

  return (
    <Card className="overflow-hidden">
      <a
        href={item.link}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${dict.tournament.newsOpenArticleAria}: ${item.title}`}
        className="press-down flex gap-3 md:gap-4 p-3 md:p-4 min-h-[88px] hover:bg-surface-container transition-colors"
      >
        {item.imageUrl ? (
          <div className="relative shrink-0 w-[88px] h-[88px] md:w-[120px] md:h-[120px] rounded-md overflow-hidden bg-surface-variant">
            <Image
              src={item.imageUrl}
              alt=""
              fill
              sizes="(min-width: 768px) 120px, 88px"
              className="object-cover"
              unoptimized
            />
          </div>
        ) : (
          <div className="shrink-0 w-[88px] h-[88px] md:w-[120px] md:h-[120px] rounded-md bg-surface-variant flex items-center justify-center text-on-surface-variant">
            <Newspaper className="h-6 w-6" strokeWidth={1.75} />
          </div>
        )}
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <LabelCaps>{sourceLabel}</LabelCaps>
            <span className="text-on-surface-variant text-xs" aria-hidden>
              ·
            </span>
            <time
              className="text-on-surface-variant text-xs bidi-ltr"
              dateTime={new Date(item.publishedAt).toISOString()}
            >
              {dateLabel}
            </time>
          </div>
          <h3 className="font-bold text-on-surface text-[15px] md:text-base leading-snug">
            {item.title}
          </h3>
          {item.summary && (
            <p className="text-sm text-on-surface-variant leading-relaxed line-clamp-2">
              {item.summary}
            </p>
          )}
          <span className="mt-1 inline-flex items-center gap-1 text-xs text-primary font-bold">
            <span>{isHebrew ? "פתח כתבה" : "Open article"}</span>
            <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} />
          </span>
        </div>
      </a>
    </Card>
  );
}

function sourceName(source: NewsSource, dict: Dictionary): string {
  switch (source) {
    case "walla":
      return dict.tournament.newsSourceWalla;
    case "ynet":
      return dict.tournament.newsSourceYnet;
    case "bbc":
      return dict.tournament.newsSourceBbc;
  }
}
