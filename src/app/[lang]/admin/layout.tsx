import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { hasLocale, type Locale } from "../dictionaries";
import { isPermittedPath, requireAdminAccess } from "@/lib/admin";
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

  // Layout-level gate: full admins pass; scoped operators pass IF
  // they hold at least one permission. Pathname is read from the
  // x-pathname header set by src/proxy.ts so we can enforce the
  // per-permission path whitelist below.
  const { user, access } = await requireAdminAccess(locale);

  if (access.role !== "admin") {
    const pathname = (await headers()).get("x-pathname") ?? "";
    const adminPrefix = `/${locale}/admin`;
    const rest = pathname.startsWith(adminPrefix)
      ? pathname.slice(adminPrefix.length).replace(/^\//, "")
      : "";
    if (!isPermittedPath(access.permissions, rest)) {
      console.info("[admin gate] scoped operator bounced from path", {
        userId: user.id,
        pathname,
        permissions: access.permissions,
      });
      redirect(localePath(locale, "admin"));
    }
  }

  return children;
}
