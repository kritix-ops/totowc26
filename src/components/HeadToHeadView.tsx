import { clsx } from "clsx";
import { Card, LabelCaps, SectionHeading } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { CATEGORY_LABEL, NetValue } from "@/components/UserHistoryProfile";
import type { HeadToHead } from "@/db/queries";
import type { Dictionary, Locale } from "@/app/[lang]/dictionaries";

// "Me vs. them": two summary columns, the direct duel record, and every
// question both players bet on with the better pick highlighted. Reads as
// a rivalry scoreboard, not a leaderboard — no "biggest loser" framing.

type TKeys = Dictionary["transparency"];

export function HeadToHeadView({
  locale,
  dict,
  data,
}: {
  locale: Locale;
  dict: Dictionary;
  data: HeadToHead;
}) {
  const t = dict.transparency;
  const { a, b, shared, duelRecord } = data;

  return (
    <div className="flex flex-col gap-5">
      <Card className="p-5 md:p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <SectionHeading underline="thin" as="h2">
            {t.headToHead}
          </SectionHeading>
          <span className="text-xs text-on-surface-variant">
            {t.pointsNotMoney}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <PlayerColumn t={t} name={a.name} net={a.summary.net} wins={a.summary.wins} losses={a.summary.losses} />
          <PlayerColumn t={t} name={b.name} net={b.summary.net} wins={b.summary.wins} losses={b.summary.losses} />
        </div>

        {duelRecord.total > 0 && (
          <div className="flex items-center justify-between gap-3 pt-3 border-t border-outline-variant">
            <span className="font-bold text-on-surface">{t.duelRecord}</span>
            <span className="font-[family-name:var(--font-score)] text-2xl font-bold tabular-nums">
              <bdi>
                {duelRecord.aWins} – {duelRecord.bWins}
              </bdi>
            </span>
          </div>
        )}
      </Card>

      <section className="flex flex-col gap-2">
        <SectionHeading underline="thin" as="h2">
          {t.sharedQuestions}
          {shared.length > 0 && (
            <span className="ms-2 text-on-surface-variant tabular-nums">
              {shared.length}
            </span>
          )}
        </SectionHeading>

        {shared.length === 0 ? (
          <Card className="p-6 text-center text-on-surface-variant">
            {t.sharedEmpty}
          </Card>
        ) : (
          <ul className="flex flex-col gap-2">
            {shared.map((q) => (
              <li key={`${q.category}-${q.refId}`}>
                <Card className="p-4 md:p-5 flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-1.5 px-2 h-6 rounded-full text-[11px] font-bold bg-surface-container-high text-on-surface-variant">
                      {t[CATEGORY_LABEL[q.category]]}
                    </span>
                    <span className="text-[11px] text-outline tabular-nums">
                      {formatDateTime(q.sortTs, locale, {
                        day: "numeric",
                        month: "short",
                      })}
                    </span>
                  </div>

                  <div className="flex flex-col gap-0.5">
                    <p className="font-bold text-sm md:text-base text-on-surface">
                      {q.question}
                    </p>
                    {q.contextLabel && (
                      <p className="text-xs text-on-surface-variant">
                        {q.contextLabel}
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-2 border-t border-outline-variant">
                    <SharedSide
                      t={t}
                      name={a.name}
                      pick={q.aPick}
                      net={q.aNet}
                      pending={q.aPending}
                      isWinner={q.winner === "a"}
                    />
                    <SharedSide
                      t={t}
                      name={b.name}
                      pick={q.bPick}
                      net={q.bNet}
                      pending={q.bPending}
                      isWinner={q.winner === "b"}
                    />
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function PlayerColumn({
  t,
  name,
  net,
  wins,
  losses,
}: {
  t: TKeys;
  name: string;
  net: number;
  wins: number;
  losses: number;
}) {
  return (
    <div className="flex flex-col gap-1 p-3 rounded-lg bg-surface-container-low border border-outline-variant min-w-0">
      <span className="font-bold text-on-surface truncate" title={name}>
        {name}
      </span>
      <NetValue value={net} className="text-2xl md:text-3xl" />
      <span className="text-xs text-on-surface-variant tabular-nums">
        <bdi>
          {wins} {t.recordWins} · {losses} {t.recordLosses}
        </bdi>
      </span>
    </div>
  );
}

function SharedSide({
  t,
  name,
  pick,
  net,
  pending,
  isWinner,
}: {
  t: TKeys;
  name: string;
  pick: string;
  net: number | null;
  pending: boolean;
  isWinner: boolean;
}) {
  return (
    <div
      className={clsx(
        "flex flex-col gap-1 p-2.5 rounded-lg border min-w-0",
        isWinner
          ? "bg-secondary-container border-secondary"
          : "bg-surface-container-lowest border-outline-variant",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <LabelCaps as="span">{name}</LabelCaps>
        {isWinner && (
          <span className="inline-flex items-center px-1.5 h-5 rounded-full bg-secondary text-on-secondary text-[10px] font-bold">
            {t.betterLabel}
          </span>
        )}
      </div>
      <span
        className="text-sm font-bold text-on-surface truncate"
        title={pick}
      >
        {pick}
      </span>
      <span className="text-xs tabular-nums">
        {pending ? (
          <span className="text-on-surface-variant">{t.awaitingResult}</span>
        ) : (
          <NetValue value={net ?? 0} className="text-sm" />
        )}
      </span>
    </div>
  );
}
