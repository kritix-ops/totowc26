import type { Dictionary, Locale } from "@/app/[lang]/dictionaries";
import { getUserAccess } from "@/lib/access";
import { isPageHidden } from "@/lib/page-visibility";
import { NavLink } from "./NavLink";

// Streams the role-dependent nav items (Pay for paid players, Admin for
// admins). Wrapped in Suspense in the AppShell so the static nav items
// — Home, Bets, Play, Duels, Leaderboard, Tournament — render
// instantly while access is being resolved. Once it lands, the Pay/Admin
// items appear without shifting the static items.
export async function DesktopNavExtras({
  locale,
  dict,
  userId,
}: {
  locale: Locale;
  dict: Dictionary;
  userId: string;
}) {
  const [access, payHidden] = await Promise.all([
    getUserAccess(userId),
    isPageHidden("pay"),
  ]);
  // Pay hides only for FULL admins (they skip payment). Scoped operators
  // are still players for everything outside the admin pages, so they
  // see Pay alongside Admin. canSeeAdminMenu covers full admin + any
  // scoped permission, plus respects the impersonation "view as".
  const isAdmin = !!access?.isAdmin;
  const canSeeAdmin = !!access?.canSeeAdminMenu;
  const showPay = !isAdmin && !payHidden;
  return (
    <>
      {showPay && (
        <NavLink locale={locale} path="pay" label={dict.nav.pay} />
      )}
      {canSeeAdmin && (
        <>
          <span aria-hidden className="h-4 w-px bg-outline-variant" />
          <NavLink locale={locale} path="admin" label={dict.nav.admin} />
        </>
      )}
    </>
  );
}
