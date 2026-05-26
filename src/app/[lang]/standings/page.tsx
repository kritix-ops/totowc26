import { notFound, redirect } from "next/navigation";
import { hasLocale, type Locale, getDictionary } from "../dictionaries";
import { getUser } from "@/lib/supabase/auth";
import { getLiveStandings } from "@/db/queries";
import { localePath } from "@/lib/paths";
import { LiveStandings } from "./LiveStandings";

// Live group-stage standings. The "predict the standings" half of this
// page moved into the custom-bets system — admins author group-scope
// bets at /admin/bets/new and players pick them on /play/groups.

export default async function StandingsPage({
  params,
}: PageProps<"/[lang]/standings">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const dict = await getDictionary(locale);

  const user = await getUser();
  if (!user) redirect(localePath(locale, "login"));

  const liveGroups = await getLiveStandings();

  return (
    <section className="px-4 md:px-16 py-6 md:py-12 flex flex-col gap-8 md:gap-12 max-w-5xl mx-auto w-full">
      <header className="flex flex-col gap-3">
        <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-9 md:text-[48px] md:leading-[52px] font-bold text-primary">
          {dict.standings.title}
        </h1>
        <p className="text-base text-on-surface-variant">{dict.standings.subtitle}</p>
      </header>

      <LiveStandings groups={liveGroups} locale={locale} />
    </section>
  );
}
