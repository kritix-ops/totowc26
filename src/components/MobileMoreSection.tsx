import type { Dictionary, Locale } from "@/app/[lang]/dictionaries";
import { getUserAccess } from "@/lib/access";
import { MobileMoreSheet } from "./MobileMoreSheet";

// Streams the "More" sheet trigger in the mobile bottom nav. Wrapped in
// Suspense at the AppShell so the four static cells (Home, Bets, Play,
// Leaderboard) render instantly and the More cell pops in once we know
// the user's role — Pay only for non-admins, Admin only for admins.
export async function MobileMoreSection({
  locale,
  dict,
  userId,
}: {
  locale: Locale;
  dict: Dictionary;
  userId: string;
}) {
  const access = await getUserAccess(userId);
  const admin = !!access?.isAdmin;
  const showPay = !admin;
  const isHebrew = locale === "he";

  return (
    <MobileMoreSheet
      locale={locale}
      showPay={showPay}
      isAdmin={admin}
      labels={{
        moreCell: dict.nav.more,
        tournament: dict.nav.tournament,
        liveScores: dict.nav.liveScores,
        duels: dict.nav.duels,
        transparency: dict.nav.transparency,
        pay: dict.nav.pay,
        profile: dict.nav.profile,
        admin: dict.nav.admin,
        rules: dict.nav.rules,
        logout: dict.profile.logout,
        openSheet: isHebrew ? "פתח עוד" : "Open more menu",
        closeSheet: isHebrew ? "סגור" : "Close",
      }}
    />
  );
}
