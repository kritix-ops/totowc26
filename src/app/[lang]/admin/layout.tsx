import { notFound } from "next/navigation";
import { hasLocale, type Locale } from "../dictionaries";
import { requireAdmin } from "@/lib/admin";

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
  await requireAdmin(lang as Locale);
  return children;
}
