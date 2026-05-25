import Link from "next/link";
import { sql } from "drizzle-orm";
import { Coins, ChevronRight } from "lucide-react";
import { db } from "@/db";
import { localePath } from "@/lib/paths";
import type { Locale } from "@/app/[lang]/dictionaries";

// Banner shown to paid users who have no tournament-level picks left
// (special_bets / bracket_predictions / group_predictions). After the
// 0006_points_bank migration these tables were cleared so everyone
// re-submits under the new pricing.
//
// Self-disposing: the moment the user fills in at least one pick of each
// kind the banner stops rendering. No localStorage flag needed.
export async function BankResetBanner({
  userId,
  locale,
  isPaid,
}: {
  userId: string;
  locale: Locale;
  isPaid: boolean;
}) {
  if (!isPaid) return null;

  const rows = await db.execute<{
    has_special: boolean;
    has_bracket: boolean;
    has_groups: boolean;
  }>(sql`
    select
      exists(select 1 from public.special_bets        where user_id = ${userId}) as "has_special",
      exists(select 1 from public.bracket_predictions where user_id = ${userId}) as "has_bracket",
      exists(select 1 from public.group_predictions   where user_id = ${userId}) as "has_groups"
  `);
  const r = (rows as unknown as Array<{
    has_special: boolean;
    has_bracket: boolean;
    has_groups: boolean;
  }>)[0];
  if (!r) return null;

  // All three filled in → nothing to nudge about.
  if (r.has_special && r.has_bracket && r.has_groups) return null;

  const isHebrew = locale === "he";
  const missing: Array<{ path: string; label: string }> = [];
  if (!r.has_groups) {
    missing.push({
      path: "standings",
      label: isHebrew ? "דירוג הבתים" : "Group standings",
    });
  }
  if (!r.has_bracket) {
    missing.push({
      path: "bracket",
      label: isHebrew ? "ארבעת הגדולים" : "Bracket",
    });
  }
  if (!r.has_special) {
    missing.push({
      path: "specials",
      label: isHebrew ? "הימורי על" : "Special bets",
    });
  }

  return (
    <aside
      role="status"
      className="bg-tertiary-fixed text-on-tertiary-fixed-variant border border-tertiary-fixed-dim rounded-xl p-4 md:p-5 flex flex-col gap-3"
    >
      <div className="flex items-start gap-3">
        <Coins className="h-6 w-6 shrink-0 mt-0.5" strokeWidth={1.75} />
        <div className="flex flex-col gap-1 min-w-0">
          <h3 className="font-[family-name:var(--font-display)] text-lg md:text-xl font-bold">
            {isHebrew
              ? "הוספנו מערכת בנק נקודות"
              : "We've added a points bank"}
          </h3>
          <p className="text-sm">
            {isHebrew
              ? "ההימורים הקבוצתיים שלך אופסו ביחד עם הוספת המערכת. כל פעולה מעבר ל-1/X/2 עכשיו עולה נקודות מהבנק שלך - הכנס למלא מחדש כדי להבטיח את המקום שלך."
              : "Your tournament picks were reset alongside the new system. Every action beyond 1/X/2 now costs from your bank — fill them in again to lock your spots."}
          </p>
        </div>
      </div>
      {missing.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {missing.map((m) => (
            <Link
              key={m.path}
              href={localePath(locale, m.path)}
              className="press-down inline-flex items-center gap-1.5 min-h-[40px] px-4 rounded-full bg-on-tertiary-fixed-variant text-tertiary-fixed font-bold text-sm hover:opacity-90"
            >
              {m.label}
              <ChevronRight className="h-4 w-4 rtl:rotate-180" strokeWidth={2.25} />
            </Link>
          ))}
        </div>
      )}
    </aside>
  );
}
