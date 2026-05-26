import { notFound, redirect } from "next/navigation";
import { Flame, Trophy } from "lucide-react";
import { clsx } from "clsx";
import { getDictionary, hasLocale, type Locale } from "../dictionaries";
import { getUser } from "@/lib/supabase/auth";
import { getLeaderboard, getPrizeBreakdown } from "@/db/queries";
import { Card, LabelCaps } from "@/components/ui";
import { localePath } from "@/lib/paths";

export default async function LeaderboardPage({
  params,
}: PageProps<"/[lang]/leaderboard">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const dict = await getDictionary(locale);

  const user = await getUser();
  if (!user) redirect(localePath(locale, "login"));

  const [rows, prize] = await Promise.all([
    getLeaderboard(user.id),
    getPrizeBreakdown(),
  ]);
  const prizeByRank = new Map<number, number>(
    prize.prizes.map((p) => [p.rank, p.ils]),
  );
  const isHebrew = locale === "he";

  return (
    <section className="px-4 md:px-16 py-6 md:py-12 flex flex-col gap-6 md:gap-8 max-w-3xl mx-auto w-full">
      <header className="flex flex-col gap-4">
        <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-9 md:text-[48px] md:leading-[52px] font-bold text-primary">
          {dict.leaderboard.title}
        </h1>
      </header>

      {rows.length === 0 ? (
        <Card className="p-6 text-center text-on-surface-variant">
          {isHebrew
            ? "אין עדיין משתתפים בקבוצה"
            : "No players in the pool yet"}
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => {
            const top3 = row.rank <= 3;
            const prizeIls = prizeByRank.get(row.rank) ?? 0;
            return (
              <li
                key={row.userId}
                className={clsx(
                  "flex items-center gap-3 md:gap-4 p-3 md:p-4 rounded-lg border transition-colors",
                  row.isYou
                    ? "border-primary bg-primary-fixed sticky top-14 md:top-16 z-10 shadow-md"
                    : "border-outline-variant bg-surface-container-lowest",
                )}
              >
                <span className="font-[family-name:var(--font-display)] text-xl md:text-2xl leading-none font-bold text-on-surface w-7 md:w-8 text-center bidi-ltr">
                  {row.rank}
                </span>
                <div
                  className={clsx(
                    "w-10 h-10 md:w-12 md:h-12 rounded-full bg-surface-variant flex items-center justify-center text-base md:text-lg font-bold text-on-surface shrink-0",
                    top3 && "ring-2 ring-tertiary-fixed-dim",
                  )}
                  aria-hidden
                >
                  {row.displayName.charAt(0)}
                </div>
                <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                  <span className="text-sm md:text-base font-bold text-on-surface truncate">
                    {row.isYou ? dict.leaderboard.you : row.displayName}
                  </span>
                  {row.betCount > 0 && (
                    <span className="inline-flex items-center gap-1 text-xs text-on-surface-variant">
                      <Flame className="h-3 w-3" strokeWidth={2} />
                      <span className="bidi-ltr">{row.betCount}</span>{" "}
                      <span>{isHebrew ? "הימורים" : "bets"}</span>
                    </span>
                  )}
                </div>
                <div className="text-end shrink-0 flex flex-col items-end gap-0.5">
                  <span className="font-[family-name:var(--font-display)] text-xl md:text-2xl leading-none font-bold text-surface-tint">
                    <span className="bidi-ltr">{row.points}</span>
                  </span>
                  <LabelCaps as="div">{dict.common.points}</LabelCaps>
                  {prizeIls > 0 && row.rank <= 4 && (
                    <span
                      className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-tertiary-fixed text-on-tertiary-fixed-variant text-[11px] font-bold tabular-nums"
                      aria-label={
                        isHebrew
                          ? `פרס למקום ${row.rank}: ${prizeIls} ש״ח`
                          : `Prize for rank ${row.rank}: ${prizeIls} ILS`
                      }
                    >
                      <Trophy className="h-3 w-3" strokeWidth={2} />
                      <bdi>
                        {prizeIls.toLocaleString()} {isHebrew ? "ש״ח" : "ILS"}
                      </bdi>
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
