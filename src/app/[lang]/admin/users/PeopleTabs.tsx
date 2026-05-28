import Link from "next/link";
import { Users, UserPlus, Wallet } from "lucide-react";
import { clsx } from "clsx";
import type { Locale } from "../../dictionaries";
import { localePath } from "@/lib/paths";

export type PeopleTab = "players" | "requests" | "payments";

// URL-driven segmented control between the two people-management
// surfaces (active players and pending signup requests). Rendered as a
// server component on purpose: the active tab is encoded in the URL
// (?tab=requests), so we don't need client state and the tabs work
// without JS. Touch targets are 48px and the layout stays single-row at
// 360px width because the labels are short.
export function PeopleTabs({
  locale,
  active,
  pendingRequestsCount,
  pendingPaymentsCount,
}: {
  locale: Locale;
  active: PeopleTab;
  pendingRequestsCount: number;
  pendingPaymentsCount: number;
}) {
  const isHebrew = locale === "he";
  return (
    <div
      role="tablist"
      aria-label={isHebrew ? "ניהול משתתפים" : "People management"}
      className="bg-surface-container-low border border-outline-variant rounded-full p-1 flex gap-1 self-stretch md:self-start overflow-x-auto"
    >
      <TabLink
        locale={locale}
        href="admin/users"
        active={active === "players"}
        icon={<Users className="h-4 w-4" strokeWidth={2} />}
        label={isHebrew ? "משתתפים" : "Players"}
      />
      <TabLink
        locale={locale}
        href="admin/users?tab=requests"
        active={active === "requests"}
        icon={<UserPlus className="h-4 w-4" strokeWidth={2} />}
        label={isHebrew ? "בקשות" : "Requests"}
        badge={pendingRequestsCount > 0 ? pendingRequestsCount : undefined}
      />
      <TabLink
        locale={locale}
        href="admin/users?tab=payments"
        active={active === "payments"}
        icon={<Wallet className="h-4 w-4" strokeWidth={2} />}
        label={isHebrew ? "תשלומים" : "Payments"}
        badge={pendingPaymentsCount > 0 ? pendingPaymentsCount : undefined}
      />
    </div>
  );
}

function TabLink({
  locale,
  href,
  active,
  icon,
  label,
  badge,
}: {
  locale: Locale;
  href: string;
  active: boolean;
  icon: React.ReactNode;
  label: string;
  badge?: number;
}) {
  return (
    <Link
      role="tab"
      aria-selected={active}
      href={localePath(locale, href)}
      className={clsx(
        "press-down flex-1 inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2 rounded-full text-sm font-bold transition-colors whitespace-nowrap",
        active
          ? "bg-primary text-on-primary shadow-md"
          : "bg-transparent text-on-surface-variant hover:bg-surface-container",
      )}
    >
      {icon}
      <span>{label}</span>
      {badge !== undefined && (
        <span
          className={clsx(
            "inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-full text-[11px] font-bold tabular-nums",
            active
              ? "bg-on-primary text-primary"
              : "bg-tertiary text-on-tertiary",
          )}
        >
          <bdi>{badge}</bdi>
        </span>
      )}
    </Link>
  );
}
