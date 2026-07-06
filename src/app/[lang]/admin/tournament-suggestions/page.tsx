import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { ChevronLeft, ChevronRight, Trophy } from "lucide-react";
import { hasLocale, type Locale } from "../../dictionaries";
import { Card, SectionHeading } from "@/components/ui";
import { execFirstRow, execRows } from "@/db/helpers";
import { listCustomBets } from "@/db/admin-queries";
import { localePath } from "@/lib/paths";
import { serverNow } from "@/lib/server-now";
import { stageLabel } from "@/lib/stage-label";
import { MS_PER_DAY, MS_PER_MINUTE } from "@/lib/time";
import type { DynamicOptionSource } from "@/lib/bets/types";
import {
  OUTRIGHT_MAX_PAYOUT,
  OUTRIGHT_PLAYER_CEILING,
} from "@/lib/bets/free-pick-scopes";
import { TournamentTemplateCard } from "./TournamentTemplateCard";
import {
  PublishedTournamentBets,
  type PublishedTournamentBet,
} from "./PublishedTournamentBets";

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
// The grading source on every published template is 'manual'. The admin
// settles each bet from the "ההימורים שפרסמת" section at the top of this
// page (PublishedTournamentBets → the shared GradeForm) once the tournament
// concludes the relevant stat — no trip to the live-bets surface needed.

// Explicit prop typing — the auto-generated AppRoutes constraint does
// not pick up new routes until after a `next build`.
type PageParams = {
  params: Promise<{ lang: string }>;
};

type Team = { code: string; nameHe: string; nameEn: string; flag: string };

// Finalize-list ordering: locked (past its lock, most urgent) and open
// (decided but still accepting picks) come first, then reversed, then the
// already-graded rows. Draft / cancelled are filtered out before sorting.
const STATUS_RANK: Record<PublishedTournamentBet["status"], number> = {
  locked: 0,
  open: 1,
  reversed: 2,
  graded: 3,
};

export default async function TournamentSuggestionsPage({
  params,
}: PageParams) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const isHebrew = locale === "he";
  const ChevBack = isHebrew ? ChevronRight : ChevronLeft;

  const [teams, lastFixtureRow, publishedBetRows] = await Promise.all([
    loadWcTeams(),
    loadLastWcKickoff(),
    // The stage + tournament bets this page is responsible for. Group-scope
    // bets auto-grade and live on /admin/group-bets, so they are excluded
    // here to avoid duplicating that surface.
    listCustomBets({ scopeIn: ["stage", "tournament"], limit: 200 }),
  ]);

  // Shape the published bets for the finalize list: localize the question
  // and scope, drop draft (unpublished) / cancelled (dead) rows, and order
  // the ones needing action ahead of the already-graded ones. The query
  // returns newest-first and Array.sort is stable, so recency is preserved
  // within each status band.
  const publishedBets: PublishedTournamentBet[] = publishedBetRows
    .filter(
      (b) =>
        b.status === "open" ||
        b.status === "locked" ||
        b.status === "reversed" ||
        b.status === "graded",
    )
    .map((b) => ({
      id: b.id,
      status: b.status as PublishedTournamentBet["status"],
      question: isHebrew ? b.questionHe : b.questionEn,
      scopeLabel:
        b.scope === "tournament"
          ? isHebrew
            ? "טורניר"
            : "Tournament"
          : stageLabel(b.stage ?? "", b.groupId, locale),
      answerType: b.answerType,
      answerConfig: b.answerConfig,
      resolvedValue: b.resolvedValue,
      payoutSnapshot: b.payoutSnapshot,
      pickCount: b.pickCount,
      lockAt: b.lockAt,
    }))
    .sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status]);

  // Tournament/stage/group bets are free picks: stake 0, payouts on the
  // outright scale (notional unit 1, cap 25). See
  // _plans/2026-05-31-free-tournament-bets-and-rescaled-payouts.md.
  const baseStake = 0;
  const maxPayout = OUTRIGHT_MAX_PAYOUT;

  // Default lock for tournament-wide bets that resolve at the end of
  // the tournament: 5 min before the final. For per-stage bets that
  // resolve earlier the admin edits the field per row. If we have no
  // fixtures seeded yet we fall back to a 60-day window so the date
  // input has a sane non-past default.
  const fallbackLock = new Date(serverNow() + 60 * MS_PER_DAY).toISOString();
  const defaultLockIso = lastFixtureRow?.kickoff_at
    ? new Date(new Date(lastFixtureRow.kickoff_at).getTime() - 5 * MS_PER_MINUTE).toISOString()
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
            {isHebrew ? "הימורי טורניר" : "Tournament bets"}
          </h1>
          <p className="text-sm text-on-surface-variant">
            {isHebrew
              ? "כאן מנהלים את הימורי הטורניר: מסיימים הימור שכבר הוכרע (למעלה) ומפרסמים הימורים חדשים מהתבניות (למטה)."
              : "Manage tournament bets here: finalize a decided bet (top) and publish new ones from the templates (below)."}
          </p>
        </div>
      </header>

      <PublishedTournamentBets locale={locale} bets={publishedBets} />

      <section className="flex flex-col gap-3">
        <SectionHeading as="h2" underline="thin">
          {isHebrew ? "פרסם הימור חדש" : "Publish a new bet"}
        </SectionHeading>
        <p className="text-sm text-on-surface-variant">
          {isHebrew
            ? "תבניות מוכנות להימורי טורניר חד-פעמיים. כל תבנית פותחת הימור בעמוד \"הימורים → הימורי טורניר\" של המשתתפים. בחירת הקבוצות מבוססת על רשימת המונדיאל מהדאטה שלנו."
            : "Ready-made templates for one-shot tournament bets. Each template publishes a bet into the player-facing Bets → Tournament tab. Team lists are seeded from our World Cup data."}
        </p>
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
    </section>
  );
}

