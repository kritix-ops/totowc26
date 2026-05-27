import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  Check,
  X,
  Goal,
  Square,
  Repeat2,
  Star,
  Sparkles,
} from "lucide-react";
import { clsx } from "clsx";
import { getDictionary, hasLocale, type Locale } from "../../dictionaries";
import { getRequestUser } from "@/lib/request-user";
import {
  getFixtureWithBets,
  getMatchBets,
  getMyBet,
  getHeadToHead,
} from "@/db/queries";
import { getMatchEnrichment, getMatchPrediction } from "@/lib/stats";
import type {
  ApiMatchEvent,
  ApiLineup,
  ApiMatchDetails,
  ApiPrediction,
} from "@/lib/api-football-data";
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

  const user = await getRequestUser();
  if (!user) redirect(localePath(locale, "login"));

  const match = await getFixtureWithBets(matchId);
  if (!match) notFound();
  const [myBet, friendBets, h2h, enrichment, prediction] = await Promise.all([
    getMyBet(matchId, user.id),
    getMatchBets(matchId, user.id),
    getHeadToHead(match.homeCode, match.awayCode),
    getMatchEnrichment(matchId),
    // Predictions only useful before kickoff; skip for final matches.
    match.status === "final" ? Promise.resolve(null) : getMatchPrediction(matchId),
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

      {prediction && (
        <PredictionCard
          prediction={prediction}
          homeName={homeName}
          awayName={awayName}
          isHebrew={isHebrew}
        />
      )}

      {enrichment && enrichment.events.length > 0 && (
        <MatchEvents
          events={enrichment.events}
          homeTeamApiId={enrichment.lineups[0]?.teamApiId ?? null}
          isHebrew={isHebrew}
        />
      )}

      {enrichment && enrichment.lineups.length === 2 && (
        <Lineups lineups={enrichment.lineups} isHebrew={isHebrew} />
      )}

      {enrichment && enrichment.playerRatings.length > 0 && (
        <PlayerRatings
          ratings={enrichment.playerRatings}
          isHebrew={isHebrew}
        />
      )}

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

// ---------- Enrichment sub-components ----------

// Vertical timeline of goals, cards and substitutions. Minute on the left,
// player + detail on the right. Home team events tint primary, away tint
// tertiary so the eye can scan by side without reading the team name.
function MatchEvents({
  events,
  homeTeamApiId,
  isHebrew,
}: {
  events: ApiMatchEvent[];
  homeTeamApiId: number | null;
  isHebrew: boolean;
}) {
  return (
    <section className="flex flex-col gap-3">
      <SectionHeading as="h2" underline="thin">
        {isHebrew ? "אירועי המשחק" : "Match events"}
      </SectionHeading>
      <Card className="p-0 overflow-hidden">
        <ol className="flex flex-col">
          {events.map((e, i) => {
            const isHome = homeTeamApiId === e.teamApiId;
            const icon = pickEventIcon(e);
            const minuteLabel = e.extraMinute
              ? `${e.minute}+${e.extraMinute}'`
              : `${e.minute}'`;
            return (
              <li
                key={`${e.minute}-${e.player}-${i}`}
                className={`flex items-center gap-3 px-4 py-3 min-h-[52px] ${
                  i > 0 ? "border-t border-outline-variant" : ""
                } ${isHome ? "bg-primary-fixed/30" : "bg-tertiary-container/20"}`}
              >
                <span className="font-[family-name:var(--font-label)] text-[11px] font-bold tracking-[0.05em] text-on-surface-variant w-10 bidi-ltr">
                  {minuteLabel}
                </span>
                {icon}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-on-surface truncate">
                    {e.player}
                  </div>
                  <div className="text-xs text-on-surface-variant truncate">
                    {e.detail}
                  </div>
                </div>
                <LabelCaps>{e.teamName}</LabelCaps>
              </li>
            );
          })}
        </ol>
      </Card>
    </section>
  );
}

function pickEventIcon(e: ApiMatchEvent) {
  if (e.type === "Goal") {
    return <Goal className="h-4 w-4 text-secondary shrink-0" strokeWidth={2} />;
  }
  if (e.type === "Card") {
    const red = e.detail.toLowerCase().includes("red");
    return (
      <span
        className={`inline-block w-3 h-4 rounded-[2px] shrink-0 ${
          red ? "bg-error" : "bg-yellow-400"
        }`}
        aria-hidden
      />
    );
  }
  if (e.type === "subst") {
    return <Repeat2 className="h-4 w-4 text-on-surface-variant shrink-0" strokeWidth={2} />;
  }
  return <Square className="h-4 w-4 text-on-surface-variant shrink-0" strokeWidth={2} />;
}

// Side-by-side starting XI per team. Each column lists the formation
// string plus a stacked list of players (jersey + name).
function Lineups({
  lineups,
  isHebrew,
}: {
  lineups: ApiLineup[];
  isHebrew: boolean;
}) {
  const [home, away] = lineups;
  return (
    <section className="flex flex-col gap-3">
      <SectionHeading as="h2" underline="thin">
        {isHebrew ? "הרכבים" : "Lineups"}
      </SectionHeading>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <LineupColumn lineup={home} isHebrew={isHebrew} />
        <LineupColumn lineup={away} isHebrew={isHebrew} />
      </div>
    </section>
  );
}

function LineupColumn({
  lineup,
  isHebrew,
}: {
  lineup: ApiLineup;
  isHebrew: boolean;
}) {
  return (
    <Card className="p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold text-sm text-on-surface truncate">
          {lineup.teamName}
        </span>
        <LabelCaps>{lineup.formation}</LabelCaps>
      </div>
      <ol className="flex flex-col gap-1">
        {lineup.startXI.map((p) => (
          <li
            key={p.apiId}
            className="flex items-center gap-2 py-1 text-sm text-on-surface"
          >
            <span className="font-[family-name:var(--font-label)] w-6 text-center text-on-surface-variant bidi-ltr">
              {p.number ?? "-"}
            </span>
            <span className="truncate flex-1">{p.name}</span>
            <LabelCaps>{p.position}</LabelCaps>
          </li>
        ))}
      </ol>
      {lineup.substitutes.length > 0 && (
        <details className="text-xs text-on-surface-variant mt-1">
          <summary className="cursor-pointer min-h-[28px] flex items-center">
            {isHebrew ? "ספסל" : "Subs"} ({lineup.substitutes.length})
          </summary>
          <ul className="flex flex-col gap-0.5 mt-2 ps-1">
            {lineup.substitutes.map((p) => (
              <li key={p.apiId} className="truncate">
                <bdi>#{p.number ?? "-"}</bdi> {p.name}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

// Player ratings 0-10. Coloured pill by rating band. Only players with a
// rating are shown (subs that never came on don't get rated).
function PlayerRatings({
  ratings,
  isHebrew,
}: {
  ratings: ApiMatchDetails["playerRatings"];
  isHebrew: boolean;
}) {
  const rated = ratings.filter((r) => r.rating != null);
  if (rated.length === 0) return null;
  // Group by team. The first team in the list is home (matches lineups order).
  const teams = Array.from(
    new Map(rated.map((r) => [r.teamApiId, r.teamName])).entries(),
  );
  return (
    <section className="flex flex-col gap-3">
      <SectionHeading as="h2" underline="thin">
        <span className="inline-flex items-center gap-2">
          <Star className="h-5 w-5 text-tertiary-fixed-dim" strokeWidth={1.75} />
          {isHebrew ? "ציוני שחקנים" : "Player ratings"}
        </span>
      </SectionHeading>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {teams.map(([teamId, teamName]) => {
          const teamRatings = rated
            .filter((r) => r.teamApiId === teamId)
            .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
          return (
            <Card key={teamId} className="p-4 flex flex-col gap-2">
              <div className="font-bold text-sm text-on-surface mb-1">
                {teamName}
              </div>
              <ol className="flex flex-col gap-1">
                {teamRatings.slice(0, 11).map((r) => (
                  <li
                    key={r.apiId}
                    className="flex items-center gap-2 py-1 text-sm"
                  >
                    <RatingPill value={r.rating ?? 0} />
                    <span className="flex-1 min-w-0 truncate text-on-surface">
                      {r.captain && (
                        <span className="me-1 inline-block px-1 rounded-sm bg-tertiary-fixed-dim text-[9px] font-bold text-on-tertiary-fixed bidi-ltr align-middle">
                          C
                        </span>
                      )}
                      {r.name}
                    </span>
                    {r.goals > 0 && (
                      <span className="inline-flex items-center gap-0.5 text-xs text-secondary font-bold bidi-ltr">
                        <Goal className="h-3 w-3" strokeWidth={2} />
                        {r.goals}
                      </span>
                    )}
                    {r.yellow > 0 && (
                      <span
                        className="inline-block w-2.5 h-3 bg-yellow-400 rounded-[1px]"
                        aria-hidden
                      />
                    )}
                    {r.red > 0 && (
                      <span
                        className="inline-block w-2.5 h-3 bg-error rounded-[1px]"
                        aria-hidden
                      />
                    )}
                  </li>
                ))}
              </ol>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

// Pre-match AI prediction card. Surfaces API-Football's model output
// (probabilities + suggested score). We label it as an "AI suggestion"
// to keep expectations honest - this never enters scoring.
function PredictionCard({
  prediction,
  homeName,
  awayName,
  isHebrew,
}: {
  prediction: ApiPrediction;
  homeName: string;
  awayName: string;
  isHebrew: boolean;
}) {
  const pct = (p: number): string => `${Math.round(p * 100)}%`;
  const score = prediction.predictedScoreHome && prediction.predictedScoreAway
    ? `${prediction.predictedScoreHome} - ${prediction.predictedScoreAway}`
    : null;
  return (
    <section className="flex flex-col gap-3">
      <SectionHeading as="h2" underline="thin">
        <span className="inline-flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-tertiary-fixed-dim" strokeWidth={1.75} />
          {isHebrew ? "תחזית AI" : "AI suggestion"}
        </span>
      </SectionHeading>
      <Card className="p-5 flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-2">
          <ProbabilityBlock
            label={homeName}
            valueText={pct(prediction.probHome)}
            value={prediction.probHome}
            tone="primary"
          />
          <ProbabilityBlock
            label={isHebrew ? "תיקו" : "Draw"}
            valueText={pct(prediction.probDraw)}
            value={prediction.probDraw}
            tone="neutral"
          />
          <ProbabilityBlock
            label={awayName}
            valueText={pct(prediction.probAway)}
            value={prediction.probAway}
            tone="primary"
          />
        </div>
        {(score || prediction.advice) && (
          <div className="border-t border-outline-variant pt-3 flex items-end justify-between gap-3">
            {prediction.advice && (
              <div className="flex flex-col min-w-0 flex-1">
                <LabelCaps>{isHebrew ? "המלצה" : "Advice"}</LabelCaps>
                <span className="text-sm font-bold text-on-surface truncate">
                  {prediction.advice}
                </span>
              </div>
            )}
            {score && (
              <div className="text-end shrink-0">
                <LabelCaps as="div" className="mb-1">
                  {isHebrew ? "צפי" : "Predicted"}
                </LabelCaps>
                <span className="font-[family-name:var(--font-score)] text-2xl leading-none font-bold text-surface-tint bidi-ltr">
                  {score}
                </span>
              </div>
            )}
          </div>
        )}
        <p className="text-[11px] text-on-surface-variant text-center">
          {isHebrew
            ? "תחזית האלגוריתם של API-Football. לא נכנס לחישוב הניקוד."
            : "Predicted by API-Football's model. Never feeds scoring."}
        </p>
      </Card>
    </section>
  );
}

function ProbabilityBlock({
  label,
  value,
  valueText,
  tone,
}: {
  label: string;
  value: number;
  valueText: string;
  tone: "primary" | "neutral";
}) {
  const bar =
    tone === "primary" ? "bg-primary" : "bg-surface-variant";
  return (
    <div className="flex flex-col items-center gap-1.5 text-center">
      <span className="font-[family-name:var(--font-display)] text-2xl leading-none font-bold text-on-surface bidi-ltr">
        {valueText}
      </span>
      <div className="w-full h-1.5 rounded-full bg-surface-container overflow-hidden">
        <div
          className={`h-full ${bar} transition-all`}
          style={{ width: `${Math.max(2, Math.round(value * 100))}%` }}
        />
      </div>
      <LabelCaps>{label}</LabelCaps>
    </div>
  );
}

function RatingPill({ value }: { value: number }) {
  const tone =
    value >= 8 ? "bg-secondary text-on-secondary"
    : value >= 7 ? "bg-primary-fixed text-on-primary-fixed"
    : value >= 6 ? "bg-surface-variant text-on-surface-variant"
    : "bg-error/20 text-error";
  return (
    <span
      className={`inline-flex items-center justify-center w-9 h-6 rounded font-[family-name:var(--font-display)] text-xs font-bold bidi-ltr shrink-0 ${tone}`}
    >
      {value.toFixed(1)}
    </span>
  );
}
