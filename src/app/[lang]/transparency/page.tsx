import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Eye, X } from "lucide-react";
import { getDictionary, hasLocale, type Locale } from "../dictionaries";
import { Card, Chip } from "@/components/ui";
import { TransparencyTabs } from "@/components/TransparencyTabs";
import { TransparencyModeTabs } from "@/components/TransparencyModeTabs";
import { TransparencyList } from "@/components/TransparencyList";
import { UserHistoryProfile } from "@/components/UserHistoryProfile";
import { HeadToHeadView } from "@/components/HeadToHeadView";
import { getRequestUser } from "@/lib/request-user";
import {
  getSettingsRow,
  getTransparencyByQuestion,
  getTransparencyUsers,
  getUserBetHistory,
  getUserHeadToHead,
  type HeadToHead,
  type TransparencyCategory,
  type UserBetHistory,
} from "@/db/queries";
import { localePath } from "@/lib/paths";
import { gatePage } from "@/lib/page-visibility";

type SearchSP = {
  user?: string | string[];
  tab?: string | string[];
  category?: string | string[]; // legacy alias of `tab`
  date?: string | string[];
  view?: string | string[]; // "questions" (default) | "player"
  vs?: string | string[]; // second user id for head-to-head
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
const UUID_RE = /^[0-9a-f-]{36}$/i;

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
  const dbLocale = locale === "he" ? "he" : "en";

  const user = await getRequestUser();
  if (!user) redirect(localePath(locale, "login"));

  const sp = await searchParams;
  const first = (v: string | string[] | undefined) =>
    Array.isArray(v) ? v[0] : v;
  const rawUser = first(sp.user);
  const rawTab = first(sp.tab);
  const rawLegacyCategory = first(sp.category);
  const rawDate = first(sp.date);
  const rawView = first(sp.view);
  const rawVs = first(sp.vs);

  const userId = rawUser && UUID_RE.test(rawUser) ? rawUser : undefined;
  const vsId = rawVs && UUID_RE.test(rawVs) ? rawVs : undefined;
  const date =
    rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : undefined;

  const tabSource = rawTab ?? rawLegacyCategory;
  const tab: TransparencyCategory =
    tabSource && (CATEGORIES as string[]).includes(tabSource)
      ? (tabSource as TransparencyCategory)
      : DEFAULT_TAB;

  // The per-user "Player history" mode is admin-gated. When off, the mode
  // tab is hidden and any ?view=player link falls back to the feed.
  let historyEnabled = true;
  try {
    const settingsRow = await getSettingsRow();
    historyEnabled = settingsRow?.transparencyHistoryEnabled ?? true;
  } catch (err) {
    console.error("[transparency] getSettingsRow threw", { err });
  }
  const view: "questions" | "player" =
    rawView === "player" && historyEnabled ? "player" : "questions";

  // The user list powers both the feed filter and the history picker, so
  // it loads in either mode. Defensive: this is a "must always be up"
  // public-trust surface, so a query throw degrades to an empty list.
  let users: Awaited<ReturnType<typeof getTransparencyUsers>> = [];
  try {
    users = await getTransparencyUsers();
  } catch (err) {
    console.error("[transparency] getTransparencyUsers threw", { err });
  }
  const nameOf = (id: string) =>
    users.find((u) => u.id === id)?.displayName ?? id;

  const header = (
    <header className="flex flex-col gap-3">
      <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-9 md:text-[40px] md:leading-[44px] font-bold text-primary inline-flex items-center gap-3">
        <Eye className="h-6 w-6 md:h-7 md:w-7" strokeWidth={1.75} />
        {dict.transparency.title}
      </h1>
      <p className="text-sm text-on-surface-variant">
        {dict.transparency.subtitle}
      </p>
    </header>
  );

  const modeTabs = (
    <TransparencyModeTabs
      locale={locale}
      active={view}
      userId={userId}
      tab={tab}
      showPlayerHistory={historyEnabled}
      labels={{
        byQuestion: dict.transparency.modeByQuestion,
        playerHistory: dict.transparency.modePlayerHistory,
      }}
    />
  );

  // ---------------- Player history mode ----------------
  if (view === "player") {
    const t = dict.transparency;
    const selfCompare = Boolean(vsId && vsId === userId);

    let history: UserBetHistory | null = null;
    let head: HeadToHead | null = null;
    if (userId) {
      if (vsId && vsId !== userId) {
        try {
          head = await getUserHeadToHead(userId, vsId, dbLocale);
        } catch (err) {
          console.error("[transparency] getUserHeadToHead threw", {
            userId,
            vsId,
            err,
          });
        }
      } else {
        try {
          history = await getUserBetHistory(userId, dbLocale);
        } catch (err) {
          console.error("[transparency] getUserBetHistory threw", {
            userId,
            err,
          });
        }
      }
    }

    const base = localePath(locale, "transparency");
    return (
      <section className="px-4 md:px-16 py-6 md:py-12 flex flex-col gap-6 md:gap-8 max-w-3xl mx-auto w-full pb-24">
        {header}
        {modeTabs}

        <Card className="p-4 md:p-5 flex flex-col gap-3">
          <form
            method="GET"
            action={base}
            className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end"
          >
            <input type="hidden" name="view" value="player" />
            <label className="flex flex-col gap-1.5 text-xs font-bold text-on-surface">
              {t.filterUser}
              <select
                name="user"
                defaultValue={userId ?? ""}
                className="h-12 px-3 rounded-lg border border-outline bg-surface-container-lowest text-sm"
              >
                <option value="">{t.pickAUser}</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-xs font-bold text-on-surface">
              {t.compareWith}
              <select
                name="vs"
                defaultValue={vsId ?? ""}
                className="h-12 px-3 rounded-lg border border-outline bg-surface-container-lowest text-sm"
              >
                <option value="">{t.compareNone}</option>
                {users
                  .filter((u) => u.id !== userId)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.displayName}
                    </option>
                  ))}
              </select>
            </label>
            <div className="sm:col-span-2">
              <button
                type="submit"
                className="press-down h-10 px-4 rounded-full bg-primary text-on-primary font-bold text-sm"
              >
                {t.filterApply}
              </button>
            </div>
          </form>
        </Card>

        {selfCompare && (
          <Card className="p-4 text-center text-sm text-on-surface-variant">
            {t.selfCompareNote}
          </Card>
        )}

        {!userId ? (
          <Card className="p-6 text-center text-on-surface-variant">
            {t.pickAUser}
          </Card>
        ) : head ? (
          <HeadToHeadView locale={locale} dict={dict} data={head} />
        ) : history ? (
          <UserHistoryProfile
            locale={locale}
            dict={dict}
            name={nameOf(userId)}
            rows={history.rows}
            summary={history.summary}
          />
        ) : (
          <Card className="p-6 text-center text-on-surface-variant">
            {t.historyEmpty}
          </Card>
        )}
      </section>
    );
  }

  // ---------------- By-question feed (default) ----------------
  let rows: Awaited<ReturnType<typeof getTransparencyByQuestion>> = [];
  try {
    rows = await getTransparencyByQuestion({
      tab,
      userId,
      date,
      locale: dbLocale,
    });
  } catch (err) {
    console.error("[transparency] getTransparencyByQuestion threw", {
      tab,
      userId,
      date,
      err,
    });
  }

  const activeFilters = [
    userId ? { key: "user", label: nameOf(userId) } : null,
    date ? { key: "date", label: date } : null,
  ].filter((f): f is { key: string; label: string } => Boolean(f));

  const clearHref = `${localePath(locale, "transparency")}?tab=${tab}`;

  return (
    <section className="px-4 md:px-16 py-6 md:py-12 flex flex-col gap-6 md:gap-8 max-w-3xl mx-auto w-full pb-24">
      {header}
      {modeTabs}

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
