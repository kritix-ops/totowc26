import { Newspaper } from "lucide-react";
import { Card, SectionHeading } from "@/components/ui";
import { loadNewsArchivePage, type NewsArchivePage } from "@/lib/news-read";
import type { Dictionary, Locale } from "../dictionaries";
import { NewsList, type NewsListStrings } from "./NewsList";
import { settle } from "./safe";

// Server wrapper. Loads the first page of the news archive from the DB
// (no live RSS fetch — the /api/cron/news job populates the table every
// 30 minutes). When the table is empty (cron has not run yet or the
// tournament has not started) we render the existing empty card and
// skip mounting the client list at all, so there's no flash of an
// unused date picker.
//
// All scrolling-back-through-history happens in <NewsList/> via the
// `/api/news` keyset endpoint. The server fetch here is just the
// initial latest-20 so the page is interactive on first paint.

const INITIAL_LIMIT = 20;

export async function NewsTab({
  locale,
  dict,
}: {
  locale: Locale;
  dict: Dictionary;
}) {
  const lang: "he" | "en" = locale === "he" ? "he" : "en";
  const initial = await settle<NewsArchivePage>(
    "news",
    { items: [], nextCursor: null },
    () => loadNewsArchivePage({ lang, limit: INITIAL_LIMIT }),
  );

  console.info("[news render]", {
    locale,
    initialCount: initial.items.length,
    hasMore: initial.nextCursor !== null,
  });

  if (initial.items.length === 0) {
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

  const strings: NewsListStrings = {
    heading: dict.tournament.newsHeading,
    openArticleAria: dict.tournament.newsOpenArticleAria,
    openArticle: dict.tournament.newsOpenArticleLabel,
    sourceWalla: dict.tournament.newsSourceWalla,
    sourceYnet: dict.tournament.newsSourceYnet,
    sourceBbc: dict.tournament.newsSourceBbc,
    filterByDateLabel: dict.tournament.newsFilterByDateLabel,
    clearDate: dict.tournament.newsClearDateAria,
    loadingMore: dict.tournament.newsLoadingMore,
    noMore: dict.tournament.newsEndOfArchive,
    noItemsForDate: dict.tournament.newsNoItemsForDate,
    errorTitle: dict.tournament.newsErrorTitle,
    errorRetry: dict.tournament.newsErrorRetry,
  };

  return (
    <section className="flex flex-col gap-4">
      <SectionHeading as="h2" underline="thin">
        {dict.tournament.newsHeading}
      </SectionHeading>
      <NewsList
        locale={locale}
        lang={lang}
        initialItems={initial.items}
        initialCursor={initial.nextCursor}
        strings={strings}
      />
    </section>
  );
}
