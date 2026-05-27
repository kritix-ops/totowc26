import Link from "next/link";
import { Flag } from "@/components/Flag";
import { Card, LabelCaps, SectionHeading } from "@/components/ui";
import { localePath } from "@/lib/paths";
import type { Locale } from "../dictionaries";
import type { LiveGroup } from "@/db/queries";

// Live group standings - derived from finished group-stage matches. Rendered
// as one Card per group with a compact, mobile-first table inside. Team rows
// are clickable links to /teams/[code].
//
// The top two rows of every group are tinted to signal "qualifies for
// knockout" (group winner / runner-up). The 32-team World Cup format makes
// 3rd qualify in some groups too, but we keep the band conservative.

export function LiveStandings({
  groups,
  locale,
  formByCode,
  formHeading,
  formTooltip,
  formNone,
}: {
  groups: LiveGroup[];
  locale: Locale;
  // Optional: 5-char form strings ("WDLWW") keyed by our local TLA. When
  // missing or empty for a team we show a single em-dash placeholder so
  // the column never visually breaks.
  formByCode?: Map<string, string>;
  formHeading?: string;
  formTooltip?: string;
  formNone?: string;
}) {
  const isHebrew = locale === "he";
  const anyPlayed = groups.some((g) =>
    g.rows.some((r) => r.played > 0),
  );

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <SectionHeading as="h2" underline="thin">
          {isHebrew ? "טבלאות חיות" : "Live tables"}
        </SectionHeading>
        <p className="text-sm text-on-surface-variant">
          {isHebrew
            ? "מתעדכן אוטומטית בכל סיום משחק. הסדר לפי נקודות → הפרש שערים → שערי זכות."
            : "Updates after every final whistle. Sorted by points → goal difference → goals for."}
        </p>
        {!anyPlayed && (
          <p className="text-sm text-on-surface-variant italic">
            {isHebrew
              ? "טרם שוחק אף משחק. הטבלאות יתחילו להתעדכן עם שריקת הפתיחה."
              : "No matches played yet. Tables come alive at first kickoff."}
          </p>
        )}
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {groups.map((g) => (
          <GroupCard
            key={g.id}
            group={g}
            locale={locale}
            isHebrew={isHebrew}
            formByCode={formByCode}
            formHeading={formHeading}
            formTooltip={formTooltip}
            formNone={formNone}
          />
        ))}
      </div>
    </section>
  );
}

