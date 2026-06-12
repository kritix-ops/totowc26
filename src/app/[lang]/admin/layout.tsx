import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { hasLocale, type Locale } from "../dictionaries";
import {
  isLiveBetsAdminPath,
  requireLiveBetsAdmin,
} from "@/lib/admin";
import { localePath } from "@/lib/paths";

// Admin pages always read request-bound state (auth, settings, per-user
// data) and must render at request time, not build time. Forcing dynamic
// on the layout cascades to every child so a new admin route added later
// can't accidentally regress into a build-time prerender.
export const dynamic = "force-dynamic";

export default async function AdminLayout({
  params,
  children,
}: LayoutProps<"/[lang]/admin">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;

  // Layout-level gate accepts both 'admin' and 'live_bets_admin'. The
  // path whitelist below then bounces a live-bets admin out of any admin
  // page that isn't in LIVE_BETS_ADMIN_PATHS. Server actions and the
  // handful of pages that re-check `isAdmin()` directly are the
  // defense-in-depth layer — they still enforce strict admin for
  // anything outside the live-bets surface.
  const { user, profile } = await requireLiveBetsAdmin(locale);

  if (profile.role === "live_bets_admin") {
    const pathname = (await headers()).get("x-pathname") ?? "";
    const adminPrefix = `/${locale}/admin`;
    const rest = pathname.startsWith(adminPrefix)
      ? pathname.slice(adminPrefix.length).replace(/^\//, "")
      : "";
    if (!isLiveBetsAdminPath(rest)) {
      console.info("[admin gate] live-bets admin bounced from path", {
        userId: user.id,
        pathname,
      });
      redirect(localePath(locale, "admin/bets"));
    }
  }

  return children;
}
