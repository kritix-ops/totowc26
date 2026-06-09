// Page-level loading skeletons that show through Next.js' loading.tsx
// convention. They are static, JS-free, and ship as part of the
// prefetched static shell — so on a client navigation Next.js can
// paint them the moment the link is clicked while the server renders
// the real page underneath. Every route under [lang]/ gets one of
// these via its loading.tsx file.
//
// The dimensions are deliberately picked to MATCH the heading area,
// section spacing, and card densities used by the real pages, so that
// when the actual content streams in there is no perceived shift —
// the skeleton appears to "fill in" with detail.

function ShimmerBlock({ className }: { className: string }) {
  return (
    <div
      aria-hidden
      className={`animate-pulse bg-surface-container-high rounded ${className}`}
    />
  );
}

export function ListPageSkeleton({
  withHeader = true,
}: {
  withHeader?: boolean;
}) {
  return (
    <section className="px-4 md:px-16 py-6 md:py-12 flex flex-col gap-6 md:gap-8 max-w-3xl mx-auto w-full">
      {withHeader && (
        <header className="flex flex-col gap-3">
          <ShimmerBlock className="h-10 w-2/3 max-w-xs" />
          <ShimmerBlock className="h-4 w-full max-w-md" />
        </header>
      )}
      <div className="flex flex-col gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <ShimmerBlock key={i} className="h-20" />
        ))}
      </div>
    </section>
  );
}

export function WideListSkeleton() {
  return (
    <section className="px-4 md:px-16 py-6 md:py-12 flex flex-col gap-6 md:gap-8 max-w-6xl mx-auto w-full">
      <header className="flex flex-col gap-3">
        <ShimmerBlock className="h-10 w-2/3 max-w-sm" />
        <ShimmerBlock className="h-4 w-full max-w-md" />
      </header>
      <div className="flex flex-col gap-3">
        {Array.from({ length: 10 }).map((_, i) => (
          <ShimmerBlock key={i} className="h-14" />
        ))}
      </div>
    </section>
  );
}

export function FormPageSkeleton() {
  return (
    <section className="px-4 md:px-16 py-6 md:py-12 flex flex-col gap-6 max-w-md mx-auto w-full">
      <ShimmerBlock className="h-10 w-2/3" />
      <ShimmerBlock className="h-4 w-full" />
      <div className="flex flex-col gap-4 mt-4">
        <ShimmerBlock className="h-12" />
        <ShimmerBlock className="h-12" />
        <ShimmerBlock className="h-12 w-1/2" />
      </div>
    </section>
  );
}

export function GenericPageSkeleton() {
  return (
    <section className="px-4 md:px-16 py-6 md:py-12 flex flex-col gap-6 max-w-4xl mx-auto w-full">
      <ShimmerBlock className="h-10 w-2/3 max-w-sm" />
      <ShimmerBlock className="h-4 w-full max-w-md" />
      <div className="flex flex-col gap-4 mt-2">
        <ShimmerBlock className="h-32" />
        <ShimmerBlock className="h-32" />
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Home dashboard section skeletons — placed inside <Suspense> on the
// signed-in home page so each card streams independently. Dimensions
// match the real components 1:1 so when the data lands the layout
// does not shift; only the shimmering fill is replaced.
// ─────────────────────────────────────────────────────────────────────

export function HeroStatsCardSkeleton() {
  return (
    <div className="relative z-10 -mt-10 sm:-mt-14 md:-mt-20 px-4 md:px-8 lg:px-16 flex justify-center">
      <div className="w-full max-w-6xl bg-surface-container-low border border-outline rounded-lg shadow-[0_8px_24px_rgba(28,20,15,0.12)] p-5 md:p-7 flex flex-col gap-5 md:gap-6">
        <div className="flex justify-center">
          <ShimmerBlock className="h-12 w-32" />
        </div>
        <div aria-hidden className="h-px bg-outline/40" />
        <div className="grid grid-cols-3 gap-x-3 md:gap-x-6 items-center">
          <ShimmerBlock className="h-10" />
          <ShimmerBlock className="h-10" />
          <ShimmerBlock className="h-10" />
        </div>
      </div>
    </div>
  );
}

export function PrizeStripSkeleton() {
  // 7-tile category split: 4 rows on mobile (grid-cols-2), 2 rows on
  // desktop (grid-cols-4 with king-first spanning two cells).
  return <ShimmerBlock className="h-[280px] md:h-[180px]" />;
}

export function StatusRowSkeleton() {
  return (
    <section className="flex flex-col gap-4 md:gap-6">
      <ShimmerBlock className="h-8 w-40" />
      <div className="grid grid-cols-3 gap-3 md:gap-4">
        <ShimmerBlock className="h-24" />
        <ShimmerBlock className="h-24" />
        <ShimmerBlock className="h-24" />
      </div>
    </section>
  );
}

export function UpcomingSectionSkeleton() {
  return (
    <section className="flex flex-col gap-4 md:gap-6">
      <div className="flex justify-between items-end">
        <ShimmerBlock className="h-6 w-32" />
        <ShimmerBlock className="h-4 w-16" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <ShimmerBlock className="h-44" />
        <ShimmerBlock className="h-44" />
        <ShimmerBlock className="h-44" />
      </div>
    </section>
  );
}

export function LastBetSectionSkeleton() {
  return (
    <section className="flex flex-col gap-4 md:gap-6">
      <ShimmerBlock className="h-6 w-32" />
      <ShimmerBlock className="h-64" />
    </section>
  );
}

export function TrendSectionSkeleton() {
  return (
    <section className="flex flex-col gap-4 md:gap-6">
      <ShimmerBlock className="h-6 w-32" />
      <ShimmerBlock className="h-44" />
    </section>
  );
}

export function LeaderboardSectionSkeleton() {
  return (
    <section className="flex flex-col gap-4 md:gap-6">
      <div className="flex justify-between items-end">
        <ShimmerBlock className="h-6 w-32" />
        <ShimmerBlock className="h-4 w-20" />
      </div>
      <div className="flex flex-col gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <ShimmerBlock key={i} className="h-14" />
        ))}
      </div>
    </section>
  );
}

export function PoolDigestSectionSkeleton() {
  return (
    <section className="flex flex-col gap-4 md:gap-6">
      <div className="flex justify-between items-end">
        <ShimmerBlock className="h-6 w-48" />
        <ShimmerBlock className="h-4 w-24" />
      </div>
      <div className="flex flex-col gap-2 rounded-lg border border-outline-variant bg-surface-container-low p-4">
        <ShimmerBlock className="h-5 w-2/3" />
        {Array.from({ length: 3 }).map((_, i) => (
          <ShimmerBlock key={i} className="h-20" />
        ))}
        <ShimmerBlock className="h-10" />
      </div>
    </section>
  );
}

export function LatestNewsSectionSkeleton() {
  return (
    <section className="flex flex-col gap-4 md:gap-6">
      <div className="flex justify-between items-end">
        <ShimmerBlock className="h-6 w-32" />
        <ShimmerBlock className="h-4 w-16" />
      </div>
      <div className="flex flex-col gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <ShimmerBlock key={i} className="h-[88px]" />
        ))}
      </div>
    </section>
  );
}
