import Link from "next/link";
import { Card, LabelCaps, SectionHeading } from "@/components/ui";
import { Flag } from "@/components/Flag";
import { localePath } from "@/lib/paths";
import { getAllTeamsWithRecord, type TeamCardRow } from "@/lib/stats";
import type { Locale } from "../dictionaries";
import { settle } from "./safe";

// All 32 nations grouped by FIFA group, each card a link to /teams/[code].
// Lives in its own tab so the Summary stays glanceable instead of having to
// scroll past 32 team cards to reach anything below.

export async function TeamsTab({ locale }: { locale: Locale }) {
  const teams = await settle<TeamCardRow[]>("teams", [], () => getAllTeamsWithRecord());
  const isHebrew = locale === "he";

  const byGroup = new Map<string | null, TeamCardRow[]>();
  for (const t of teams) {
    const list = byGroup.get(t.groupId) ?? [];
    list.push(t);
    byGroup.set(t.groupId, list);
  }
  const groupKeys = [...byGroup.keys()].sort((a, b) => {
    if (a === null) return 1;
    if (b === null) return -1;
    return a.localeCompare(b);
  });

  return (
    <section className="flex flex-col gap-4">
      <SectionHeading as="h2" underline="thin">
        {isHebrew ? "כל הנבחרות" : "All teams"}
      </SectionHeading>
      <div className="flex flex-col gap-6">
        {groupKeys.map((g) => {
          const list = byGroup.get(g) ?? [];
          return (
            <div key={g ?? "ungrouped"} className="flex flex-col gap-2">
              <LabelCaps as="div">
                {g
                  ? isHebrew ? `בית ${g}` : `Group ${g}`
                  : isHebrew ? "ללא בית" : "Unassigned"}
              </LabelCaps>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {list.map((t) => (
                  <TeamCard
                    key={t.code}
                    team={t}
                    locale={locale}
                    isHebrew={isHebrew}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function TeamCard({
  team,
  locale,
  isHebrew,
}: {
  team: TeamCardRow;
  locale: Locale;
  isHebrew: boolean;
}) {
  return (
    <Link
      href={localePath(locale, `teams/${team.code}`)}
      className="press-down"
    >
      <Card className="p-3 flex items-center gap-2 min-h-[64px] hover:bg-surface-container transition-colors">
        <Flag code={team.code} size={28} />
        <div className="flex flex-col min-w-0 flex-1">
          <span className="font-bold text-sm text-on-surface truncate">
            {isHebrew ? team.nameHe : team.nameEn}
          </span>
          <span className="text-[11px] text-on-surface-variant bidi-ltr">
            {team.played > 0
              ? `${team.won}-${team.drawn}-${team.lost} · ${team.points}${isHebrew ? "נק'" : "p"}`
              : isHebrew ? "טרם שיחקה" : "-"}
          </span>
        </div>
      </Card>
    </Link>
  );
}
