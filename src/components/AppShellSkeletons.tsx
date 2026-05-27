// Static skeletons used by the AppShell while streamed sections resolve.
// Each one matches the dimensions of the real content it stands in for,
// so the swap-in does not shift surrounding layout. No JS, no client
// component, no data fetching — pure HTML the static shell can ship as
// part of the first byte.

export function HeaderUserSkeleton() {
  return (
    <div
      aria-hidden
      className="flex items-center gap-2 md:gap-4 shrink-0 animate-pulse"
    >
      <div className="h-9 w-[88px] md:w-[110px] rounded-full bg-surface-container-high" />
      <div className="hidden md:block h-4 w-12 rounded bg-surface-container-high" />
      <div className="h-10 w-10 rounded-full bg-surface-container-high" />
    </div>
  );
}

export function GuestActionsSkeleton() {
  return (
    <div
      aria-hidden
      className="flex items-center gap-2 md:gap-4 shrink-0 animate-pulse"
    >
      <div className="h-10 w-[72px] md:w-[88px] rounded-full bg-surface-container-high" />
      <div className="h-10 w-[72px] md:w-[88px] rounded-full bg-primary/30" />
      <div className="h-9 w-9 rounded-full bg-surface-container-high" />
    </div>
  );
}

export function DesktopNavExtrasSkeleton() {
  return (
    <div aria-hidden className="h-full flex items-center gap-6 animate-pulse">
      <div className="h-4 w-10 rounded bg-surface-container-high" />
    </div>
  );
}

export function MobileMoreSkeleton() {
  return (
    <div
      aria-hidden
      className="flex flex-col items-center justify-center gap-1 px-1 py-2 min-h-[56px] animate-pulse"
    >
      <div className="h-5 w-5 rounded bg-surface-container-high" />
      <div className="h-2 w-8 rounded bg-surface-container-high" />
    </div>
  );
}

// Placeholder for the entire mobile bottom nav while the per-user
// access + admin-defined config queries resolve. Matches the bar's
// height + 5-cell grid so the swap to the real bar does not shift
// the page. Default to 5 cells since that's the most common config;
// a 3- or 4-cell config will reflow on swap but the visible padding
// of the cells absorbs the difference.
export function MobileBottomNavSkeleton() {
  return (
    <div
      aria-hidden
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-surface-container rounded-t-xl border-t border-outline-variant shadow-[0_-4px_12px_rgba(28,20,15,0.05)] grid grid-cols-5 items-stretch min-h-[64px] pb-[env(safe-area-inset-bottom)] animate-pulse"
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="flex flex-col items-center justify-center gap-1 px-1 py-2 min-h-[56px]"
        >
          <div className="h-5 w-5 rounded bg-surface-container-high" />
          <div className="h-2 w-8 rounded bg-surface-container-high" />
        </div>
      ))}
    </div>
  );
}
