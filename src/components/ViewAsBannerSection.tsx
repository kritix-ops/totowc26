import type { Locale } from "@/app/[lang]/dictionaries";
import { getUserAccess } from "@/lib/access";
import { ViewAsBanner } from "./ViewAsBanner";

// Streams the "viewing as <role>" banner above the header when an admin
// is impersonating a player. Wrapped in Suspense at the AppShell so the
// shell paints first and the banner pops in only if access.viewingAs is
// set — otherwise this resolves to null with no layout shift since the
// banner is absolutely positioned via fixed.
export async function ViewAsBannerSection({
  locale,
  userId,
}: {
  locale: Locale;
  userId: string;
}) {
  const access = await getUserAccess(userId);
  const viewingAs = access?.viewingAs ?? null;
  console.info("[view-as banner section]", { viewingAs });
  if (!viewingAs) return null;
  return (
    <div className="fixed top-0 left-0 right-0 z-[60]">
      <ViewAsBanner locale={locale} role={viewingAs} />
    </div>
  );
}
