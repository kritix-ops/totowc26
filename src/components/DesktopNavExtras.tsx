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
  const admin = !!access?.isAdmin;
  const showPay = !admin && !payHidden;
  return (
    <>
      {showPay && (
        <NavLink locale={locale} path="pay" label={dict.nav.pay} />
      )}
      {admin && (
        <>
          <span aria-hidden className="h-4 w-px bg-outline-variant" />
          <NavLink locale={locale} path="admin" label={dict.nav.admin} />
        </>
      )}
    </>
  );
}
