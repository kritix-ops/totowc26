import Link from "next/link";
import { eq } from "drizzle-orm";
import {
  LayoutDashboard,
  ListChecks,
  Trophy,
  Users,
  User,
  LogIn,
  Shield,
  Wallet,
} from "lucide-react";
import type { Dictionary, Locale } from "@/app/[lang]/dictionaries";
import { localePath } from "@/lib/paths";
import { getUser } from "@/lib/supabase/auth";
import { getUserAccess } from "@/lib/access";
import { getMyRankSummary } from "@/db/queries";
import { getBankBreakdown } from "@/lib/bank";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { LanguageToggle } from "./LanguageToggle";
import { NavLink, BottomNavLink } from "./NavLink";
import { BrandLogo } from "./BrandLogo";
import { BankPill } from "./BankPill";
import { ViewAsBanner } from "./ViewAsBanner";
import { ProfileMenu } from "./ProfileMenu";

export async function AppShell({
  locale,
  dict,
  children,
}: {
  locale: Locale;
  dict: Dictionary;
  children: React.ReactNode;
}) {
  const home = localePath(locale);
  const isHebrew = locale === "he";

  const user = await getUser();
  const signedIn = !!user;
  const [rankSummary, access, bank, profileRow] = signedIn
    ? await Promise.all([
        getMyRankSummary(user.id),
        getUserAccess(user.id),
        getBankBreakdown(user.id),
        db
          .select({ displayName: profiles.displayName })
          .from(profiles)
          .where(eq(profiles.id, user.id))
          .limit(1)
          .then((r) => r[0] ?? null),
      ])
    : [null, null, null, null];
  const displayName =
    profileRow?.displayName ?? user?.email ?? "";
  // `access.isAdmin` is the EFFECTIVE role — it's false while an admin
  // impersonates a player, so the nav swaps to the player layout. The
  // banner + the action server-side gates already pick up the same
  // impersonation through the cookie.
  const admin = !!access?.isAdmin;
  const viewingAs = access?.viewingAs ?? null;
  // Admin never has anything to pay, so the /pay tab only adds noise. Hide
  // it for them and keep the bottom nav compact.
  const showPay = signedIn && !admin;
  console.info("[app shell render]", {
    signedIn,
    isAdmin: admin,
    viewingAs,
    myRank: rankSummary?.myRank ?? null,
    totalPlayers: rankSummary?.total ?? null,
  });

  return (
    <>
      {viewingAs && (
        <div className="fixed top-0 left-0 right-0 z-[60]">
          <ViewAsBanner locale={locale} role={viewingAs} />
        </div>
      )}
      <header
        className={`bg-surface border-b border-outline-variant shadow-sm fixed left-0 right-0 w-full px-4 md:px-16 h-14 md:h-16 z-50 flex items-center justify-between gap-3 ${viewingAs ? "top-[40px]" : "top-0"}`}
      >
        <Link
          href={home}
          aria-label={isHebrew ? "טוטו מונדיאל" : "Toto Mundial"}
          className="flex items-center min-w-0 shrink-0"
        >
          <BrandLogo locale={locale} size="header" />
        </Link>

        {signedIn && (
          <nav
            aria-label={isHebrew ? "ניווט ראשי" : "Main"}
            className="hidden md:flex items-center gap-6 h-full"
          >
            <NavLink locale={locale} path="" label={dict.nav.home} exact />
            <NavLink locale={locale} path="bets" label={dict.nav.myBets} />
            <NavLink locale={locale} path="play" label={dict.nav.play} />
            <NavLink locale={locale} path="standings" label={dict.nav.standings} />
            <span aria-hidden className="h-4 w-px bg-outline-variant" />
            <NavLink locale={locale} path="club" label={dict.nav.club} />
            {showPay && (
              <NavLink locale={locale} path="pay" label={dict.nav.pay} />
            )}
            {admin && (
              <>
                <span aria-hidden className="h-4 w-px bg-outline-variant" />
                <NavLink locale={locale} path="admin" label={dict.nav.admin} />
              </>
            )}
          </nav>
        )}

        <div className="flex items-center gap-2 md:gap-4 shrink-0">
          {signedIn ? (
            <>
              {bank && (
                <BankPill
                  locale={locale}
                  dict={dict}
                  balance={bank.balance}
                  starting={bank.starting}
                />
              )}
              {rankSummary && rankSummary.myRank > 0 ? (
                <span className="hidden md:inline-block font-[family-name:var(--font-label)] text-[12px] font-bold tracking-[0.05em] text-on-surface-variant">
                  {dict.common.rankShort} <bdi>#{rankSummary.myRank}</bdi>
                </span>
              ) : null}
              <ProfileMenu
                locale={locale}
                displayName={displayName}
                isAdmin={admin}
                labels={{
                  profile: dict.nav.profile,
                  admin: dict.nav.admin,
                  logout: dict.profile.logout,
                  openMenu: dict.nav.openMenu,
                }}
              />
            </>
          ) : (
            <Link
              href={localePath(locale, "login")}
              className="press-down inline-flex items-center gap-1.5 min-h-[40px] px-3 md:px-4 rounded-full bg-primary text-on-primary font-[family-name:var(--font-label)] text-[12px] md:text-[13px] font-bold tracking-[0.05em] hover:bg-surface-tint transition-colors"
            >
              <LogIn className="h-4 w-4" strokeWidth={2} />
              {isHebrew ? "התחבר" : "Sign in"}
            </Link>
          )}
          <LanguageToggle currentLocale={locale} label={dict.common.languageToggle} />
        </div>
      </header>

      <main
        className={`flex-grow ${viewingAs ? "pt-[calc(40px+3.5rem)] md:pt-[calc(40px+4rem)]" : "pt-14 md:pt-16"} ${signedIn ? "pb-24 md:pb-8" : "pb-8"}`}
      >
        {children}
      </main>

      {signedIn && (
        <nav
          aria-label={isHebrew ? "ניווט תחתון" : "Bottom"}
          // 6 cells for everyone: players get …+ Pay + Profile, admins get
          // …+ Profile + Admin. Keeping the count fixed avoids a layout
          // jump when the role toggles.
          className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-surface-container rounded-t-xl border-t border-outline-variant shadow-[0_-4px_12px_rgba(28,20,15,0.05)] grid grid-cols-6 items-stretch min-h-[64px] pb-[env(safe-area-inset-bottom)]"
        >
          <BottomNavLink locale={locale} path="" label={dict.nav.dashboard} icon={<LayoutDashboard className="h-5 w-5" strokeWidth={1.75} />} exact />
          <BottomNavLink locale={locale} path="bets" label={dict.nav.predictions} icon={<ListChecks className="h-5 w-5" strokeWidth={1.75} />} />
          <BottomNavLink locale={locale} path="club" label={dict.nav.club} icon={<Users className="h-5 w-5" strokeWidth={1.75} />} />
          <BottomNavLink locale={locale} path="leaderboard" label={dict.nav.leaderboard} icon={<Trophy className="h-5 w-5" strokeWidth={1.75} />} />
          {showPay && (
            <BottomNavLink locale={locale} path="pay" label={dict.nav.pay} icon={<Wallet className="h-5 w-5" strokeWidth={1.75} />} />
          )}
          <BottomNavLink locale={locale} path="profile" label={dict.nav.profile} icon={<User className="h-5 w-5" strokeWidth={1.75} />} />
          {admin && (
            <BottomNavLink locale={locale} path="admin" label={dict.nav.admin} icon={<Shield className="h-5 w-5" strokeWidth={1.75} />} />
          )}
        </nav>
      )}
    </>
  );
}
