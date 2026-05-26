import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Check, X } from "lucide-react";
import { clsx } from "clsx";
import { getDictionary, hasLocale, type Locale } from "../../dictionaries";
import { getUser } from "@/lib/supabase/auth";
import {
  getFixtureWithBets,
  getMatchBets,
  getMyBet,
  getHeadToHead,
} from "@/db/queries";
import { localePath } from "@/lib/paths";
import { Card, Chip, LabelCaps, ScoreDigit, SectionHeading } from "@/components/ui";
import { Flag } from "@/components/Flag";
import { HeadToHead } from "./HeadToHead";

export default async function MatchDetailPage({
  params,
}: PageProps<"/[lang]/match/[matchId]">) {
  const { lang, matchId } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const dict = await getDictionary(locale);

  const user = await getUser();
  if (!user) redirect(localePath(locale, "login"));

  const match = await getFixtureWithBets(matchId);
  if (!match) notFound();
  const [myBet, friendBets, h2h] = await Promise.all([
    getMyBet(matchId, user.id),
    getMatchBets(matchId, user.id),
    getHeadToHead(match.homeCode, match.awayCode),
  ]);

  const isHebrew = locale === "he";
  const homeName = isHebrew ? match.homeNameHe : match.homeNameEn;
  const awayName = isHebrew ? match.awayNameHe : match.awayNameEn;
  const isFinal = match.status === "final" && match.homeScore !== null && match.awayScore !== null;
  const exact =
    isFinal &&
    myBet &&
    match.homeScore === myBet.homeScore &&
    match.awayScore === myBet.awayScore;
  const earned = myBet?.pointsEarned ?? 0;

  const statusLabel =
    match.status === "final"
      ? dict.matchDetail.final
      : match.status === "live"
        ? dict.matchDetail.live
        : dict.matchDetail.scheduled;

  return (
    <section className="px-4 md:px-16 py-6 md:py-12 flex flex-col gap-8 md:gap-10 max-w-3xl mx-auto w-full">
      <Card className="overflow-hidden p-0">
        <div className="p-6 md:p-8 bg-surface-container border-b-4 border-surface-tint text-center">
          <Chip tone={match.status === "final" ? "primary" : "default"} className="mb-6">
            {statusLabel}
          </Chip>
          <div className="flex justify-center items-end gap-6 md:gap-8">
            <Link
              href={localePath(locale, `teams/${match.homeCode}`)}
              className="press-down flex flex-col items-center gap-2 md:gap-3 -mx-2 px-2 py-1 rounded-lg hover:bg-surface-container-low transition-colors"
            >
              <Flag code={match.homeCode} size={48} />
              <span className="text-base md:text-lg text-on-surface-variant">{homeName}</span>
              <ScoreDigit value={match.homeScore ?? "-"} dark />
            </Link>
            <span className="text-2xl text-on-surface-variant mb-3">:</span>
            <Link
              href={localePath(locale, `teams/${match.awayCode}`)}
              className="press-down flex flex-col items-center gap-2 md:gap-3 -mx-2 px-2 py-1 rounded-lg hover:bg-surface-container-low transition-colors"
            >
              <Flag code={match.awayCode} size={48} />
              <span className="text-base md:text-lg text-on-surface-variant">{awayName}</span>
              <ScoreDigit value={match.awayScore ?? "-"} dark />
            </Link>
          </div>
        </div>
        <div className="p-5 md:p-6 flex flex-col gap-4 bg-[#FBF6EB]">
          <div className="flex justify-between items-center">
            <LabelCaps>{dict.matchDetail.yourBet}</LabelCaps>
            <span className="font-[family-name:var(--font-score)] text-2xl md:text-3xl font-bold text-on-surface bidi-ltr">
              {myBet ? `${myBet.homeScore} - ${myBet.awayScore}` : "-"}
            </span>
          </div>
          <div className="border-t border-outline-variant pt-4 flex justify-between items-end gap-3">
            <div className="flex flex-col gap-2 min-w-0">
              {isFinal && myBet ? (
                <Chip tone={exact ? "secondary" : earned > 0 ? "default" : "default"}>
                  +{earned} {dict.common.points}
                  {exact && <span className="ms-1">· {isHebrew ? "מדויק" : "exact"}</span>}
                </Chip>
              ) : (
                <LabelCaps>
                  {myBet
                    ? isHebrew ? "ממתין לסיום" : "Awaiting result"
                    : isHebrew ? "לא הוזן הימור" : "No bet placed"}
                </LabelCaps>
              )}
            </div>
            <div className="text-end">
              <LabelCaps as="div" className="mb-1">{dict.matchDetail.earned}</LabelCaps>
              <span
                className={`font-[family-name:var(--font-display)] text-3xl md:text-4xl leading-none font-bold ${
                  earned > 0 ? "text-secondary" : "text-on-surface-variant"
                } bidi-ltr`}
              >
                +{earned}
              </span>
            </div>
          </div>
        </div>
      </Card>

      <section className="flex flex-col gap-4">
        <SectionHeading>{dict.matchDetail.friendsBets}</SectionHeading>
        {friendBets.length === 0 ? (
          <Card className="p-6 text-center text-on-surface-variant">
            {isHebrew ? "אין הימורים על המשחק הזה עדיין" : "No bets placed on this match yet"}
          </Card>
        ) : (
          <ul className="flex flex-col gap-2">
            {friendBets.map((fb) => {
              const fbExact =
                isFinal &&
                fb.homeScore === match.homeScore &&
                fb.awayScore === match.awayScore;
              return (
                <li
                  key={fb.userId}
                  className={clsx(
                    "flex items-center gap-3 md:gap-4 p-3 md:p-4 rounded-lg border transition-colors",
                    fb.isYou
                      ? "border-primary bg-primary-fixed"
                      : fbExact
                        ? "border-secondary bg-secondary-container"
                        : "border-outline-variant bg-surface-container-lowest",
                  )}
                >
                  <div
                    className="w-9 h-9 md:w-10 md:h-10 rounded-full bg-surface-variant flex items-center justify-center font-bold text-on-surface shrink-0"
                    aria-hidden
                  >
                    {fb.displayName.charAt(0)}
                  </div>
                  <span className="flex-1 font-bold text-sm md:text-base truncate">
                    {fb.isYou ? dict.leaderboard.you : fb.displayName}
                  </span>
                  <span className="font-[family-name:var(--font-score)] text-base md:text-xl font-bold text-on-surface bidi-ltr">
                    {fb.homeScore} - {fb.awayScore}
                  </span>
                  {isFinal &&
                    (fbExact ? (
                      <Check className="h-5 w-5 text-secondary shrink-0" strokeWidth={2} />
                    ) : (
                      <X className="h-5 w-5 text-outline shrink-0" strokeWidth={2} />
                    ))}
                  <span className="font-[family-name:var(--font-label)] text-xs md:text-sm font-bold text-on-surface-variant bidi-ltr w-10 md:w-12 text-end">
                    +{fb.pointsEarned ?? 0}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <HeadToHead
        locale={locale}
        matches={h2h}
        currentMatchId={match.id}
        homeName={homeName}
        awayName={awayName}
        homeCode={match.homeCode}
        awayCode={match.awayCode}
      />

      <section className="flex flex-col gap-3">
        <SectionHeading underline="thin">{dict.matchDetail.reactions}</SectionHeading>
        <div className="flex gap-2 flex-wrap">
          {["🔥", "👏", "😱", "💀", "🐐", "🤝"].map((e) => (
            <button
              key={e}
              type="button"
              className="press-down min-h-[48px] min-w-[48px] text-2xl px-3 py-2 rounded-full bg-surface-container-lowest border border-outline-variant hover:bg-surface-container transition-colors"
            >
              {e}
            </button>
          ))}
        </div>
      </section>
    </section>
  );
}
