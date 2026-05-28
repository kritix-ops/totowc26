import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { clsx } from "clsx";
import type { Locale } from "../dictionaries";
import { Card, LabelCaps } from "@/components/ui";
import { localePath } from "@/lib/paths";

// Section container with a sticky-looking caps heading and a responsive
// child layout: vertical list under md (so labels never truncate on
// 360px), 2-column grid at md+ (desktop density). Used by the admin home
// and /admin/system for the same look.
export function AdminSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <LabelCaps className="px-1">{title}</LabelCaps>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{children}</div>
    </section>
  );
}

// Single tile. Mobile renders as a full-width row (icon + label takes
// the remaining width + chevron) so even the longest Hebrew strings fit
// at 360px. Desktop renders as a half-width tile inside the parent
// AdminSection grid. The "tone" hint paints the icon background warning
// when there is something the admin needs to attend to (pending count,
// duplicates, etc.).
export function AdminTile({
  locale,
  path,
  icon,
  label,
  badge,
  tone = "default",
}: {
  locale: Locale;
  path: string;
  icon: React.ReactNode;
  label: string;
  badge?: number;
  tone?: "default" | "warning";
}) {
  const iconBg =
    tone === "warning"
      ? "bg-tertiary-fixed text-on-tertiary-fixed-variant"
      : "bg-primary-fixed text-on-primary-fixed-variant";
  return (
    <Link href={localePath(locale, path)} className="press-down">
      <Card
        className={clsx(
          "p-4 flex items-center gap-3 min-h-[64px]",
          "hover:bg-surface-container transition-colors h-full",
        )}
      >
        <div
          className={clsx(
            "w-10 h-10 rounded-full flex items-center justify-center shrink-0",
            iconBg,
          )}
        >
          {icon}
        </div>
        <span className="flex-1 min-w-0 font-bold text-sm md:text-base text-on-surface">
          {label}
        </span>
        {badge !== undefined && (
          <span className="inline-flex items-center justify-center min-w-[24px] h-6 px-2 rounded-full bg-tertiary-fixed-dim text-on-tertiary-fixed-variant text-xs font-bold tabular-nums shrink-0">
            <bdi>{badge}</bdi>
          </span>
        )}
        <ChevronRight
          className="h-4 w-4 text-on-surface-variant shrink-0 rtl:rotate-180"
          strokeWidth={2}
        />
      </Card>
    </Link>
  );
}
