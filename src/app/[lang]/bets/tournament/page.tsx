import { notFound, redirect } from "next/navigation";
import { Trophy } from "lucide-react";
import { hasLocale, type Locale } from "../../dictionaries";
import { Card, SectionHeading } from "@/components/ui";
import {
  CustomBetCard,
  type CustomBetCardData,
} from "@/components/CustomBetCard";
import { BetsTabs } from "@/components/BetsTabs";
import { getUser } from "@/lib/supabase/auth";
import { getUserAccess } from "@/lib/access";
import { getBankBalance } from "@/lib/bank";
import { localePath } from "@/lib/paths";
import {
  getTournamentPlayBets,
  type TournamentPlayBetRow,
} from "@/db/queries";
import type { AnswerConfig, PickAnswer } from "@/lib/bets/types";

// Tournament-scope bets surface. Moved here from /play/tournament so
// every bet surface (match picks, tournament, group rankings) sits
// under the unified /bets URL with shared tab navigation. /play/...
// is now reserved for live bets only.

// Explicit prop typing — the auto-generated AppRoutes constraint does
// not pick up new routes until after a `next build`, so we declare the
// params shape locally to avoid a build-order coupling.
type PageParams = {
  params: Promise<{ lang: string }>;
};

export default async function BetsTournamentPage({
  params,
}: PageParams) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const isHebrew = locale === "he";

  const user = await getUser();
  if (!user) redirect(localePath(locale, "login"));
  const access = await getUserAccess(user.id);

  const [bets, bankBalance] = await Promise.all([
    getTournamentPlayBets(user.id),
    getBankBalance(user.id),
  ]);

  // Bucket bets by stage. Tournament-scope (stage=null) goes first.
  type Bucket = {
    key: string;
    titleHe: string;
    titleEn: string;
    rows: TournamentPlayBetRow[];
  };
  const buckets: Bucket[] = [
    { key: "tournament",  titleHe: "טורניר",       titleEn: "Tournament",     rows: [] },
    { key: "group",       titleHe: "שלב הבתים",    titleEn: "Group stage",    rows: [] },
    { key: "r32",         titleHe: "R32",          titleEn: "Round of 32",    rows: [] },
    { key: "r16",         titleHe: "R16",          titleEn: "Round of 16",    rows: [] },
    { key: "qf",          titleHe: "רבע גמר",      titleEn: "Quarter-finals", rows: [] },
    { key: "sf",          titleHe: "חצי גמר",      titleEn: "Semi-finals",    rows: [] },
    { key: "third_place", titleHe: "מקום שלישי",   titleEn: "Third place",    rows: [] },
    { key: "final",       titleHe: "גמר",          titleEn: "Final",          rows: [] },
  ];
  for (const bet of bets) {
    if (bet.scope === "tournament" || !bet.stage) {
      buckets[0].rows.push(bet);
    } else {
      const idx = buckets.findIndex((b) => b.key === bet.stage);
      if (idx > 0) buckets[idx].rows.push(bet);
    }
  }
  const nonEmpty = buckets.filter((b) => b.rows.length > 0);

  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();
  const isEditable = (b: { status: string; lockAt: string }) =>
    access.canEdit && b.status === "open" && new Date(b.lockAt).getTime() > nowMs;

  return (
    <section className="px-4 md:px-16 py-6 md:py-12 flex flex-col gap-6 md:gap-8 max-w-3xl mx-auto w-full pb-24">
      <header className="flex flex-col gap-3">
        <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-9 md:text-[40px] md:leading-[44px] font-bold text-primary">
          {isHebrew ? "הימורים" : "Bets"}
        </h1>
        <BetsTabs locale={locale} active="tournament" />
        <h2 className="font-[family-name:var(--font-display)] text-lg md:text-xl font-bold text-on-surface inline-flex items-center gap-2 mt-2">
          <Trophy className="h-5 w-5 text-tertiary-fixed-dim" strokeWidth={1.75} />
          {isHebrew ? "הימורי טורניר" : "Tournament bets"}
        </h2>
        <p className="text-sm text-on-surface-variant">
          {isHebrew
            ? "ניחושים חד-פעמיים על כל הטורניר. נסגרים בשריקת הפתיחה של המשחק הראשון שמושפע."
            : "One-shot bets across the whole tournament. Each locks at the first relevant kickoff."}
        </p>
      </header>

      {nonEmpty.length === 0 ? (
        <Card className="p-6 text-center text-on-surface-variant">
          {isHebrew
            ? "עוד אין הימורי טורניר פתוחים. בדוק שוב בעוד כמה ימים."
            : "No tournament bets open yet. Check back in a few days."}
        </Card>
      ) : (
        nonEmpty.map((bucket) => (
          <section key={bucket.key} className="flex flex-col gap-3">
            <SectionHeading as="h3" underline="thin">
              {isHebrew ? bucket.titleHe : bucket.titleEn}
            </SectionHeading>
            <div className="flex flex-col gap-3">
              {bucket.rows.map((b) => (
                <CustomBetCard
                  key={b.id}
                  locale={locale}
                  bankBalance={bankBalance}
                  editable={isEditable(b)}
                  bet={toCardData(b)}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </section>
  );
}

function toCardData(row: TournamentPlayBetRow): CustomBetCardData {
  return {
    id: row.id,
    questionHe: row.questionHe,
    questionEn: row.questionEn,
    gradingRuleHe: row.gradingRuleHe,
    gradingRuleEn: row.gradingRuleEn,
    answerType: row.answerType,
    answerConfig: row.answerConfig as AnswerConfig,
    stakeSnapshot: row.stakeSnapshot,
    payoutSnapshot: row.payoutSnapshot,
    lockAt: row.lockAt,
    status: row.status,
    myAnswer: (row.myAnswer ?? null) as PickAnswer | null,
    myStakePaid: row.myStakePaid,
  };
}
