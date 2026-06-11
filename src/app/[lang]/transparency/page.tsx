import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Eye, X } from "lucide-react";
import { getDictionary, hasLocale, type Locale } from "../dictionaries";
import { Card, Chip } from "@/components/ui";
import { TransparencyTabs } from "@/components/TransparencyTabs";
import { TransparencyList } from "@/components/TransparencyList";
import { getRequestUser } from "@/lib/request-user";
import {
  getTransparencyByQuestion,
  getTransparencyUsers,
  type TransparencyCategory,
} from "@/db/queries";
import { localePath } from "@/lib/paths";
import { gatePage } from "@/lib/page-visibility";

type SearchSP = {
  user?: string | string[];
  tab?: string | string[];
  category?: string | string[]; // legacy alias of `tab`
  date?: string | string[];
};

type PageParams = {
  params: Promise<{ lang: string }>;
  searchParams: Promise<SearchSP>;
};

const CATEGORIES: TransparencyCategory[] = [
  "match",
  "live",
  "tournament",
  "group",
  "duel",
];
const DEFAULT_TAB: TransparencyCategory = "match";

export default async function TransparencyPage({
  params,
  searchParams,
}: PageParams) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  await gatePage("transparency", lang);
  const locale = lang as Locale;
  const dict = await getDictionary(locale);
  const isHebrew = locale === "he";

  const user = await getRequestUser();
  if (!user) redirect(localePath(locale, "login"));

  const sp = await searchParams;
  const rawUser = Array.isArray(sp.user) ? sp.user[0] : sp.user;
  const rawTab = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const rawLegacyCategory = Array.isArray(sp.category)
    ? sp.category[0]
    : sp.category;
  const rawDate = Array.isArray(sp.date) ? sp.date[0] : sp.date;

  const userId =
    rawUser && /^[0-9a-f-]{36}$/i.test(rawUser) ? rawUser : undefined;
  const date =
    rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : undefined;

  // Old links carry `?category=` from the previous flat-feed UI. Map it
  // to the new `?tab=` param so external links (and the dashboard
  // digest "see all" links) keep working until we cycle them out.
  const tabSource = rawTab ?? rawLegacyCategory;
  const tab: TransparencyCategory =
    tabSource && (CATEGORIES as string[]).includes(tabSource)
      ? (tabSource as TransparencyCategory)
      : DEFAULT_TAB;

  // Defensive: this is a public-trust surface that "must always be up".
  // Each data dependency gets its own try/catch with a logged error and
  // a safe default so a single query throw degrades to an empty feed /
  // empty filter list instead of a full-page 500. Mirrors the same
  // pattern already used on /bets/live/[date].
  let rows: Awaited<ReturnType<typeof getTransparencyByQuestion>> = [];
  let users: Awaited<ReturnType<typeof getTransparencyUsers>> = [];
  try {
    rows = await getTransparencyByQuestion({
      tab,
      userId,
      date,
      locale: locale === "he" ? "he" : "en",
    });
  } catch (err) {
    console.error("[transparency] getTransparencyByQuestion threw", {
      tab,
      userId,
      date,
      err,
    });
  }
  try {
    users = await getTransparencyUsers();
  } catch (err) {
    console.error("[transparency] getTransparencyUsers threw", { err });
  }

  const activeFilters = [
    userId
      ? {
          key: "user",
          label: users.find((u) => u.id === userId)?.displayName ?? userId,
        }
      : null,
    date ? { key: "date", label: date } : null,
  ].filter((f): f is { key: string; label: string } => Boolean(f));

  const clearHref = `${localePath(locale, "transparency")}?tab=${tab}`;

  return (
    <section className="px-4 md:px-16 py-6 md:py-12 flex flex-col gap-6 md:gap-8 max-w-3xl mx-auto w-full pb-24">
      <header className="flex flex-col gap-3">
        <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-9 md:text-[40px] md:leading-[44px] font-bold text-primary inline-flex items-center gap-3">
          <Eye className="h-6 w-6 md:h-7 md:w-7" strokeWidth={1.75} />
          {dict.transparency.title}
        </h1>
        <p className="text-sm text-on-surface-variant">
          {dict.transparency.subtitle}
        </p>
      </header>

      <TransparencyTabs
        locale={locale}
        active={tab}
        userId={userId}
        date={date}
      />

      <Card className="p-4 md:p-5 flex flex-col gap-3">
        <form
          method="GET"
          action={localePath(locale, "transparency")}
          className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end"
        >
          {/* Keep the active tab when the user submits the filter form
              so the page does not reset to the default tab on filter. */}
          <input type="hidden" name="tab" value={tab} />
          <label className="flex flex-col gap-1.5 text-xs font-bold text-on-surface">
            {dict.transparency.filterUser}
            <select
              name="user"
              defaultValue={userId ?? ""}
              className="h-12 px-3 rounded-lg border border-outline bg-surface-container-lowest text-sm"
            >
              <option value="">{dict.transparency.filterAny}</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-bold text-on-surface">
            {dict.transparency.filterDate}
            <input
              type="date"
              name="date"
              defaultValue={date ?? ""}
              className="h-12 px-3 rounded-lg border border-outline bg-surface-container-lowest text-sm tabular-nums"
              dir="ltr"
            />
          </label>
          <div className="sm:col-span-2 flex items-center gap-2 flex-wrap">
            <button
              type="submit"
              className="press-down h-10 px-4 rounded-full bg-primary text-on-primary font-bold text-sm"
            >
              {dict.transparency.filterApply}
            </button>
            {activeFilters.length > 0 && (
              <Link
                href={clearHref}
                className="press-down h-10 px-4 inline-flex items-center gap-1.5 rounded-full bg-surface-container-low border border-outline text-on-surface font-bold text-sm"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2.5} />
                {dict.transparency.filterClear}
              </Link>
            )}
          </div>
        </form>

        {activeFilters.length > 0 && (
          <div className="flex flex-wrap gap-2 text-xs text-on-surface-variant">
            {isHebrew ? "מסננים פעילים:" : "Active filters:"}
            {activeFilters.map((f) => (
              <Chip key={f.key} tone="primary">
                {f.label}
              </Chip>
            ))}
          </div>
        )}
      </Card>

      {rows.length === 0 ? (
        <Card className="p-6 text-center text-on-surface-variant">
          {dict.transparency.empty}
        </Card>
      ) : (
        <TransparencyList
          rows={rows}
          tab={tab}
          locale={locale}
          categoryLabel={categoryLabel(tab, dict)}
          stakeLabel={dict.transparency.stakeLabel}
          searchPlaceholder={dict.transparency.searchPlaceholder}
          searchNoResults={dict.transparency.searchNoResults}
        />
      )}
    </section>
  );
}

function categoryLabel(
  category: TransparencyCategory,
  dict: Awaited<ReturnType<typeof getDictionary>>,
): string {
  switch (category) {
    case "match":
      return dict.transparency.categoryMatch;
    case "live":
      return dict.transparency.categoryLive;
    case "tournament":
      return dict.transparency.categoryTournament;
    case "group":
      return dict.transparency.categoryGroup;
    case "duel":
      return dict.transparency.categoryDuel;
  }
}

