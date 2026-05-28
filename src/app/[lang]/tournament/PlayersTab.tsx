import Image from "next/image";
import { Goal, Square, Star } from "lucide-react";
import { Card, SectionHeading } from "@/components/ui";
import { Flag } from "@/components/Flag";
import {
  getLiveTopScorers,
  getLiveTopAssists,
  getLiveTopYellowCards,
  type LiveScorer,
  type LiveAssister,
  type LiveCardLeader,
} from "@/lib/stats";
import type { Dictionary, Locale } from "../dictionaries";

// Players tab - one stop for top scorers, top assists, and discipline.
// Three columns on desktop; stacks vertically under `md` for mobile.

export async function PlayersTab({
  locale,
  dict,
}: {
  locale: Locale;
  dict: Dictionary;
}) {
  const [scorers, assists, yellows] = await Promise.all([
    getLiveTopScorers(20),
    getLiveTopAssists(20),
    getLiveTopYellowCards(20),
  ]);
  const isHebrew = locale === "he";

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-on-surface-variant">
        {isHebrew
          ? "השחקנים הבולטים של המונדיאל - שערים, בישולים ומשמעת. מתעדכן כל שעה."
          : "Standouts of the tournament - goals, assists and discipline. Refreshed hourly."}
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
        <ScorersColumn scorers={scorers} dict={dict} />
        <AssistsColumn assists={assists} dict={dict} />
        <CardsColumn cards={yellows} dict={dict} />
      </div>
    </div>
  );
}

function ScorersColumn({
  scorers,
  dict,
}: {
  scorers: LiveScorer[];
  dict: Dictionary;
}) {
  return (
    <section className="flex flex-col gap-3">
      <SectionHeading as="h2" underline="thin">
        <span className="inline-flex items-center gap-2">
          <Goal className="h-5 w-5 text-secondary" strokeWidth={1.75} />
          {dict.tournament.topScorersHeading ?? "Top scorers"}
        </span>
      </SectionHeading>
      <Card className="p-0 overflow-hidden">
        {scorers.length === 0 ? (
          <p className="text-sm text-on-surface-variant text-center py-6 px-4">
            {dict.tournament.topScorersEmpty ?? "Standings appear once goals are scored."}
          </p>
        ) : (
          <ol className="flex flex-col">
            {scorers.map((s, i) => (
              <PlayerRow
                key={`${s.name}-${i}`}
                rank={s.rank}
                name={s.name}
                photoUrl={s.photoUrl}
                teamCode={s.teamCode}
                teamName={s.teamName}
                primaryValue={s.goals}
                secondaryValue={s.assists}
                secondarySuffix={dict.tournament.topAssistsAssistsAbbr}
                first={i === 0}
              />
            ))}
          </ol>
        )}
      </Card>
    </section>
  );
}

function AssistsColumn({
  assists,
  dict,
}: {
  assists: LiveAssister[];
  dict: Dictionary;
}) {
  return (
    <section className="flex flex-col gap-3">
      <SectionHeading as="h2" underline="thin">
        <span className="inline-flex items-center gap-2">
          <Star className="h-5 w-5 text-tertiary-fixed-dim" strokeWidth={1.75} />
          {dict.tournament.topAssistsHeading}
        </span>
      </SectionHeading>
      <Card className="p-0 overflow-hidden">
        {assists.length === 0 ? (
          <p className="text-sm text-on-surface-variant text-center py-6 px-4">
            {dict.tournament.topAssistsEmpty}
          </p>
        ) : (
          <ol className="flex flex-col">
            {assists.map((s, i) => (
              <PlayerRow
                key={`${s.name}-${i}`}
                rank={s.rank}
                name={s.name}
                photoUrl={s.photoUrl}
                teamCode={s.teamCode}
                teamName={s.teamName}
                primaryValue={s.assists}
                secondaryValue={s.goals}
                secondarySuffix={dict.tournament.topAssistsGoalsHint}
                first={i === 0}
              />
            ))}
          </ol>
        )}
      </Card>
    </section>
  );
}

function CardsColumn({
  cards,
  dict,
}: {
  cards: LiveCardLeader[];
  dict: Dictionary;
}) {
  return (
    <section className="flex flex-col gap-3">
      <SectionHeading as="h2" underline="thin">
        <span className="inline-flex items-center gap-2">
          <Square className="h-4 w-4 text-yellow-500 fill-yellow-400" strokeWidth={1.75} />
          {dict.tournament.topYellowsHeading}
        </span>
      </SectionHeading>
      <Card className="p-0 overflow-hidden">
        {cards.length === 0 ? (
          <p className="text-sm text-on-surface-variant text-center py-6 px-4">
            {dict.tournament.topYellowsEmpty}
          </p>
        ) : (
          <ol className="flex flex-col">
            {cards.map((s, i) => (
              <PlayerRow
                key={`${s.name}-${i}`}
                rank={s.rank}
                name={s.name}
                photoUrl={s.photoUrl}
                teamCode={s.teamCode}
                teamName={s.teamName}
                primaryValue={s.yellow}
                secondaryValue={s.red}
                secondarySuffix={dict.tournament.topYellowsRedAbbr}
                first={i === 0}
                primaryTone="yellow"
              />
            ))}
          </ol>
        )}
      </Card>
    </section>
  );
}

function PlayerRow({
  rank,
  name,
  photoUrl,
  teamCode,
  teamName,
  primaryValue,
  secondaryValue,
  secondarySuffix,
  first,
  primaryTone,
}: {
  rank: number;
  name: string;
  photoUrl: string | null;
  teamCode: string | null;
  teamName: string;
  primaryValue: number;
  secondaryValue: number;
  secondarySuffix?: string;
  first: boolean;
  primaryTone?: "yellow";
}) {
  return (
    <li
      className={`flex items-center gap-3 px-3 py-2.5 min-h-[52px] ${
        first ? "" : "border-t border-outline-variant"
      }`}
    >
      <span className="font-[family-name:var(--font-display)] font-bold text-on-surface w-5 text-center bidi-ltr">
        {rank}
      </span>
      {photoUrl ? (
        <Image
          src={photoUrl}
          alt={name}
          width={32}
          height={32}
          className="rounded-full border border-outline-variant bg-surface-container shrink-0"
          unoptimized
        />
      ) : (
        <div className="w-8 h-8 rounded-full bg-surface-container shrink-0" />
      )}
      <div className="flex flex-col min-w-0 flex-1">
        <span className="text-sm font-bold text-on-surface truncate">
          {name}
        </span>
        <span className="text-xs text-on-surface-variant inline-flex items-center gap-1">
          {teamCode ? <Flag code={teamCode} size={14} /> : null}
          <span className="truncate">{teamName}</span>
        </span>
      </div>
      {secondaryValue > 0 && (
        <span className="text-xs text-on-surface-variant whitespace-nowrap bidi-ltr">
          {secondaryValue} {secondarySuffix}
        </span>
      )}
      <span
        className={`font-[family-name:var(--font-display)] text-lg leading-none font-bold bidi-ltr ${
          primaryTone === "yellow" ? "text-yellow-600" : "text-surface-tint"
        }`}
      >
        {primaryValue}
      </span>
    </li>
  );
}
