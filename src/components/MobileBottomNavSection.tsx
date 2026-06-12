import type { Dictionary, Locale } from "@/app/[lang]/dictionaries";
import { getUserAccess } from "@/lib/access";
import { getMobileNavConfig } from "@/lib/mobile-nav-server";
import {
  MOBILE_NAV_CATALOG,
  splitMobileNavItems,
} from "@/lib/mobile-nav";
import { MobileNavIcon } from "@/lib/mobile-nav-icons";
import { readHiddenPages } from "@/lib/page-visibility";
import { BottomNavLink } from "./NavLink";
import { MobileMoreSheet } from "./MobileMoreSheet";

// Resolves the admin-defined mobile nav layout against the current
// user's role and renders the bottom bar + (optionally) the More
// sheet. Wrapped in Suspense by AppShell so the rest of the layout
// chrome streams immediately while the access/config queries run
// (both are cached so the round-trip is single-digit ms).
//
// Layout rules implemented in `splitMobileNavItems`:
//   - role-gated items (pay / admin) are filtered out first
//   - if visible.length <= bottomBarCount: everything in the bar,
//     no More cell, no sheet
//   - else: (bottomBarCount - 1) items in the bar + a More cell, with
//     the remainder shown inside the sheet.
export async function MobileBottomNavSection({
  locale,
  dict,
  userId,
}: {
  locale: Locale;
  dict: Dictionary;
  userId: string;
}) {
  const [access, config, hiddenList] = await Promise.all([
    getUserAccess(userId),
    getMobileNavConfig(),
    readHiddenPages(),
  ]);
  const hiddenSet = new Set(hiddenList);
  const { bottom, sheet } = splitMobileNavItems(
    config,
    { isAdmin: access.isAdmin, canSeeAdminMenu: access.canSeeAdminMenu },
    hiddenSet,
  );

  const isHebrew = locale === "he";
  const hasMore = sheet.length > 0;
  const totalCells = bottom.length + (hasMore ? 1 : 0);

  // Degenerate config: admin saved an items list where every key was
  // role-gated against the current user. Rather than render an empty
  // 64px-tall bar that looks like a bug, drop the nav entirely.
  if (totalCells === 0) {
    console.warn("[mobile nav empty after role filter]", {
      userId,
      isAdmin: access.isAdmin,
      canSeeAdminMenu: access.canSeeAdminMenu,
      configItems: config.items,
    });
    return null;
  }
  // Tailwind JIT needs static class names. Map cell counts 2..5 to the
  // grid-cols utility (bottomBarCount is clamped server-side so we will
  // never see <2 or >5 here, but the fallback keeps the layout sane if
  // a future config schema change widens the range).
  const gridColsClass =
    totalCells === 5
      ? "grid-cols-5"
      : totalCells === 4
        ? "grid-cols-4"
        : totalCells === 3
          ? "grid-cols-3"
          : totalCells === 2
            ? "grid-cols-2"
            : "grid-cols-1";

  return (
    <nav
      aria-label={isHebrew ? "ניווט תחתון" : "Bottom"}
      className={`lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-surface-container rounded-t-xl border-t border-outline-variant shadow-[0_-4px_12px_rgba(28,20,15,0.05)] grid ${gridColsClass} items-stretch min-h-[64px] pb-[env(safe-area-inset-bottom)]`}
    >
      {bottom.map((key) => {
        const meta = MOBILE_NAV_CATALOG[key];
        const label = dict.nav[meta.dictKey];
        return (
          <BottomNavLink
            key={key}
            locale={locale}
            path={meta.path}
            label={label}
            icon={<MobileNavIcon itemKey={key} />}
            exact={meta.path === ""}
          />
        );
      })}
      {hasMore && (
        <MobileMoreSheet
          locale={locale}
          items={sheet.map((key) => ({
            key,
            path: MOBILE_NAV_CATALOG[key].path,
            label: dict.nav[MOBILE_NAV_CATALOG[key].dictKey],
          }))}
          labels={{
            moreCell: dict.nav.more,
            openSheet: isHebrew ? "פתח עוד" : "Open more menu",
            closeSheet: isHebrew ? "סגור" : "Close",
            logout: dict.profile.logout,
          }}
        />
      )}
    </nav>
  );
}