// ---------- template library ----------

export type TournamentTemplate = {
  key: string;
  iconKey: "crown" | "medal" | "boot" | "goal" | "card" | "penalty" | "award";
  titleHe: string;
  titleEn: string;
  helperHe: string;
  helperEn: string;
  questionHe: string;
  questionEn: string;
  gradingRuleHe: string;
  gradingRuleEn: string;
  answerType: "yes_no" | "number" | "multi_choice" | "free_text";
  // For multi_choice, options come from either the team list or
  // the live players table. For number, we hint at a sensible
  // range. yes_no / free_text have no extra data. The optional
  // metadata fields (groupHe/groupEn for grouping, subtitleHe/En
  // for the second line, icon for a flag emoji) are read by the
  // user-facing SearchableChoicePicker and ignored by simpler
  // renderers, so backwards compatibility is preserved.
  answerOptions?: Array<{
    value: string;
    labelHe: string;
    labelEn: string;
    groupHe?: string;
    groupEn?: string;
    subtitleHe?: string;
    subtitleEn?: string;
    icon?: string;
    // Per-option payout, in points, on the 20→100 tournament curve.
    // Used by static-list templates (range buckets) where the bookmaker
    // probabilities have been pre-computed and baked into the template.
    // Outright surfaces (champion / top scorer / ...) populate this
    // from the live odds snapshot via publishSurfaceToBet instead.
    payoutOverride?: number;
  }>;
  // For yes_no templates that price the two branches differently. Mirrors
  // YesNoConfig.payoutOverrideYes / payoutOverrideNo at the template
  // layer so buildAnswerConfig can copy them straight through. Omitted
  // for symmetric yes/no markets.
  yesNoOverrides?: { yes: number; no: number };
  // When set, the published bet stores `dynamicSource` in
  // answer_config and the user-facing picker hydrates the option
  // list from /api/picker-options/<source> at view time. Used for
  // templates over the full ~1,357-player roster (top scorer,
  // golden ball, ...) so the bet's answer_config jsonb stays small.
  dynamicSource?: DynamicOptionSource;
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
  // Team options carry the flag emoji so the public picker shows
  // it as a leading icon. Backwards-compatible with the no-icon
  // case for callers that pass a plain team list.
  const teamOptions = teams.map((t) => ({
    value: t.code,
    labelHe: t.nameHe,
    labelEn: t.nameEn,
    icon: t.flag,
  }));

  // Player-scope templates (top scorer, golden ball) declare
  // `dynamicSource: "players"`. The published bet's answer_config
  // carries the source flag with empty options[], and the user-
  // facing picker hydrates the full WC roster from
  // /api/picker-options/players at view time. Saves ~200 KB per
  // bet record and lets server-side roster updates (squad re-sync,
  // translation fixes) propagate without rewriting every row.

  // Bet-level payout fallbacks on the rescaled outright scale. The
  // cap (OUTRIGHT_MAX_PAYOUT = 25) is the same one publishSurfaceToBet
  // writes to unmatched options, so an unranked-player pick after
  // publishing still pays the cap. Pre-publish these values just
  // populate the card chip and the static-bet template defaults; the
  // admin can edit per template before saving. See
  // _plans/2026-05-31-free-tournament-bets-and-rescaled-payouts.md.
  const championPayout    = Math.min(maxPayout, 12);
  const runnerUpPayout    = Math.min(maxPayout, 10);
  const thirdPayout       = Math.min(maxPayout, 8);
  const scorerPayout      = Math.min(maxPayout, 10);
  const goldenBallPayout  = Math.min(maxPayout, 12);
  // Range and yes/no templates that ship with per-option pricing use
  // the curve ceiling as the bet-level payout snapshot — matching the
  // convention that outright surfaces (champion, top scorer, ...) use.
  // The headline ("זכייה: 100") reads honestly as "up to 100", with the
  // per-option scenario block revealing the actual payout for each
  // choice. See _plans/2026-06-05-flat-tournament-bets-per-option-odds.md.
  const curveCeilingPayout = OUTRIGHT_PLAYER_CEILING;

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
      helperHe: "השחקן שיכבוש הכי הרבה שערים בטורניר. פותח ברשימת הכוכבים הגלובליים - חיפוש מאתר כל אחד מ-1,357 השחקנים בסגלי המונדיאל.",
      helperEn: "The player with the most goals in the tournament. Picker opens on the global stars — search reaches every one of the 1,357 players across all WC squads.",
      questionHe: "מי יהיה מלך השערים של המונדיאל?",
      questionEn: "Who will be the World Cup top scorer?",
      gradingRuleHe: "השחקן שמופיע במקום הראשון בטבלת הכובשים הרשמית של פיפ\"א בסוף הטורניר. במקרה של שוויון, מי שכבש בפחות דקות.",
      gradingRuleEn: "The player ranked first in FIFA's official top-scorers list at the end of the tournament. Tie-break: fewer minutes played.",
      answerType: "multi_choice",
      dynamicSource: "players",
      defaultStake: baseStake,
      defaultPayout: scorerPayout,
      defaultLockAtIso: defaultLockIso,
    },
    {
      key: "golden_ball",
      iconKey: "award",
      titleHe: "כדור הזהב (השחקן הכי טוב)",
      titleEn: "Golden Ball (best player)",
      helperHe: "השחקן הטוב ביותר של הטורניר לפי הצבעת פיפ\"א. פותח ברשימת הכוכבים הגלובליים - חיפוש מאתר כל שחקן ב-1,357 הסגלים.",
      helperEn: "The tournament's best player per FIFA voting. Picker opens on the global stars — search reaches every one of the 1,357 players.",
      questionHe: "מי יזכה בכדור הזהב של המונדיאל?",
      questionEn: "Who wins the World Cup Golden Ball?",
      gradingRuleHe: "השחקן שזכה בפרס הרשמי \"כדור הזהב של אדידס\" מטעם פיפ\"א בסיום הטורניר.",
      gradingRuleEn: "The player who wins FIFA's official adidas Golden Ball award at the end of the tournament.",
      answerType: "multi_choice",
      dynamicSource: "players",
      defaultStake: baseStake,
      defaultPayout: goldenBallPayout,
      defaultLockAtIso: defaultLockIso,
    },
    {
      key: "total_goals",
      iconKey: "goal",
      titleHe: "סך השערים בטורניר",
      titleEn: "Total tournament goals",
      helperHe: "בחר באחד מ-3 טווחים לסך השערים בטורניר. בסיס: 3 המונדיאלים האחרונים נעו סביב 2.67 שערים למשחק; ב-104 משחקים הצפי הוא ~280.",
      helperEn: "Pick one of 3 ranges for the tournament total. Baseline: the last 3 World Cups averaged ~2.67 goals per match; over 104 matches that projects to ~280.",
      questionHe: "כמה שערים יובקעו בסך הכל במונדיאל 2026?",
      questionEn: "How many goals will be scored in total at the 2026 World Cup?",
      gradingRuleHe: "סך כל השערים בכל המשחקים, כולל הארכות, פנדלים אחרי תיקו לא נספרים. הזוכים הם מי שבחרו את הטווח המכיל את המספר הסופי.",
      gradingRuleEn: "Sum of goals across every match including extra time; penalty shoot-outs after a draw are not counted. Winners are those who picked the range containing the final number.",
      answerType: "multi_choice",
      // Per-option payouts on the 20→100 log-odds curve derived from
      // DraftKings WC2026 over/under lines (de-juiced; the bookmaker
      // centre sits around ~300 goals, so the Toto buckets sit below
      // it). Probabilities: P(<265)≈7%, P(265–295)≈26%, P(>295)≈67%.
      answerOptions: [
        { value: "lt_265",   labelHe: "פחות מ-265", labelEn: "Under 265", payoutOverride: 100 },
        { value: "265_295",  labelHe: "265–295",    labelEn: "265–295",   payoutOverride: 54  },
        { value: "gt_295",   labelHe: "מעל 295",    labelEn: "Over 295",  payoutOverride: 20  },
      ],
      defaultStake: baseStake,
      defaultPayout: curveCeilingPayout,
      defaultLockAtIso: defaultLockIso,
    },
    {
      key: "total_red_cards",
      iconKey: "card",
      titleHe: "סך הכרטיסים האדומים בטורניר",
      titleEn: "Total red cards in tournament",
      helperHe: "בחר באחד מ-3 טווחים. בסיס: ממוצע 3 המונדיאלים האחרונים 6 אדומים ל-64 משחקים (עידן ה-VAR מוריד, פורמט 48 קבוצות מעלה); ב-104 משחקים הצפי ~9-12.",
      helperEn: "Pick one of 3 ranges. Baseline: the last 3 World Cups averaged 6 reds across 64 matches (VAR pushes down, 48-team format pushes up); over 104 matches expect ~9-12.",
      questionHe: "כמה כרטיסים אדומים יוצאו במונדיאל 2026?",
      questionEn: "How many red cards will be shown at the 2026 World Cup?",
      gradingRuleHe: "סך כל הכרטיסים האדומים שדווחו במשחק. שני כרטיסים צהובים שהפכו לאדום נספרים פעם אחת. הזוכים הם מי שבחרו את הטווח המכיל את המספר הסופי.",
      gradingRuleEn: "Sum of red cards reported per match. Two yellows that became a red count once. Winners are those who picked the range containing the final number.",
      answerType: "multi_choice",
      // Per-option payouts on the 20→100 curve from historical baselines
      // (Planet World Cup): VAR-era 0.07 reds/match × 104 matches ≈ 7
      // expected reds, fat right tail from the 48-team expansion bringing
      // in less experienced teams. Probabilities: P(<8)≈60%,
      // P(8–13)≈28%, P(>13)≈12%.
      answerOptions: [
        { value: "lt_8",   labelHe: "פחות מ-8", labelEn: "Under 8", payoutOverride: 20  },
        { value: "8_13",   labelHe: "8–13",     labelEn: "8–13",    payoutOverride: 58  },
        { value: "gt_13",  labelHe: "מעל 13",   labelEn: "Over 13", payoutOverride: 100 },
      ],
      defaultStake: baseStake,
      defaultPayout: curveCeilingPayout,
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
      // Historical base rate: 6 of 20 WC finals (1966–2022) went to
      // penalties → ~30%. Per-branch payouts on the 20→100 curve so
      // the longshot ("yes") pays the ceiling and the favourite ("no")
      // pays the floor — same scale as the other tournament bets.
      yesNoOverrides: { yes: OUTRIGHT_PLAYER_CEILING, no: 20 },
      defaultStake: baseStake,
      defaultPayout: curveCeilingPayout,
      defaultLockAtIso: defaultLockIso,
    },
  ];
}

// ---------- data ----------

async function loadWcTeams(): Promise<Team[]> {
  return execRows<Team>(sql`
    select t.code as "code", t.name_he as "nameHe", t.name_en as "nameEn", t.flag as "flag"
    from public.teams t
    where t.group_id is not null
    order by t.name_en asc
  `);
}

async function loadLastWcKickoff(): Promise<{ kickoff_at: string } | null> {
  const r = await execFirstRow<{ kickoff_at: string | null }>(sql`
    select max(m.kickoff_at)::text as "kickoff_at"
    from public.matches m
  `);
  return r?.kickoff_at ? { kickoff_at: r.kickoff_at } : null;
}
