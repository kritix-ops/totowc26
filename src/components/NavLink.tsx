"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { localePath } from "@/lib/paths";
import type { Locale } from "@/app/[lang]/dictionaries";
import { clsx } from "clsx";

function useIsActive(locale: Locale, path: string, exact?: boolean) {
  const pathname = usePathname() ?? "";
  const target = localePath(locale, path);
  if (exact) return pathname === target;
  return pathname === target || pathname.startsWith(target + "/");
}

// Subtle pending indicator that appears the moment a Link is tapped and
// stays visible until the new route's content streams in. The CSS uses
// an animation-delay so it only shows up when navigation actually takes
// longer than 100ms — on a hot prefetched route the indicator never
// flashes, which is the whole point.
function NavLinkPending() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      aria-hidden
      className="absolute -bottom-0.5 left-0 right-0 h-0.5 bg-primary rounded-full animate-pulse opacity-0 [animation-delay:100ms] [animation-fill-mode:forwards]"
      style={{
        animation: "navLinkPending 800ms ease-out 100ms forwards",
      }}
    />
  );
}

function BottomNavLinkPending() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      aria-hidden
      className="absolute top-0 left-1/2 -translate-x-1/2 h-0.5 w-8 bg-primary rounded-full opacity-0"
      style={{
        animation: "navLinkPending 800ms ease-out 100ms forwards",
      }}
    />
  );
}

export function NavLink({
  locale,
  path,
  label,
  exact,
}: {
  locale: Locale;
  path: string;
  label: string;
  exact?: boolean;
}) {
  const active = useIsActive(locale, path, exact);
  return (
    <Link
      href={localePath(locale, path)}
      className={clsx(
        "relative h-full flex items-center px-2 transition-[background-color,color] duration-150 hover:bg-surface-container-high",
        active
          ? "text-primary font-bold border-b-2 border-primary"
          : "text-on-surface-variant",
      )}
    >
      {label}
      <NavLinkPending />
    </Link>
  );
}

export function BottomNavLink({
  locale,
  path,
  label,
  icon,
  exact,
}: {
  locale: Locale;
  path: string;
  label: string;
  icon: React.ReactNode;
  exact?: boolean;
}) {
  const active = useIsActive(locale, path, exact);
  return (
    <Link
      href={localePath(locale, path)}
      // Force a full prefetch on the mobile bottom nav. The default
      // (partial prefetch for dynamic routes, just the loading skel)
      // is fine for sparse links, but the four bottom-nav cells are
      // the hottest taps in the app — pre-rendering them in full
      // makes the typical "home → bets → leaderboard → home" loop
      // feel like an SPA. With Phase 4 query caching the server cost
      // of prefetch is small (data hits unstable_cache).
      prefetch
      className={clsx(
        "relative flex flex-col items-center justify-center gap-1 px-1 py-2 min-h-[56px] transition-[color] duration-150",
        active ? "text-primary" : "text-on-surface-variant",
      )}
    >
      <BottomNavLinkPending />
      <span aria-hidden>{icon}</span>
      <span className="font-[family-name:var(--font-label)] text-[10px] leading-none font-bold tracking-[0.03em] truncate max-w-full">
        {label}
      </span>
    </Link>
  );
}
