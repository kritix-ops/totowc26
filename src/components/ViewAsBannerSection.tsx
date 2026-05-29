import type { Locale } from "@/app/[lang]/dictionaries";
import { getUserAccess } from "@/lib/access";
import { isSandbox } from "@/lib/env";
import { ViewAsBanner } from "./ViewAsBanner";

// Streams the "viewing as <role>" banner above the header when an admin
// is impersonating a player. Wrapped in Suspense at the AppShell so the
// shell paints first and the banner pops in only if access.viewingAs is
// set — otherwise this resolves to null with no layout shift since the
// banner is absolutely positioned via fixed.
// In sandbox mode the SandboxBanner already occupies top-0, so this
// banner drops 40px to sit just below it.
export async function ViewAsBannerSection({
  locale,
  userId,
}: {
  locale: Locale;
  userId: string;
}) {
  const access = await getUserAccess(userId);
  const viewingAs = access?.viewingAs ?? null;
  if (!viewingAs) return null;
  const topClass = isSandbox() ? "top-[40px]" : "top-0";
  return (
    <div className={`fixed ${topClass} left-0 right-0 z-[60]`}>
      <ViewAsBanner locale={locale} role={viewingAs} />
    </div>
  );
}
