import Link from "next/link";
import { Swords } from "lucide-react";
import { Card, LabelCaps, SectionHeading } from "@/components/ui";
import { localePath } from "@/lib/paths";
import { formatDateTime } from "@/lib/format";
import type { Locale } from "../../dictionaries";
import type { H2HMatch } from "@/db/queries";

// Head-to-head between two teams in this tournament. Shows all meetings
// (past + scheduled), with a tally row when there are at least two finished
// matches between them. Excludes the currently-viewed match by id.
//
// In the World Cup specifically, two teams play each other at most once in
// the group stage and then potentially again in the knockout bracket. So in
// practice this list is rarely more than one or two rows — exactly the
// situations where seeing the prior result actually matters.

export function HeadToHead({
  locale,
  matches,
  currentMatchId,
  homeName,
  awayName,
  homeCode,
  awayCode,
}: {
  locale: Locale;
  matches: H2HMatch[];
  currentMatchId: string;
  homeName: string;
  awayName: string;
  homeCode: string;
  awayCode: string;
}) {
  const isHebrew = locale === "he";
  const others = matches.filter((m) => m.matchId !== currentMatchId);
  if (others.length === 0) return null;

  const finals = others.filter(
    (m) => m.status === "final" && m.aGoals != null && m.bGoals != null,
  );
  // Tally is from the perspective of the "a" team (the home team of the
  // current match). aGoals/bGoals are already keyed to that convention.
  let aWins = 0;
  let bWins = 0;
  let draws = 0;
  for (const m of finals) {
    if (m.aGoals! > m.bGoals!) aWins += 1;
    else if (m.aGoals! < m.bGoals!) bWins += 1;
    else draws += 1;
  }

  return (
    <section className="flex flex-col gap-4">
      <SectionHeading underline="thin">
        <span className="inline-flex items-center gap-2">
          <Swords
            className="h-5 w-5 text-tertiary-fixed-dim"
            strokeWidth={1.75}
          />
          {isHebrew ? "ראש בראש" : "Head to head"}
        </span>
      </SectionHeading>

      {finals.length >= 1 && (
        <Card className="p-4 grid grid-cols-3 text-center">
          <Tally
            label={homeName}
            value={aWins}
            isHebrew={isHebrew}
            tone={aWins > bWins ? "good" : undefined}
          />
          <Tally
            label={isHebrew ? "תיקו" : "Draw"}
            value={draws}
            isHebrew={isHebrew}
          />
          <Tally
            label={awayName}
            value={bWins}
            isHebrew={isHebrew}
            tone={bWins > aWins ? "good" : undefined}
          />
        </Card>
      )}

      <ul className="flex flex-col gap-2">
        {others.map((m) => (
          <li key={m.matchId}>
            <Link
              href={localePath(locale, `bets/${m.matchId}`)}
              className="flex items-center gap-3 p-3 rounded-lg border border-outline-variant bg-surface-container-lowest hover:bg-surface-container transition-colors min-h-[56px]"
            >
              <span className="text-sm text-on-surface-variant whitespace-nowrap">
                {formatDateTime(m.kickoffAt, locale, {
                  day: "numeric",
                  month: "short",
                })}
              </span>
              <span className="flex-1 font-bold text-sm text-on-surface truncate text-center">
                {homeName}{" "}
                <span className="text-on-surface-variant">
                  {isHebrew ? "נגד" : "vs"}
                </span>{" "}
                {awayName}
              </span>
              {m.status === "final" &&
              m.aGoals != null &&
              m.bGoals != null ? (
                <span className="font-[family-name:var(--font-score)] text-lg leading-none font-bold text-on-surface bidi-ltr shrink-0">
                  {m.aGoals} - {m.bGoals}
                  {m.wentToPenalties && (
                    <span className="text-xs ms-1 text-on-surface-variant">
                      {isHebrew ? "(פנדלים)" : "(pen)"}
                    </span>
                  )}
                </span>
              ) : (
                <LabelCaps>
                  {isHebrew ? labelStage(m.stage, "he") : labelStage(m.stage, "en")}
                </LabelCaps>
              )}
            </Link>
          </li>
        ))}
      </ul>
      {/* Silence unused-var warnings; codes are passed in for future link extensions. */}
      <span className="sr-only">{homeCode} {awayCode}</span>
    </section>
  );
}

function Tally({
  label,
  value,
  isHebrew,
  tone,
}: {
  label: string;
  value: number;
  isHebrew: boolean;
  tone?: "good";
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <LabelCaps className="truncate max-w-full">{label}</LabelCaps>
      <span
        className={`font-[family-name:var(--font-display)] text-2xl leading-none font-bold bidi-ltr ${
          tone === "good" ? "text-secondary" : "text-on-surface"
        }`}
      >
        {value}
      </span>
      <span className="text-xs text-on-surface-variant">
        {value === 1
          ? isHebrew ? "ניצחון" : "win"
          : isHebrew ? "ניצחונות" : "wins"}
      </span>
    </div>
  );
}

function labelStage(stage: string, locale: "he" | "en"): string {
  const map: Record<string, [string, string]> = {
    group: ["שלב הבתים", "Group stage"],
    r32: ["שלב 32", "Round of 32"],
    r16: ["שמינית", "Round of 16"],
    qf: ["רבע גמר", "Quarter-final"],
    sf: ["חצי גמר", "Semi-final"],
    third_place: ["מקום 3", "Third-place"],
    final: ["גמר", "Final"],
  };
  const pair = map[stage];
  return pair ? pair[locale === "he" ? 0 : 1] : stage;
}
