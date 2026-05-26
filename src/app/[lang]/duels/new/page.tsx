import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getDictionary, hasLocale, type Locale } from "../../dictionaries";
import { getUser } from "@/lib/supabase/auth";
import { getUserAccess } from "@/lib/access";
import { getBankBalance } from "@/lib/bank";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { localePath } from "@/lib/paths";
import { NewDuelForm } from "./NewDuelForm";

type PageParams = {
  params: Promise<{ lang: string }>;
};

type FixtureOption = {
  id: string;
  label: string;        // "HOME vs AWAY · Sun 14 Jun 21:00"
  kickoffAt: string;
};

type MatchdayOption = {
  date: string;
  label: string;        // "Sun 14 Jun"
  fixtureCount: number;
};

export default async function NewDuelPage({ params }: PageParams) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const dict = await getDictionary(locale);
  const isHebrew = locale === "he";
  const Chev = isHebrew ? ChevronLeft : ChevronRight;

  const user = await getUser();
  if (!user) redirect(localePath(locale, "login"));
  const access = await getUserAccess(user.id);
  if (!access.canEdit) redirect(localePath(locale, "duels"));

  const [
    [config],
    balance,
    upcomingMatches,
    upcomingMatchdays,
  ] = await Promise.all([
    db
      .select({
        duelMaxStake: settings.duelMaxStake,
        duelDefaultJoinWindowHours: settings.duelDefaultJoinWindowHours,
      })
      .from(settings)
      .where(eq(settings.id, 1)),
    getBankBalance(user.id),
    loadUpcomingFixtures(locale),
    loadUpcomingMatchdays(locale),
  ]);

  const duelMaxStake = config?.duelMaxStake ?? 5;
  const defaultJoinWindow = config?.duelDefaultJoinWindowHours ?? 24;

  return (
    <section className="px-4 md:px-16 py-6 md:py-12 flex flex-col gap-6 md:gap-8 max-w-3xl mx-auto w-full pb-24">
      <header className="flex flex-col gap-2">
        <Link
          href={localePath(locale, "duels")}
          className="inline-flex items-center gap-1 text-sm text-on-surface-variant hover:text-on-surface w-fit"
        >
          <Chev className="h-4 w-4" strokeWidth={2} />
          {dict.duels.title}
        </Link>
        <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-9 md:text-[40px] md:leading-[44px] font-bold text-primary">
          {dict.duels.newTitle}
        </h1>
      </header>

      <NewDuelForm
        locale={locale}
        balance={balance}
        duelMaxStake={duelMaxStake}
        defaultJoinWindow={defaultJoinWindow}
        upcomingMatches={upcomingMatches}
        upcomingMatchdays={upcomingMatchdays}
      />
    </section>
  );
}

async function loadUpcomingFixtures(locale: Locale): Promise<FixtureOption[]> {
  const rows = await db.execute<{
    id: string;
    homeCode: string;
    awayCode: string;
    kickoff_at: string;
  }>(sql`
    select
      m.id::text         as "id",
      m.home_team        as "homeCode",
      m.away_team        as "awayCode",
      m.kickoff_at::text as "kickoff_at"
    from public.matches m
    where m.status = 'scheduled'
      and m.kickoff_at > now() + interval '5 minutes'
    order by m.kickoff_at asc
    limit 50
  `);
  const list = rows as unknown as Array<{
    id: string;
    homeCode: string;
    awayCode: string;
    kickoff_at: string;
  }>;
  const fmt = new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jerusalem",
  });
  return list.map((r) => ({
    id: r.id,
    label: `${r.homeCode} vs ${r.awayCode} · ${fmt.format(new Date(r.kickoff_at))}`,
    kickoffAt: r.kickoff_at,
  }));
}

async function loadUpcomingMatchdays(locale: Locale): Promise<MatchdayOption[]> {
  const rows = await db.execute<{ date: string; fixture_count: number }>(sql`
    select
      to_char((m.kickoff_at at time zone 'Asia/Jerusalem')::date, 'YYYY-MM-DD') as "date",
      count(*)::int                                                              as "fixture_count"
    from public.matches m
    where m.status = 'scheduled'
      and m.kickoff_at > now() + interval '5 minutes'
    group by (m.kickoff_at at time zone 'Asia/Jerusalem')::date
    order by 1 asc
    limit 30
  `);
  const list = rows as unknown as Array<{ date: string; fixture_count: number }>;
  const fmt = new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Asia/Jerusalem",
  });
  return list.map((r) => ({
    date: r.date,
    label: fmt.format(new Date(`${r.date}T12:00:00Z`)),
    fixtureCount: r.fixture_count,
  }));
}
