import { notFound, redirect } from "next/navigation";
import { Calendar } from "lucide-react";
import { getDictionary, hasLocale, type Locale } from "../../dictionaries";
import { getUser } from "@/lib/supabase/auth";
import { getFixtureWithBets, getMyBet } from "@/db/queries";
import { Card, LabelCaps } from "@/components/ui";
import { localePath } from "@/lib/paths";
import { formatDateTime } from "@/lib/format";
import { BetForm } from "./BetForm";

export default async function MatchBetPage({
  params,
}: PageProps<"/[lang]/bets/[matchId]">) {
  const { lang, matchId } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const dict = await getDictionary(locale);

  const user = await getUser();
  if (!user) redirect(localePath(locale, "login"));

  const match = await getFixtureWithBets(matchId);
  if (!match) notFound();
  const myBet = await getMyBet(matchId, user.id);

  const isHebrew = locale === "he";
  const homeName = isHebrew ? match.homeNameHe : match.homeNameEn;
  const awayName = isHebrew ? match.awayNameHe : match.awayNameEn;
  const lockable = match.status === "scheduled" && !myBet?.locked;

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
          <Countdown to={match.kickoffAt} />
        </Card>
      </header>

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
          myBet
            ? {
                home: myBet.homeScore,
                away: myBet.awayScore,
                btts: myBet.betBtts,
                over25: myBet.betOver25,
                htHome: myBet.betHtHome,
                htAway: myBet.betHtAway,
              }
            : null
        }
        editable={lockable}
      />

      {!lockable && (
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
