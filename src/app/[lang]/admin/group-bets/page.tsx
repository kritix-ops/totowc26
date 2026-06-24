import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq, isNotNull } from "drizzle-orm";
import { Flag, Plus, Pencil, ChevronLeft, ChevronRight } from "lucide-react";
import { hasLocale, type Locale } from "../../dictionaries";
import { Card, Chip, LabelCaps } from "@/components/ui";
import { localePath } from "@/lib/paths";
import { requireAdminAccess } from "@/lib/admin";
import { db } from "@/db";
import { customBets, groups, teams } from "@/db/schema";

// Dedicated "group bets" manager. One card per group (A–L) with its teams,
// the group-winner (and any other group-scoped) bets already created, and a
// one-click "create" that deep-links into the normal bet form pre-filled
// with this group's teams. Created so admins have an obvious single place to
// author and edit "who finishes first in group X" instead of hunting
// through the generic bet manager. See
// _plans/2026-06-25-group-bets-admin.md.

type GroupTeam = {
  code: string;
  nameHe: string;
  nameEn: string;
  flag: string;
};

type GroupBet = {
  id: string;
  questionHe: string;
  questionEn: string;
  status: string;
};

export default async function GroupBetsPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const isHebrew = locale === "he";
  const Chev = isHebrew ? ChevronLeft : ChevronRight;

  // Defense in depth: the admin layout already gates this path, but assert
  // access here too so a render never leaks behind a misconfigured route.
  await requireAdminAccess(locale);

  const [groupRows, teamRows, betRows] = await Promise.all([
    db.select({ id: groups.id }).from(groups).orderBy(asc(groups.displayOrder)),
    db
      .select({
        code: teams.code,
        nameHe: teams.nameHe,
        nameEn: teams.nameEn,
        flag: teams.flag,
        groupId: teams.groupId,
      })
      .from(teams)
      .where(isNotNull(teams.groupId))
      .orderBy(asc(teams.nameEn)),
    db
      .select({
        id: customBets.id,
        groupId: customBets.groupId,
        questionHe: customBets.questionHe,
        questionEn: customBets.questionEn,
        status: customBets.status,
      })
      .from(customBets)
      .where(eq(customBets.scope, "group"))
      .orderBy(asc(customBets.createdAt)),
  ]);

  const teamsByGroup = new Map<string, GroupTeam[]>();
  for (const t of teamRows) {
    if (!t.groupId) continue;
    const list = teamsByGroup.get(t.groupId) ?? [];
    list.push({ code: t.code, nameHe: t.nameHe, nameEn: t.nameEn, flag: t.flag });
    teamsByGroup.set(t.groupId, list);
  }

  const betsByGroup = new Map<string, GroupBet[]>();
  for (const b of betRows) {
    if (!b.groupId) continue;
    const list = betsByGroup.get(b.groupId) ?? [];
    list.push({
      id: b.id,
      questionHe: b.questionHe,
      questionEn: b.questionEn,
      status: b.status,
    });
    betsByGroup.set(b.groupId, list);
  }

  console.info("[group-bets] list", {
    groups: groupRows.length,
    groupBets: betRows.length,
  });

  return (
    <section className="px-4 md:px-10 py-6 md:py-12 flex flex-col gap-6 md:gap-8 max-w-5xl mx-auto w-full pb-24 md:pb-12">
      <header className="flex flex-col gap-3">
        <Link
          href={localePath(locale, "admin")}
          className="inline-flex items-center gap-1 text-sm text-on-surface-variant hover:text-on-surface w-fit"
        >
          <Chev className="h-4 w-4" strokeWidth={2} />
          {isHebrew ? "חזרה לניהול" : "Back to admin"}
        </Link>
        <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-9 md:text-[40px] md:leading-[44px] font-bold text-primary inline-flex items-center gap-3">
          <Flag className="h-6 w-6 md:h-7 md:w-7" strokeWidth={1.75} />
          {isHebrew ? "הימורי בתים" : "Group bets"}
        </h1>
        <p className="text-sm text-on-surface-variant">
          {isHebrew
            ? "כאן יוצרים ועורכים את הימורי הבתים (מי תסיים ראשונה בכל בית). לכל בית — צור הימור חדש שכבר ממולא בקבוצות הבית, או ערוך הימור קיים. הכל נשמר כטיוטה עד שתפרסם."
            : "Create and edit group bets (who finishes first in each group) here. For each group, create a new bet pre-filled with the group's teams, or edit an existing one. Everything saves as a draft until you publish."}
        </p>
      </header>

      {groupRows.length === 0 ? (
        <Card className="p-6 text-center text-on-surface-variant">
          {isHebrew
            ? "אין בתים עדיין. ודא שהסנכרון הראשוני של המשחקים רץ."
            : "No groups yet. Make sure the initial fixtures sync has run."}
        </Card>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {groupRows.map((g) => (
            <li key={g.id}>
              <GroupCard
                locale={locale}
                groupId={g.id}
                groupTeams={teamsByGroup.get(g.id) ?? []}
                bets={betsByGroup.get(g.id) ?? []}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function GroupCard({
  locale,
  groupId,
  groupTeams,
  bets,
}: {
  locale: Locale;
  groupId: string;
  groupTeams: GroupTeam[];
  bets: GroupBet[];
}) {
  const isHebrew = locale === "he";
  return (
    <Card className="p-4 md:p-5 flex flex-col gap-4 h-full">
      <header className="flex items-center justify-between gap-3">
        <h2 className="font-[family-name:var(--font-display)] text-xl md:text-2xl font-bold text-on-surface">
          {isHebrew ? `בית ${groupId}` : `Group ${groupId}`}
        </h2>
        <LabelCaps>
          {groupTeams.length}{" "}
          {isHebrew ? "קבוצות" : groupTeams.length === 1 ? "team" : "teams"}
        </LabelCaps>
      </header>

      {groupTeams.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {groupTeams.map((t) => (
            <li key={t.code}>
              <Chip tone="default" className="text-xs">
                <span aria-hidden>{t.flag}</span>
                {isHebrew ? t.nameHe : t.nameEn}
              </Chip>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-on-surface-variant">
          {isHebrew
            ? "אין קבוצות משויכות לבית הזה עדיין."
            : "No teams assigned to this group yet."}
        </p>
      )}

      {bets.length > 0 && (
        <ul className="flex flex-col gap-2">
          {bets.map((b) => (
            <li
              key={b.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2"
            >
              <div className="flex flex-col gap-1 min-w-0">
                <span className="text-sm font-bold text-on-surface truncate">
                  {isHebrew ? b.questionHe : b.questionEn}
                </span>
                <Chip tone={statusTone(b.status)} className="self-start text-[11px]">
                  {statusLabel(b.status, isHebrew)}
                </Chip>
              </div>
              <Link
                href={localePath(locale, `admin/bets/${b.id}`)}
                className="press-down shrink-0 inline-flex items-center gap-1.5 h-10 px-3 rounded-full bg-surface-container border border-outline text-on-surface text-xs font-bold"
              >
                <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
                {isHebrew ? "פתח" : "Open"}
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Link
        href={localePath(locale, `admin/bets/new?scope=group&groupId=${groupId}`)}
        className="press-down mt-auto inline-flex items-center justify-center gap-2 h-12 px-4 rounded-full bg-primary text-on-primary font-bold text-sm"
      >
        <Plus className="h-4 w-4" strokeWidth={2.5} />
        {bets.length > 0
          ? isHebrew
            ? "הימור נוסף לבית זה"
            : "Another bet for this group"
          : isHebrew
            ? "צור הימור 'מי ראשונה'"
            : "Create 'who finishes 1st'"}
      </Link>
    </Card>
  );
}

function statusLabel(status: string, isHebrew: boolean): string {
  const map: Record<string, [string, string]> = {
    draft: ["טיוטה", "Draft"],
    open: ["פתוח", "Open"],
    locked: ["נסגר", "Locked"],
    graded: ["נמדד", "Graded"],
    reversed: ["בוטל ניקוד", "Reversed"],
    cancelled: ["בוטל", "Cancelled"],
  };
  return (map[status] ?? [status, status])[isHebrew ? 0 : 1];
}

function statusTone(
  status: string,
): "default" | "primary" | "secondary" | "warning" {
  switch (status) {
    case "open":
      return "primary";
    case "locked":
      return "secondary";
    case "graded":
      return "warning";
    default:
      return "default";
  }
}
