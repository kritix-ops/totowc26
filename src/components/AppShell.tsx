import Link from "next/link";
import { Suspense } from "react";
import { BookOpen } from "lucide-react";
import type { Dictionary, Locale } from "@/app/[lang]/dictionaries";
import { localePath } from "@/lib/paths";
import { getRequestUser } from "@/lib/request-user";
import { getViewAs } from "@/lib/view-as";
import { readHiddenPages } from "@/lib/page-visibility";
import { NavLink } from "./NavLink";
import { BrandLogo } from "./BrandLogo";
import { HeaderUserSection } from "./HeaderUserSection";
import { GuestHeaderActions } from "./GuestHeaderActions";
import { DesktopNavExtras } from "./DesktopNavExtras";
import { MobileBottomNavSection } from "./MobileBottomNavSection";
import { ViewAsBannerSection } from "./ViewAsBannerSection";
import { UnpaidBannerSection } from "./UnpaidBannerSection";
import { getUserAccess } from "@/lib/access";
import { isSandbox } from "@/lib/env";
import {
  DesktopNavExtrasSkeleton,
  GuestActionsSkeleton,
  HeaderUserSkeleton,
  MobileBottomNavSkeleton,
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
// The static parts (logo, rules CTA, fixed top-nav items, the <main>
// children) are emitted as the first byte of the response so the user
// sees a complete shell instantly and the heavy queries fan out in
// parallel underneath. The mobile bottom nav is admin-controlled and
// streams in behind a skeleton (it depends on the settings row).
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

  // Admin-controlled hide list. Cached per request so the desktop
  // header, the mobile bottom nav, and any page-level `gatePage` call
  // share a single read. Stays at "[]" for guests; cheap select either way.
  const hiddenPages = new Set(await readHiddenPages());

  // Reserve 40px at the top of the viewport for either the
  // "viewing-as" admin banner OR the persistent unpaid-player banner.
  // View-as is decided from the cookie (cheap sync read); paid status
  // comes from getUserAccess, which is cross-request cached so the
  // synchronous wait here is almost always a cache hit. The slot is
  // pre-reserved so the streaming banner content does not shift the
  // header down when it arrives.
  //
  // Priority: view-as wins. If an admin is impersonating, the view-as
  // banner already says "viewing as an unpaid player", so stacking the
  // unpaid banner under it would just be noise.
  const viewAsCookie = signedIn ? await getViewAs() : null;
  const access = signedIn ? await getUserAccess(reqUser!.id) : null;
  const showViewAsBanner = !!viewAsCookie;
  const showUnpaidBanner =
    signedIn && !showViewAsBanner && !!access && !access.canEdit;
  const reserveBanner = showViewAsBanner || showUnpaidBanner;
  // The SandboxBanner (mounted in layout.tsx) takes another 40px at the
  // very top in sandbox mode. The header and the view-as / unpaid
  // banners shift down to match so they never sit under it.
  const sandbox = isSandbox();
  const headerTopClass = sandbox
    ? reserveBanner
      ? "top-[80px]"
      : "top-[40px]"
    : reserveBanner
      ? "top-[40px]"
      : "top-0";
  const mainTopPaddingClass = sandbox
    ? reserveBanner
      ? "pt-[calc(80px+3.5rem)] md:pt-[calc(80px+4rem)]"
      : "pt-[calc(40px+3.5rem)] md:pt-[calc(40px+4rem)]"
    : reserveBanner
      ? "pt-[calc(40px+3.5rem)] md:pt-[calc(40px+4rem)]"
      : "pt-14 md:pt-16";

  return (
    <>
      {showViewAsBanner && (
        <Suspense fallback={null}>
          <ViewAsBannerSection locale={locale} userId={reqUser!.id} />
        </Suspense>
      )}
      {showUnpaidBanner && (
        <Suspense fallback={null}>
          <UnpaidBannerSection locale={locale} userId={reqUser!.id} />
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
            className="flex items-center min-w-0 shrink-0 min-h-[44px]"
          >
            <BrandLogo locale={locale} size="header" />
          </Link>

          {/* "How it works" CTA. Shown to signed-in users only —
              guests on the landing page do not need this shortcut
              since the landing hero already explains the product.
              Text on md+ for a clear call-to-action, icon-only on
              mobile so it does not crowd the bank pill on narrow
              screens. */}
          {signedIn && !hiddenPages.has("rules") && (
            <Link
              href={localePath(locale, "rules")}
              aria-label={dict.nav.rulesCtaLong}
              title={dict.nav.rulesCtaLong}
              className="press-down inline-flex items-center justify-center gap-1.5 min-w-[44px] min-h-[44px] px-2 md:px-3 rounded-full bg-tertiary-fixed text-on-tertiary-fixed-variant border border-tertiary-fixed-dim hover:bg-tertiary-container transition-[background-color,color] duration-150 shrink-0"
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
            // Was `hidden md:flex` - but at 768px (tablet) the 7
            // Hebrew nav items + brand + rules CTA + bank pill +
            // user menu push the header left of the viewport
            // (-83px in RTL). Bumped to lg so tablets get the
            // mobile bottom nav instead, and the desktop nav only
            // surfaces from 1024px where there is room.
            className="hidden lg:flex items-center justify-center gap-3 lg:gap-6 h-full"
          >
            <NavLink locale={locale} path="" label={dict.nav.home} exact />
            {!hiddenPages.has("bets") && (
              <NavLink locale={locale} path="bets" label={dict.nav.matchPicks} />
            )}
            {!hiddenPages.has("duels") && (
              <NavLink locale={locale} path="duels" label={dict.nav.duels} />
            )}
            {!hiddenPages.has("leaderboard") && (
              <NavLink locale={locale} path="leaderboard" label={dict.nav.leaders} />
            )}
            {!hiddenPages.has("tournament") && (
              <NavLink locale={locale} path="tournament" label={dict.nav.tournament} />
            )}
            {!hiddenPages.has("live") && (
              <NavLink locale={locale} path="live" label={dict.nav.liveScores} />
            )}
            {!hiddenPages.has("transparency") && (
              <NavLink locale={locale} path="transparency" label={dict.nav.transparency} />
            )}
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

      <main className={`flex-grow ${mainTopPaddingClass} ${signedIn ? "pb-24 lg:pb-8" : "pb-8"}`}>
        {children}
      </main>

      {signedIn && (
        // Admin-controlled bottom nav. The order, the items in the bar
        // vs the More sheet, and the bar's cell count all come from
        // `settings.mobile_nav_config` (see _plans/2026-05-27-admin-
        // mobile-nav-config.md). The whole bar streams behind Suspense
        // because it depends on access + the config row; the skeleton
        // reserves the bar's footprint so content above does not jump.
        <Suspense fallback={<MobileBottomNavSkeleton />}>
          <MobileBottomNavSection
            locale={locale}
            dict={dict}
            userId={reqUser.id}
          />
        </Suspense>
      )}
    </>
  );
}
