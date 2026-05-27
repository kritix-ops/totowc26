import Link from "next/link";
import { Suspense } from "react";
import { BookOpen, Home, ListChecks, Sparkles, Trophy } from "lucide-react";
import type { Dictionary, Locale } from "@/app/[lang]/dictionaries";
import { localePath } from "@/lib/paths";
import { getRequestUser } from "@/lib/request-user";
import { getViewAs } from "@/lib/view-as";
import { NavLink, BottomNavLink } from "./NavLink";
import { BrandLogo } from "./BrandLogo";
import { HeaderUserSection } from "./HeaderUserSection";
import { GuestHeaderActions } from "./GuestHeaderActions";
import { DesktopNavExtras } from "./DesktopNavExtras";
import { MobileMoreSection } from "./MobileMoreSection";
import { ViewAsBannerSection } from "./ViewAsBannerSection";
import {
  DesktopNavExtrasSkeleton,
  GuestActionsSkeleton,
  HeaderUserSkeleton,
  MobileMoreSkeleton,
} from "./AppShellSkeletons";

// The AppShell is the layout chrome that wraps every page. The whole
// reason this component exists in its current shape is to be FAST: on
// every client-side navigation Next.js re-renders the layout chain, so
// anything this component awaits is a tax paid on every click. We pay
// nothing here other than a single `headers()` read (free — it's
// request-time, not a DB call) to decide whether the user is signed in.
// Every per-user surface (bank pill, rank, profile menu, view-as
// banner, Pay/Admin nav extras, mobile More sheet) streams in behind a
// <Suspense> boundary with a skeleton matching its real dimensions.
//
// The static parts (logo, rules CTA, fixed nav items, bottom nav with
// the 4 always-visible cells, the <main> children) are emitted as the
// first byte of the response so the user sees a complete shell
// instantly and the heavy queries fan out in parallel underneath.
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

  // Cheap synchronous-ish header read — populated by the proxy after
  // it verifies the Supabase session. Saves a second auth round-trip
  // on every navigation.
  const reqUser = await getRequestUser();
  const signedIn = !!reqUser;

  // Reserve 40px at the top of the viewport for the "viewing-as"
  // admin banner only when the cookie indicates an impersonation is
  // active. This is read synchronously (cheap cookie lookup) so the
  // header is positioned correctly on first paint — the banner itself
  // still streams in behind Suspense, but the slot is already there
  // so its arrival does not shift the header down.
  const viewAsCookie = signedIn ? await getViewAs() : null;
  const reserveBanner = !!viewAsCookie;
  const headerTopClass = reserveBanner ? "top-[40px]" : "top-0";
  const mainTopPaddingClass = reserveBanner
    ? "pt-[calc(40px+3.5rem)] md:pt-[calc(40px+4rem)]"
    : "pt-14 md:pt-16";

  console.info("[app shell render]", {
    signedIn,
    userId: reqUser?.id ?? null,
    reserveBanner,
    streamingSections: signedIn
      ? ["ViewAsBanner", "DesktopNavExtras", "HeaderUserSection", "MobileMoreSection"]
      : ["GuestHeaderActions"],
  });

  return (
    <>
      {signedIn && (
        <Suspense fallback={null}>
          <ViewAsBannerSection locale={locale} userId={reqUser.id} />
        </Suspense>
      )}
      {/*
        3-column grid so the centre nav truly sits in the middle of the
        viewport regardless of how wide the left and right clusters
        grow. With `justify-between` (the previous layout) the nav
        snapped to the logo's side and left a giant gap on the user-
        pill side — see the screenshot the user flagged. Grid keeps
        the nav optically balanced; the side columns simply expand as
        needed inside their own auto-sized cells.
      */}
      <header className={`bg-surface border-b border-outline-variant shadow-sm fixed left-0 right-0 w-full px-3 md:px-16 h-14 md:h-16 z-50 grid grid-cols-[auto_1fr_auto] items-center gap-2 md:gap-4 ${headerTopClass}`}>
        <div className="flex items-center gap-2 md:gap-3 min-w-0">
          <Link
            href={home}
            aria-label={isHebrew ? "טוטו מונדיאל" : "Toto Mundial"}
            className="flex items-center min-w-0 shrink-0"
          >
            <BrandLogo locale={locale} size="header" />
          </Link>

          {/* "How it works" CTA. Shown to signed-in users only —
              guests on the landing page do not need this shortcut
              since the landing hero already explains the product.
              Text on md+ for a clear call-to-action, icon-only on
              mobile so it does not crowd the bank pill on narrow
              screens. */}
          {signedIn && (
            <Link
              href={localePath(locale, "rules")}
              aria-label={dict.nav.rulesCtaLong}
              title={dict.nav.rulesCtaLong}
              className="press-down inline-flex items-center gap-1.5 min-h-[36px] px-2 md:px-3 rounded-full bg-tertiary-fixed text-on-tertiary-fixed-variant border border-tertiary-fixed-dim hover:bg-tertiary-container transition-[background-color,color] duration-150 shrink-0"
            >
              <BookOpen className="h-4 w-4" strokeWidth={2} />
              <span className="hidden md:inline font-[family-name:var(--font-label)] text-[12px] font-bold tracking-[0.05em]">
                {dict.nav.rulesCta}
              </span>
            </Link>
          )}
        </div>

        {signedIn ? (
          <nav
            aria-label={isHebrew ? "ניווט ראשי" : "Main"}
            className="hidden md:flex items-center justify-center gap-6 h-full"
          >
            <NavLink locale={locale} path="" label={dict.nav.home} exact />
            <NavLink locale={locale} path="bets" label={dict.nav.matchPicks} />
            <NavLink locale={locale} path="play" label={dict.nav.play} />
            <NavLink locale={locale} path="duels" label={dict.nav.duels} />
            <NavLink locale={locale} path="leaderboard" label={dict.nav.leaders} />
            <NavLink locale={locale} path="tournament" label={dict.nav.tournament} />
            <Suspense fallback={<DesktopNavExtrasSkeleton />}>
              <DesktopNavExtras locale={locale} dict={dict} userId={reqUser.id} />
            </Suspense>
          </nav>
        ) : (
          // Empty centre cell for guests keeps the grid template
          // balanced so logo and login pills stay anchored to their
          // sides instead of drifting toward each other.
          <div aria-hidden />
        )}

        <div className="flex items-center gap-2 md:gap-4 shrink-0 justify-self-end">
          {signedIn ? (
            <Suspense fallback={<HeaderUserSkeleton />}>
              <HeaderUserSection
                locale={locale}
                dict={dict}
                userId={reqUser.id}
                userEmail={reqUser.email}
              />
            </Suspense>
          ) : (
            <Suspense fallback={<GuestActionsSkeleton />}>
              <GuestHeaderActions locale={locale} dict={dict} />
            </Suspense>
          )}
        </div>
      </header>

      <main className={`flex-grow ${mainTopPaddingClass} ${signedIn ? "pb-24 md:pb-8" : "pb-8"}`}>
        {children}
      </main>

      {signedIn && (
        <nav
          aria-label={isHebrew ? "ניווט תחתון" : "Bottom"}
          // 5 fixed cells matching the desktop order, then a "More"
          // trigger for the items that did not fit (World Cup, Pay,
          // Profile, Admin, Logout). Order is intentionally identical
          // to the desktop top nav so users switching devices see the
          // same hierarchy.
          className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-surface-container rounded-t-xl border-t border-outline-variant shadow-[0_-4px_12px_rgba(28,20,15,0.05)] grid grid-cols-5 items-stretch min-h-[64px] pb-[env(safe-area-inset-bottom)]"
        >
          <BottomNavLink locale={locale} path="" label={dict.nav.home} icon={<Home className="h-5 w-5" strokeWidth={1.75} />} exact />
          <BottomNavLink locale={locale} path="bets" label={dict.nav.matchPicks} icon={<ListChecks className="h-5 w-5" strokeWidth={1.75} />} />
          <BottomNavLink locale={locale} path="play" label={dict.nav.play} icon={<Sparkles className="h-5 w-5" strokeWidth={1.75} />} />
          <BottomNavLink locale={locale} path="leaderboard" label={dict.nav.leaders} icon={<Trophy className="h-5 w-5" strokeWidth={1.75} />} />
          <Suspense fallback={<MobileMoreSkeleton />}>
            <MobileMoreSection locale={locale} dict={dict} userId={reqUser.id} />
          </Suspense>
        </nav>
      )}
    </>
  );
}
