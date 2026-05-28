import type { Locale } from "@/app/[lang]/dictionaries";
import { getUserAccess } from "@/lib/access";
import { UnpaidBanner } from "./UnpaidBanner";

// Streams the persistent "view-only / pay to unlock" banner above the
// header for signed-in players whose payment isn't approved. Wrapped in
// Suspense at the AppShell so the shell paints first and the banner
// pops in once the access lookup resolves - skipping it entirely when
// the user can edit (paid or admin) or when an admin is in view-as
// mode (the view-as banner already tells the story).
export async function UnpaidBannerSection({
  locale,
  userId,
}: {
  locale: Locale;
  userId: string;
}) {
  const access = await getUserAccess(userId);
  if (access.canEdit) return null;
  if (access.viewingAs) return null;
  return (
    <div className="fixed top-0 left-0 right-0 z-[60]">
      <UnpaidBanner locale={locale} />
    </div>
  );
}
