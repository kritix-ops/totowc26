import { notFound, redirect } from "next/navigation";
import { getDictionary, hasLocale, type Locale } from "../dictionaries";
import { getUser } from "@/lib/supabase/auth";
import { localePath } from "@/lib/paths";
import { TournamentTabs, type TournamentTabKey } from "./TournamentTabs";
import { SummaryTab } from "./SummaryTab";
import { TablesTab } from "./TablesTab";
import { TeamsTab } from "./TeamsTab";
import { NewsTab } from "./NewsTab";

export default async function TournamentPage({
  params,
  searchParams,
}: PageProps<"/[lang]/tournament">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const dict = await getDictionary(locale);

  const user = await getUser();
  if (!user) redirect(localePath(locale, "login"));

  const sp = (await searchParams) ?? {};
  const rawTab = typeof sp.tab === "string" ? sp.tab : null;
  const tab: TournamentTabKey = isTabKey(rawTab) ? rawTab : "summary";
  const isHebrew = locale === "he";

  console.info("[tournament render]", {
    tab,
    rawTab,
    isHebrew,
  });

  const tabSpecs = [
    { key: "summary" as const, label: dict.tournament.tabSummary },
    { key: "tables" as const, label: dict.tournament.tabTables },
    { key: "teams" as const, label: dict.tournament.tabTeams },
    { key: "news" as const, label: dict.tournament.tabNews },
  ];

  return (
    <section className="px-4 md:px-16 py-6 md:py-12 flex flex-col gap-6 md:gap-8 max-w-6xl mx-auto w-full">
      <header className="flex flex-col gap-2">
        <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-9 md:text-[48px] md:leading-[52px] font-bold text-primary">
          {dict.tournament.title}
        </h1>
        <p className="text-sm md:text-base text-on-surface-variant max-w-2xl">
          {dict.tournament.subtitle}
        </p>
      </header>

      <TournamentTabs
        locale={locale}
        tabs={tabSpecs}
        ariaLabel={isHebrew ? "מקטעי אזור מונדיאל" : "Tournament zone sections"}
      />

      <div className="flex flex-col gap-6 md:gap-10">
        {tab === "summary" && <SummaryTab locale={locale} />}
        {tab === "tables" && <TablesTab locale={locale} />}
        {tab === "teams" && <TeamsTab locale={locale} />}
        {tab === "news" && <NewsTab locale={locale} dict={dict} />}
      </div>
    </section>
  );
}

// Inlined rather than importing TOURNAMENT_TABS from TournamentTabs.tsx
// because that module is "use client": non-component exports become client
// reference proxies in RSC bundles, and `.includes` on a proxy throws.
function isTabKey(v: string | null): v is TournamentTabKey {
  return (
    v === "summary" || v === "tables" || v === "teams" || v === "news"
  );
}
