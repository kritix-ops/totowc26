import { notFound, redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { Calendar } from "lucide-react";
import { getDictionary, hasLocale, type Locale } from "../../dictionaries";
import { getRequestUser } from "@/lib/request-user";
import { getUserAccess } from "@/lib/access";
import { getFixtureWithBets, getMyBet } from "@/db/queries";
import { db } from "@/db";
import type { StageKey } from "@/db/schema";
import { Card, LabelCaps } from "@/components/ui";
import { PayGateBanner } from "@/components/PayGateBanner";
import { LocksInCountdown } from "@/components/LocksInCountdown";
import { localePath } from "@/lib/paths";
import { formatDateTime } from "@/lib/format";
import {
  getDeadlineContext,
  resolveMatchScoreLock,
} from "@/lib/deadlines";
import { BetForm } from "./BetForm";

export default async function MatchBetPage({
  params,
}: PageProps<"/[lang]/bets/[matchId]">) {
  const { lang, matchId } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const dict = await getDictionary(locale);

  const user = await getRequestUser();
  if (!user) redirect(localePath(locale, "login"));

  const match = await getFixtureWithBets(matchId);
  if (!match) notFound();
  const [myBet, access, context, anchorRow] = await Promise.all([
    getMyBet(matchId, user.id),
    getUserAccess(user.id),
    getDeadlineContext(),
    db.execute<{
      lock_at_override: string | null;
      matchday_offset: number | null;
    }>(sql`
      select
        m.lock_at_override,
        md.lock_offset_override_minutes as matchday_offset
      from public.matches m
      left join public.matchdays md
        on md.date = (m.kickoff_at at time zone 'Asia/Jerusalem')::date
      where m.id = ${matchId}::uuid
      limit 1
    `),
  ]);

  const isHebrew = locale === "he";
  const homeName = isHebrew ? match.homeNameHe : match.homeNameEn;
  const awayName = isHebrew ? match.awayNameHe : match.awayNameEn;
  const a = (anchorRow as unknown as Array<{
    lock_at_override: string | null;
    matchday_offset: number | null;
  }>)[0];
  const resolvedLock = resolveMatchScoreLock(
    {
      matchId: match.id,
      kickoffAt: new Date(match.kickoffAt),
      // FixtureRow.stage is typed `string` (loose loader shape) but the
      // DB-side enum constrains the actual values to StageKey, so the
      // cast is safe.
      stage: match.stage as StageKey,
      lockAtOverride: a?.lock_at_override ? new Date(a.lock_at_override) : null,
      matchdayLockOffsetMinutes: a?.matchday_offset ?? null,
    },
    context,
  );
  // Server component runs once per request; reading the wall clock to
  // gate the form is intentional. Same pattern as the Countdown helper
  // below. The lint rule targets client components.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const lockable =
    match.status === "scheduled" &&
    !myBet?.locked &&
    access.canEdit &&
    resolvedLock.effectiveLockAt.getTime() > now;

  return (
    <section className="px-4 md:px-16 py-6 md:py-12 flex flex-col gap-8 md:gap-12 max-w-5xl mx-auto w-full">
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 md:gap-6">
        <div className="flex flex-col gap-2 min-w-0">
          <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-9 md:text-[48px] md:leading-[52px] font-bold text-on-surface">
            {homeName}{" "}
            <span className="text-on-surface-variant">{isHebrew ? "נגד" : "vs"}</span>{" "}
            {awayName}
          </h1>
          <p className="text-base md:text-lg text-on-surface-variant inline-flex items-center gap-2">
            <Calendar className="h-5 w-5 text-primary shrink-0" strokeWidth={1.75} />
            {match.stage === "group" && match.groupId
              ? `${dict.standings.group} ${match.groupId}`
              : match.stage}
            <span className="text-outline">·</span>
            <span className="text-sm">
              {formatDateTime(match.kickoffAt, locale, {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </p>
        </div>
        <Card className="px-4 py-3 inline-flex items-center gap-3 self-start md:self-auto">
          <LabelCaps>{dict.common.locksIn}</LabelCaps>
          <Countdown to={resolvedLock.effectiveLockAt.toISOString()} />
          <LocksInCountdown
            locale={locale}
            lockAt={resolvedLock.effectiveLockAt.toISOString()}
            variant="inline"
          />
        </Card>
      </header>

      {!access.canEdit && <PayGateBanner locale={locale} dict={dict} />}

      <BetForm
        locale={locale}
        dict={dict}
        match={{
          id: match.id,
          homeCode: match.homeCode,
          homeName,
          awayCode: match.awayCode,
          awayName,
        }}
        initialBet={
          myBet ? { home: myBet.homeScore, away: myBet.awayScore } : null
        }
        editable={lockable}
      />

      {!lockable && access.canEdit && (
        <Card className="p-4 text-center text-on-surface-variant">
          {match.status === "final"
            ? isHebrew ? "המשחק הסתיים. ההימור נסגר." : "Match is final. Bet is locked."
            : isHebrew ? "ההימור נסגר. לא ניתן לערוך." : "Bet is locked."}
        </Card>
      )}
    </section>
  );
}

function Countdown({ to }: { to: string }) {
  const t = new Date(to).getTime();
  // Server component renders once per request; reading the wall clock is
  // intentional. The lint rule targets client components, where it would
  // cause hydration mismatches.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const diff = Math.max(0, t - now);
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const s = Math.floor((diff % 60_000) / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    <span className="font-[family-name:var(--font-score)] text-[20px] md:text-[24px] leading-none font-bold text-on-surface bidi-ltr">
      {pad(h)}:{pad(m)}:{pad(s)}
    </span>
  );
}
