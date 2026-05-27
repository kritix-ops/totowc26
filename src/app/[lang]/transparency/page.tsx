import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Eye, X } from "lucide-react";
import { clsx } from "clsx";
import { getDictionary, hasLocale, type Locale } from "../dictionaries";
import { Card, Chip, LabelCaps } from "@/components/ui";
import { getRequestUser } from "@/lib/request-user";
import {
  getTransparencyFeed,
  getTransparencyUsers,
  type TransparencyCategory,
} from "@/db/queries";
import { localePath } from "@/lib/paths";
import { formatDateTime } from "@/lib/format";
import { gatePage } from "@/lib/page-visibility";

type SearchSP = {
  user?: string | string[];
  category?: string | string[];
  date?: string | string[];
};

type PageParams = {
  params: Promise<{ lang: string }>;
  searchParams: Promise<SearchSP>;
};

const CATEGORIES: TransparencyCategory[] = ["match", "live", "duel"];

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
  const rawCategory = Array.isArray(sp.category) ? sp.category[0] : sp.category;
  const rawDate = Array.isArray(sp.date) ? sp.date[0] : sp.date;

  const userId = rawUser && /^[0-9a-f-]{36}$/i.test(rawUser) ? rawUser : undefined;
  const category =
    rawCategory && (CATEGORIES as string[]).includes(rawCategory)
      ? (rawCategory as TransparencyCategory)
      : undefined;
  const date = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : undefined;

  const [feed, users] = await Promise.all([
    getTransparencyFeed({
      userId,
      category,
      date,
      locale: locale === "he" ? "he" : "en",
    }),
    getTransparencyUsers(),
  ]);

  const activeFilters = [
    userId
      ? {
          key: "user",
          label: users.find((u) => u.id === userId)?.displayName ?? userId,
        }
      : null,
    category
      ? { key: "category", label: categoryLabel(category, dict) }
      : null,
    date ? { key: "date", label: date } : null,
  ].filter((f): f is { key: string; label: string } => Boolean(f));

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

      <Card className="p-4 md:p-5 flex flex-col gap-3">
        <form
          method="GET"
          action={localePath(locale, "transparency")}
          className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end"
        >
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
            {dict.transparency.filterCategory}
            <select
              name="category"
              defaultValue={category ?? ""}
              className="h-12 px-3 rounded-lg border border-outline bg-surface-container-lowest text-sm"
            >
              <option value="">{dict.transparency.filterAny}</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {categoryLabel(c, dict)}
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
          <div className="sm:col-span-3 flex items-center gap-2 flex-wrap">
            <button
              type="submit"
              className="press-down h-10 px-4 rounded-full bg-primary text-on-primary font-bold text-sm"
            >
              {dict.transparency.filterApply}
            </button>
            {activeFilters.length > 0 && (
              <Link
                href={localePath(locale, "transparency")}
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

      {feed.length === 0 ? (
        <Card className="p-6 text-center text-on-surface-variant">
          {dict.transparency.empty}
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {feed.map((row) => (
            <li key={`${row.category}:${row.bookId}`}>
              <Card className="p-3 md:p-4 flex items-center gap-3">
                <Chip tone={categoryTone(row.category)} className="shrink-0">
                  {categoryLabel(row.category, dict)}
                </Chip>
                <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                  <span className="text-sm md:text-base font-bold text-on-surface truncate">
                    {row.displayName}
                  </span>
                  <span className="text-xs text-on-surface-variant truncate">
                    {row.question}
                  </span>
                  <div className="flex items-center gap-3 text-[11px] text-on-surface-variant">
                    <span className="font-bold">
                      {dict.transparency.pickedLabel}: {row.pickLabel}
                    </span>
                    {row.stake > 0 && (
                      <span className="bidi-ltr">
                        {dict.transparency.stakeLabel}: {row.stake}
                      </span>
                    )}
                    <span>
                      {formatDateTime(row.eventTime, locale, {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                </div>
                <div className="text-end shrink-0 flex flex-col items-end gap-0.5">
                  {row.pointsEarned !== null && (
                    <span
                      className={clsx(
                        "font-[family-name:var(--font-score)] text-lg leading-none font-bold tabular-nums",
                        row.pointsEarned > 0
                          ? "text-secondary"
                          : row.pointsEarned < 0
                            ? "text-error"
                            : "text-on-surface",
                      )}
                    >
                      <bdi>
                        {row.pointsEarned > 0 ? "+" : ""}
                        {row.pointsEarned}
                      </bdi>
                    </span>
                  )}
                  <LabelCaps as="div">{row.status}</LabelCaps>
                </div>
              </Card>
            </li>
          ))}
        </ul>
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
    case "duel":
      return dict.transparency.categoryDuel;
  }
}

function categoryTone(
  category: TransparencyCategory,
): "primary" | "default" | "secondary" | "warning" {
  switch (category) {
    case "match":
      return "default";
    case "live":
      return "primary";
    case "duel":
      return "secondary";
  }
}
