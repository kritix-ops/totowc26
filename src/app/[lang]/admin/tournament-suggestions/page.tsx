import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { ChevronLeft, ChevronRight, Trophy } from "lucide-react";
import { hasLocale, type Locale } from "../../dictionaries";
import { Card } from "@/components/ui";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { localePath } from "@/lib/paths";
import { TournamentTemplateCard } from "./TournamentTemplateCard";

// Curated library of tournament-scope bet templates. Each one is a
// one-click publish that pre-populates the custom_bets shape with
// sensible defaults the admin can edit inline before saving.
//
// API data integration: where it makes sense, the template seeds its
// multi_choice options from live DB data (the WC team list, populated
// from football-data sync). For pure-stat numbers (total goals, total
// red cards) we expose admin-editable stake/payout because API-Football
// does not publish outright futures odds we can read directly.
//
// The grading source on every published template is 'manual' — admin
// settles tournament bets via /admin/bets/[id]/grade once the
// tournament concludes the relevant stat.

// Explicit prop typing — the auto-generated AppRoutes constraint does
// not pick up new routes until after a `next build`.
type PageParams = {
  params: Promise<{ lang: string }>;
};

type Team = { code: string; nameHe: string; nameEn: string };

export default async function TournamentSuggestionsPage({
  params,
}: PageParams) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  await requireAdmin(locale);
  const isHebrew = locale === "he";
  const ChevBack = isHebrew ? ChevronRight : ChevronLeft;

  const [teams, [cfg], lastFixtureRow] = await Promise.all([
    loadWcTeams(),
    db
      .select({
        baseStake: settings.liveOddsBaseStake,
        maxPayout: settings.liveOddsMaxPayout,
      })
      .from(settings)
      .where(eq(settings.id, 1)),
    loadLastWcKickoff(),
  ]);

  const baseStake = cfg?.baseStake ?? 3;
  const maxPayout = cfg?.maxPayout ?? 25;

  // Default lock for tournament-wide bets that resolve at the end of
  // the tournament: 5 min before the final. For per-stage bets that
  // resolve earlier the admin edits the field per row. If we have no
  // fixtures seeded yet we fall back to a 60-day window so the date
  // input has a sane non-past default.
  // Server component, one render per request - reading the clock is
  // intentional and the rule only flags it because Date.now is
  // non-pure.
  // eslint-disable-next-line react-hooks/purity
  const fallbackLock = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
  const defaultLockIso = lastFixtureRow?.kickoff_at
    ? new Date(new Date(lastFixtureRow.kickoff_at).getTime() - 5 * 60_000).toISOString()
    : fallbackLock;

  const templates = buildTemplates({
    teams,
    baseStake,
    maxPayout,
    defaultLockIso,
  });

  return (
    <section className="px-4 md:px-16 py-6 md:py-12 flex flex-col gap-6 md:gap-8 max-w-5xl mx-auto w-full pb-24">
      <header className="flex flex-col gap-3">
        <Link
          href={localePath(locale, "admin/bets")}
          className="inline-flex items-center gap-1 text-sm text-on-surface-variant hover:text-on-surface w-fit"
        >
          <ChevBack className="h-4 w-4" strokeWidth={2} />
          {isHebrew ? "חזרה להימורי לייב" : "Back to bets"}
        </Link>
        <div className="flex flex-col gap-2">
          <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-9 md:text-[40px] md:leading-[44px] font-bold text-primary inline-flex items-center gap-3">
            <Trophy className="h-6 w-6 md:h-7 md:w-7" strokeWidth={1.75} />
            {isHebrew ? "הצעות הימורי טורניר" : "Tournament bet suggestions"}
          </h1>
          <p className="text-sm text-on-surface-variant">
            {isHebrew
              ? "תבניות מוכנות להימורי טורניר חד-פעמיים. כל תבנית פותחת הימור בעמוד \"הימורים → הימורי טורניר\" של המשתתפים. בחירת הקבוצות מבוססת על רשימת המונדיאל מהדאטה שלנו."
              : "Ready-made templates for one-shot tournament bets. Each template publishes a bet into the player-facing Bets → Tournament tab. Team lists are seeded from our World Cup data."}
          </p>
        </div>
      </header>

      {templates.length === 0 ? (
        <Card className="p-6 text-center text-on-surface-variant">
          {isHebrew
            ? "אין תבניות זמינות. ודא שהסנכרון הראשוני של המשחקים רץ."
            : "No templates available. Confirm the initial fixture sync has run."}
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {templates.map((tpl) => (
            <TournamentTemplateCard
              key={tpl.key}
              locale={locale}
              template={tpl}
              maxPayout={maxPayout}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// ---------- template library ----------

export type TournamentTemplate = {
  key: string;
  iconKey: "crown" | "medal" | "boot" | "goal" | "card" | "penalty";
  titleHe: string;
  titleEn: string;
  helperHe: string;
  helperEn: string;
  questionHe: string;
  questionEn: string;
  gradingRuleHe: string;
  gradingRuleEn: string;
  answerType: "yes_no" | "number" | "multi_choice" | "free_text";
  // For multi_choice, options come from the team list. For number,
  // we hint at a sensible range. yes_no / free_text have no extra data.
  answerOptions?: Array<{ value: string; labelHe: string; labelEn: string }>;
  numberMin?: number;
  numberMax?: number;
  numberUnit?: string;
  defaultStake: number;
  defaultPayout: number;
  defaultLockAtIso: string;
};

function buildTemplates({
  teams,
  baseStake,
  maxPayout,
  defaultLockIso,
}: {
  teams: Team[];
  baseStake: number;
  maxPayout: number;
  defaultLockIso: string;
}): TournamentTemplate[] {
  const teamOptions = teams.map((t) => ({
    value: t.code,
    labelHe: t.nameHe,
    labelEn: t.nameEn,
  }));

  // Most likely-to-score short list. The admin can swap options inline
  // before publishing if they want to track a more current pool.
  const topScorerCandidates = [
    { value: "MBP", labelHe: "מבאפה",     labelEn: "Mbappé" },
    { value: "HAA", labelHe: "האלאנד",    labelEn: "Haaland" },
    { value: "BEL", labelHe: "בלינגהאם",  labelEn: "Bellingham" },
    { value: "VIN", labelHe: "וויניסיוס", labelEn: "Vinicius Jr." },
    { value: "KAN", labelHe: "קיין",      labelEn: "Kane" },
    { value: "MES", labelHe: "מסי",       labelEn: "Messi" },
    { value: "OTH", labelHe: "אחר",       labelEn: "Other" },
  ];

  // Payout suggestions tuned so longshot templates pay more than the
  // base stake but stay under the configured cap. Admin can edit per
  // template before publishing.
  const championPayout = Math.min(maxPayout, Math.max(baseStake + 2, 18));
  const runnerUpPayout = Math.min(maxPayout, Math.max(baseStake + 2, 12));
  const thirdPayout    = Math.min(maxPayout, Math.max(baseStake + 1, 9));
  const scorerPayout   = Math.min(maxPayout, Math.max(baseStake + 2, 14));
  const numberPayout   = Math.min(maxPayout, Math.max(baseStake + 1, 10));
  const yesNoPayout    = Math.min(maxPayout, Math.max(baseStake + 1, 6));

  return [
    {
      key: "champion",
      iconKey: "crown",
      titleHe: "אלוף המונדיאל",
      titleEn: "Champion",
      helperHe: "מי תזכה במונדיאל. בחר מבין כל הקבוצות המשתתפות.",
      helperEn: "Who wins the World Cup. Choose from every participating team.",
      questionHe: "מי תזכה במונדיאל 2026?",
      questionEn: "Who wins the 2026 World Cup?",
      gradingRuleHe: "הקבוצה שניצחה בגמר.",
      gradingRuleEn: "The team that won the final.",
      answerType: "multi_choice",
      answerOptions: teamOptions,
      defaultStake: baseStake,
      defaultPayout: championPayout,
      defaultLockAtIso: defaultLockIso,
    },
    {
      key: "runner_up",
      iconKey: "medal",
      titleHe: "סגן אלוף",
      titleEn: "Runner-up",
      helperHe: "מי תפסיד בגמר.",
      helperEn: "Who loses the final.",
      questionHe: "מי תהיה סגנית אלוף המונדיאל 2026?",
      questionEn: "Who finishes as runner-up at the 2026 World Cup?",
      gradingRuleHe: "הקבוצה שהפסידה בגמר.",
      gradingRuleEn: "The team that lost the final.",
      answerType: "multi_choice",
      answerOptions: teamOptions,
      defaultStake: baseStake,
      defaultPayout: runnerUpPayout,
      defaultLockAtIso: defaultLockIso,
    },
    {
      key: "third_place",
      iconKey: "medal",
      titleHe: "מקום שלישי",
      titleEn: "Third place",
      helperHe: "המנצחת במשחק על המקום השלישי.",
      helperEn: "The winner of the third-place playoff.",
      questionHe: "מי תזכה במקום השלישי?",
      questionEn: "Who finishes third at the 2026 World Cup?",
      gradingRuleHe: "הקבוצה שניצחה במשחק על המקום השלישי.",
      gradingRuleEn: "The team that won the third-place playoff.",
      answerType: "multi_choice",
      answerOptions: teamOptions,
      defaultStake: baseStake,
      defaultPayout: thirdPayout,
      defaultLockAtIso: defaultLockIso,
    },
    {
      key: "top_scorer",
      iconKey: "boot",
      titleHe: "מלך השערים",
      titleEn: "Top scorer",
      helperHe: "השחקן שיכבוש הכי הרבה שערים בטורניר. רשימה התחלתית של מועמדים שאפשר לערוך.",
      helperEn: "The player with the most goals in the tournament. Starter candidate list, editable.",
      questionHe: "מי יהיה מלך השערים של המונדיאל?",
      questionEn: "Who will be the World Cup top scorer?",
      gradingRuleHe: "השחקן שמופיע במקום הראשון בטבלת הכובשים הרשמית של פיפ\"א בסוף הטורניר. במקרה של שוויון, מי שכבש בפחות דקות.",
      gradingRuleEn: "The player ranked first in FIFA's official top-scorers list at the end of the tournament. Tie-break: fewer minutes played.",
      answerType: "multi_choice",
      answerOptions: topScorerCandidates,
      defaultStake: baseStake,
      defaultPayout: scorerPayout,
      defaultLockAtIso: defaultLockIso,
    },
    {
      key: "total_goals",
      iconKey: "goal",
      titleHe: "סך השערים בטורניר",
      titleEn: "Total tournament goals",
      helperHe: "סך כל השערים שייכבשו במהלך הטורניר. ניחוש מספרי, הקרוב ביותר זוכה. בעבר היו בערך 170 שערים במונדיאל של 64 משחקים.",
      helperEn: "Total goals scored across every match. Number guess — closest wins. The recent 64-match World Cups averaged around 170 goals.",
      questionHe: "כמה שערים יוקלעו בסך הכל במונדיאל 2026?",
      questionEn: "How many goals will be scored in total at the 2026 World Cup?",
      gradingRuleHe: "סך כל השערים בכל המשחקים, כולל הארכות. פנדלים אחרי תיקו לא נספרים.",
      gradingRuleEn: "Sum of goals across every match including extra time. Penalty shoot-outs after a draw are not counted.",
      answerType: "number",
      numberMin: 0,
      numberMax: 500,
      numberUnit: "goals",
      defaultStake: baseStake,
      defaultPayout: numberPayout,
      defaultLockAtIso: defaultLockIso,
    },
    {
      key: "total_red_cards",
      iconKey: "card",
      titleHe: "סך הכרטיסים האדומים בטורניר",
      titleEn: "Total red cards in tournament",
      helperHe: "סך כל הכרטיסים האדומים שיוצאו במהלך הטורניר.",
      helperEn: "Total red cards shown across the whole tournament.",
      questionHe: "כמה כרטיסים אדומים יוצאו במונדיאל 2026?",
      questionEn: "How many red cards will be shown at the 2026 World Cup?",
      gradingRuleHe: "סך כל הכרטיסים האדומים שדווחו במשחק. שתי כרטיסים צהובים שהפכו לאדום נספרים פעם אחת.",
      gradingRuleEn: "Sum of red cards reported per match. Two yellows that became a red count once.",
      answerType: "number",
      numberMin: 0,
      numberMax: 200,
      numberUnit: "cards",
      defaultStake: baseStake,
      defaultPayout: numberPayout,
      defaultLockAtIso: defaultLockIso,
    },
    {
      key: "final_to_penalties",
      iconKey: "penalty",
      titleHe: "האם הגמר ייפסק בפנדלים",
      titleEn: "Final decided on penalties",
      helperHe: "כן או לא: האם הגמר יוכרע בדו-קרב פנדלים?",
      helperEn: "Yes/no: will the final be decided by a penalty shoot-out?",
      questionHe: "האם הגמר ייפסק בפנדלים?",
      questionEn: "Will the final be decided on penalties?",
      gradingRuleHe: "כן אם הגמר הסתיים בדו-קרב פנדלים. לא בכל מצב אחר.",
      gradingRuleEn: "Yes if the final ended in a penalty shoot-out. No in every other case.",
      answerType: "yes_no",
      defaultStake: baseStake,
      defaultPayout: yesNoPayout,
      defaultLockAtIso: defaultLockIso,
    },
  ];
}

// ---------- data ----------

async function loadWcTeams(): Promise<Team[]> {
  const rows = await db.execute<Team>(sql`
    select t.code as "code", t.name_he as "nameHe", t.name_en as "nameEn"
    from public.teams t
    where t.group_id is not null
    order by t.name_en asc
  `);
  return rows as unknown as Team[];
}

async function loadLastWcKickoff(): Promise<{ kickoff_at: string } | null> {
  const rows = await db.execute<{ kickoff_at: string }>(sql`
    select max(m.kickoff_at)::text as "kickoff_at"
    from public.matches m
  `);
  const r = (rows as unknown as Array<{ kickoff_at: string | null }>)[0];
  return r?.kickoff_at ? { kickoff_at: r.kickoff_at } : null;
}
