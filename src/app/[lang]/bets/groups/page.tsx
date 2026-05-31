import { notFound, redirect } from "next/navigation";
import { Sparkles } from "lucide-react";
import { sql } from "drizzle-orm";
import { hasLocale, type Locale } from "../../dictionaries";
import { Card, SectionHeading } from "@/components/ui";
import { Flag } from "@/components/Flag";
import {
  CustomBetCard,
  type CustomBetCardData,
} from "@/components/CustomBetCard";
import { BetsTabs } from "@/components/BetsTabs";
import { getUser } from "@/lib/supabase/auth";
import { getUserAccess } from "@/lib/access";
import { getBankBalance } from "@/lib/bank";
import { localePath } from "@/lib/paths";
import { serverNow } from "@/lib/server-now";
import { execRows } from "@/db/helpers";
import { getGroupPlayBets, type GroupPlayBetRow } from "@/db/queries";
import type { AnswerConfig, PickAnswer } from "@/lib/bets/types";

// Group-rankings bets. Moved here from /play/groups under the
// unified /bets URL with shared tab navigation.

type GroupTeam = {
  groupId: string;
  displayOrder: number;
  code: string;
  nameHe: string;
  nameEn: string;
  flag: string;
};

async function listGroupTeams(): Promise<GroupTeam[]> {
  return execRows<GroupTeam>(sql`
    select
      g.id              as "groupId",
      g.display_order   as "displayOrder",
      t.code            as "code",
      t.name_he         as "nameHe",
      t.name_en         as "nameEn",
      t.flag            as "flag"
    from public.groups g
    join public.teams  t on t.group_id = g.id
    order by g.display_order asc, t.code asc
  `);
}

// Explicit prop typing — the auto-generated AppRoutes constraint does
// not pick up new routes until after a `next build`, so we declare the
// params shape locally to avoid a build-order coupling.
type PageParams = {
  params: Promise<{ lang: string }>;
};

export default async function BetsGroupsPage({
  params,
}: PageParams) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const isHebrew = locale === "he";

  const user = await getUser();
  if (!user) redirect(localePath(locale, "login"));
  const access = await getUserAccess(user.id);

  const [bets, teams, bankBalance] = await Promise.all([
    getGroupPlayBets(user.id),
    listGroupTeams(),
    getBankBalance(user.id),
  ]);

  const nowMs = serverNow();
  const isEditable = (b: { status: string; lockAt: string }) =>
    access.canEdit && b.status === "open" && new Date(b.lockAt).getTime() > nowMs;

  // Bucket: groupId → { teams, bets }. Iterate in display_order.
  const groups = new Map<
    string,
    { displayOrder: number; teams: GroupTeam[]; bets: GroupPlayBetRow[] }
  >();
  for (const t of teams) {
    const entry = groups.get(t.groupId) ?? {
      displayOrder: t.displayOrder,
      teams: [],
      bets: [],
    };
    entry.teams.push(t);
    groups.set(t.groupId, entry);
  }
  for (const b of bets) {
    const entry = groups.get(b.groupId);
    if (entry) entry.bets.push(b);
  }
  const orderedGroups = Array.from(groups.entries()).sort(
    (a, b) => a[1].displayOrder - b[1].displayOrder,
  );

  const totalBets = bets.length;

  return (
    <section className="px-4 md:px-16 py-6 md:py-12 flex flex-col gap-6 md:gap-8 max-w-3xl mx-auto w-full pb-24">
      <header className="flex flex-col gap-3">
        <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-9 md:text-[40px] md:leading-[44px] font-bold text-primary">
          {isHebrew ? "הימורים" : "Bets"}
        </h1>
        <BetsTabs locale={locale} active="groups" />
        <h2 className="font-[family-name:var(--font-display)] text-lg md:text-xl font-bold text-on-surface inline-flex items-center gap-2 mt-2">
          <Sparkles className="h-5 w-5 text-tertiary-fixed-dim" strokeWidth={1.75} />
          {isHebrew ? "דירוגי בתים" : "Group rankings"}
        </h2>
        <p className="text-sm text-on-surface-variant">
          {isHebrew
            ? "ניחושים על כל בית בנפרד. כל הימור נסגר לפי הלוח שהאדמין הגדיר."
            : "Predictions per group. Each bet locks at the schedule the admin set."}
        </p>
      </header>

      {totalBets === 0 ? (
        <Card className="p-6 text-center text-on-surface-variant">
          {isHebrew
            ? "עוד אין הימורי בתים פתוחים. בדוק שוב לקראת פתיחת הטורניר."
            : "No group bets open yet. Check back closer to kickoff."}
        </Card>
      ) : (
        <div className="flex flex-col gap-6 md:gap-8">
          {orderedGroups.map(([groupId, entry]) =>
            entry.bets.length === 0 ? null : (
              <section key={groupId} className="flex flex-col gap-3">
                <SectionHeading as="h3" underline="thin">
                  {isHebrew ? `בית ${groupId}` : `Group ${groupId}`}
                </SectionHeading>
                <Card className="p-4 md:p-5 flex flex-wrap items-center gap-3">
                  {entry.teams.map((t) => (
                    <div
                      key={t.code}
                      className="inline-flex items-center gap-2 min-w-0"
                    >
                      <Flag code={t.code} size={28} />
                      <span className="text-sm font-bold text-on-surface truncate">
                        {isHebrew ? t.nameHe : t.nameEn}
                      </span>
                    </div>
                  ))}
                </Card>
                <div className="flex flex-col gap-3">
                  {entry.bets.map((b) => (
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
            ),
          )}
        </div>
      )}
    </section>
  );
}

function toCardData(row: GroupPlayBetRow): CustomBetCardData {
  return {
    id: row.id,
    questionHe: row.questionHe,
    questionEn: row.questionEn,
    gradingRuleHe: row.gradingRuleHe,
    gradingRuleEn: row.gradingRuleEn,
    answerType: row.answerType,
    answerConfig: row.answerConfig as AnswerConfig,
    // getGroupPlayBets filters WHERE scope = 'group' — every row here
    // is by construction a group-scope bet, so it's a free pick.
    scope: "group",
    stakeSnapshot: row.stakeSnapshot,
    payoutSnapshot: row.payoutSnapshot,
    lockAt: row.lockAt,
    status: row.status,
    myAnswer: (row.myAnswer ?? null) as PickAnswer | null,
    myStakePaid: row.myStakePaid,
  };
}
