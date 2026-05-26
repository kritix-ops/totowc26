import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { sql } from "drizzle-orm";
import { Calendar, ListChecks } from "lucide-react";
import { getDictionary, hasLocale, type Locale } from "../dictionaries";
import { Card, LabelCaps } from "@/components/ui";
import { PayGateBanner } from "@/components/PayGateBanner";
import { getUser } from "@/lib/supabase/auth";
import { getUserAccess } from "@/lib/access";
import { db } from "@/db";
import { localePath } from "@/lib/paths";
import { QuickPickRow, type QuickPickRowData } from "./QuickPickRow";

// /bets is the quick-fill picks page. One scrollable list of every
// scheduled match across the whole tournament so the user can fill
// scores end-to-end without drilling into /play/[date]/[matchId] for
// each fixture. As new stages unlock (R16, QF, etc.) those fixtures
// flow into the same list automatically because the underlying query
// just asks "every match with status='scheduled' and kickoff_at > now".
//
// /play stays the date-organised hub with live bets, tournament bets,
// and group rankings. /bets is the speed-run alternative.

type GroupedDay = {
  date: string;
  label: string;
  matches: QuickPickRowData[];
};

export default async function QuickBetsPage({
  params,
}: PageProps<"/[lang]/bets">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const dict = await getDictionary(locale);
  const isHebrew = locale === "he";

  const user = await getUser();
  if (!user) redirect(localePath(locale, "login"));
  const access = await getUserAccess(user.id);

  const [matches, lockMinutes] = await Promise.all([
    loadEditableMatches(user.id),
    loadBetLockMinutes(),
  ]);

  // Group by Asia/Jerusalem matchday. Days are already in order from
  // the query.
  const dayFmt = new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Asia/Jerusalem",
  });
  const grouped = new Map<string, GroupedDay>();
  for (const m of matches) {
    const key = m.matchDate;
    if (!grouped.has(key)) {
      grouped.set(key, {
        date: key,
        label: dayFmt.format(new Date(`${key}T12:00:00Z`)),
        matches: [],
      });
    }
    grouped.get(key)!.matches.push(m);
  }
  const days = [...grouped.values()];

  return (
    <section className="px-4 md:px-16 py-6 md:py-12 flex flex-col gap-6 md:gap-8 max-w-3xl mx-auto w-full pb-24">
      <header className="flex flex-col gap-3">
        <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-9 md:text-[40px] md:leading-[44px] font-bold text-primary inline-flex items-center gap-3">
          <ListChecks className="h-6 w-6 md:h-7 md:w-7" strokeWidth={1.75} />
          {dict.quickBets.title}
        </h1>
        <p className="text-sm text-on-surface-variant">
          {dict.quickBets.subtitle}
        </p>
      </header>

      {!access.canEdit && <PayGateBanner locale={locale} dict={dict} />}

      {matches.length === 0 ? (
        <Card className="p-6 text-center text-on-surface-variant">
          {dict.quickBets.empty}
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          {days.map((day) => (
            <section key={day.date} className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-[family-name:var(--font-display)] text-lg md:text-xl font-bold text-on-surface inline-flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-tertiary-fixed-dim" strokeWidth={1.75} />
                  {day.label}
                </h2>
                <LabelCaps>{day.matches.length}</LabelCaps>
              </div>
              <ul className="flex flex-col gap-3">
                {day.matches.map((m) => (
                  <li key={m.id}>
                    <QuickPickRow
                      locale={locale}
                      match={m}
                      lockMinutes={lockMinutes}
                      canEdit={access.canEdit}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <Card className="p-4 md:p-5 text-sm text-on-surface-variant bg-tertiary-fixed text-on-tertiary-fixed-variant border border-tertiary-fixed-dim">
        <p>
          {dict.quickBets.hint}{" "}
          <Link
            href={localePath(locale, "play")}
            className="underline font-bold"
          >
            {isHebrew ? "אל הימורי לייב" : "to the live-bets hub"}
          </Link>
          .
        </p>
      </Card>
    </section>
  );
}

async function loadEditableMatches(userId: string): Promise<QuickPickRowData[]> {
  const rows = await db.execute<QuickPickRowData & {
    match_date: string;
  }>(sql`
    select
      m.id::text                                                        as "id",
      m.home_team                                                       as "homeCode",
      ht.name_he                                                        as "homeNameHe",
      ht.name_en                                                        as "homeNameEn",
      m.away_team                                                       as "awayCode",
      at.name_he                                                        as "awayNameHe",
      at.name_en                                                        as "awayNameEn",
      m.kickoff_at::text                                                as "kickoffAt",
      m.stage::text                                                     as "stage",
      to_char((m.kickoff_at at time zone 'Asia/Jerusalem')::date,
              'YYYY-MM-DD')                                             as "matchDate",
      mb.home_score                                                     as "myHomeScore",
      mb.away_score                                                     as "myAwayScore"
    from public.matches m
    join public.teams ht on ht.code = m.home_team
    join public.teams at on at.code = m.away_team
    left join public.match_bets mb on mb.match_id = m.id and mb.user_id = ${userId}
    where m.status = 'scheduled'
      and m.kickoff_at > now() + interval '5 minutes'
    order by m.kickoff_at asc
    limit 200
  `);
  return rows as unknown as QuickPickRowData[];
}

async function loadBetLockMinutes(): Promise<number> {
  const rows = await db.execute<{ bet_lock_minutes: number }>(sql`
    select bet_lock_minutes from public.settings where id = 1
  `);
  const r = (rows as unknown as Array<{ bet_lock_minutes: number }>)[0];
  return r?.bet_lock_minutes ?? 5;
}