function GroupCard({
  group,
  locale,
  isHebrew,
  formByCode,
  formHeading,
  formTooltip,
  formNone,
}: {
  group: LiveGroup;
  locale: Locale;
  isHebrew: boolean;
  formByCode?: Map<string, string>;
  formHeading?: string;
  formTooltip?: string;
  formNone?: string;
}) {
  const hasAnyForm =
    !!formByCode && group.rows.some((r) => (formByCode.get(r.code) ?? "").length > 0);
  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-4 py-3 bg-surface-container border-b border-outline-variant flex items-center justify-between">
        <span className="font-[family-name:var(--font-display)] text-base font-bold text-on-surface">
          {isHebrew ? "בית" : "Group"} <bdi>{group.id}</bdi>
        </span>
        <LabelCaps>
          {group.rows.reduce((s, r) => s + r.played, 0) / 2 || 0}{" "}
          {isHebrew ? "משחקים" : "matches"}
        </LabelCaps>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-surface-container-lowest">
          <tr className="text-on-surface-variant">
            <Th className="w-7 ps-3 text-center">#</Th>
            <Th className="text-start">{isHebrew ? "נבחרת" : "Team"}</Th>
            <Th className="text-center w-7" title={isHebrew ? "משחקים" : "Played"}>
              {isHebrew ? "מ" : "P"}
            </Th>
            <Th className="text-center w-7 hidden xs:table-cell" title={isHebrew ? "ניצחונות" : "Won"}>
              {isHebrew ? "נ" : "W"}
            </Th>
            <Th className="text-center w-7 hidden xs:table-cell" title={isHebrew ? "תיקו" : "Drawn"}>
              {isHebrew ? "ת" : "D"}
            </Th>
            <Th className="text-center w-7 hidden xs:table-cell" title={isHebrew ? "הפסדים" : "Lost"}>
              {isHebrew ? "ה" : "L"}
            </Th>
            <Th className="text-center w-12" title={isHebrew ? "הפרש שערים" : "Goal difference"}>
              {isHebrew ? "הש" : "GD"}
            </Th>
            <Th className="text-center w-8" title={isHebrew ? "נקודות" : "Points"}>
              {isHebrew ? "נק׳" : "Pts"}
            </Th>
            {hasAnyForm && (
              <Th
                className="text-center w-[68px] pe-3 hidden sm:table-cell"
                title={formTooltip}
              >
                {formHeading ?? (isHebrew ? "צורה" : "Form")}
              </Th>
            )}
          </tr>
        </thead>
        <tbody>
          {group.rows.map((row) => {
            const qualifies = row.position <= 2;
            return (
              <tr
                key={row.code}
                className={
                  qualifies
                    ? "bg-secondary-container/40 border-t border-outline-variant"
                    : "border-t border-outline-variant"
                }
              >
                <td className="ps-3 py-2 text-center font-[family-name:var(--font-display)] font-bold text-on-surface bidi-ltr">
                  {row.position}
                </td>
                <td className="py-2">
                  <Link
                    href={localePath(locale, `teams/${row.code}`)}
                    className="flex items-center gap-2 min-h-[44px] hover:bg-surface-container px-1 -mx-1 rounded transition-colors"
                  >
                    <Flag code={row.code} size={20} />
                    <span className="font-bold text-on-surface truncate">
                      {isHebrew ? row.nameHe : row.nameEn}
                    </span>
                  </Link>
                </td>
                <td className="py-2 text-center text-on-surface-variant bidi-ltr">
                  {row.played}
                </td>
                <td className="py-2 text-center text-on-surface-variant bidi-ltr hidden xs:table-cell">
                  {row.won}
                </td>
                <td className="py-2 text-center text-on-surface-variant bidi-ltr hidden xs:table-cell">
                  {row.drawn}
                </td>
                <td className="py-2 text-center text-on-surface-variant bidi-ltr hidden xs:table-cell">
                  {row.lost}
                </td>
                <td className="py-2 text-center bidi-ltr">
                  <span className={row.goalDiff > 0 ? "text-secondary font-bold" : row.goalDiff < 0 ? "text-error" : "text-on-surface-variant"}>
                    {row.goalDiff > 0 ? "+" : ""}
                    {row.goalDiff}
                  </span>
                </td>
                <td className="py-2 text-center font-[family-name:var(--font-display)] text-base font-bold text-on-surface bidi-ltr">
                  {row.points}
                </td>
                {hasAnyForm && (
                  <td className="pe-3 py-2 text-center hidden sm:table-cell">
                    <FormPills
                      form={formByCode?.get(row.code) ?? ""}
                      none={formNone ?? "—"}
                    />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

// Renders the 5-character form string ("WDLWW", newest on the right) as
// coloured pills. Hidden under `sm` because the column would crush the
// other numeric columns on a 360px phone - the W/D/L letters per row are
// already implicit in the # / W / D / L columns above.
function FormPills({ form, none }: { form: string; none: string }) {
  if (!form) {
    return <span className="text-on-surface-variant text-xs">{none}</span>;
  }
  return (
    <span className="inline-flex items-center gap-0.5 bidi-ltr" aria-label={form}>
      {form.split("").map((ch, i) => {
        const upper = ch.toUpperCase();
        const tone =
          upper === "W" ? "bg-secondary text-on-secondary"
          : upper === "L" ? "bg-error text-on-error"
          : "bg-surface-variant text-on-surface-variant";
        return (
          <span
            key={`${ch}-${i}`}
            className={`inline-flex items-center justify-center w-3.5 h-3.5 rounded-[3px] font-[family-name:var(--font-label)] text-[9px] font-bold tracking-tight ${tone}`}
            aria-hidden
          >
            {upper}
          </span>
        );
      })}
    </span>
  );
}

function Th({
  children,
  className,
  title,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <th
      className={`font-[family-name:var(--font-label)] text-[10px] font-bold tracking-[0.05em] uppercase py-2 ${className ?? ""}`}
      title={title}
    >
      {children}
    </th>
  );
}
