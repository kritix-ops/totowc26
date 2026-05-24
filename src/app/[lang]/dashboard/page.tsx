import { notFound, redirect } from "next/navigation";
import { hasLocale, type Locale } from "../dictionaries";
import { localePath } from "@/lib/paths";

// The dashboard is now rendered inline at /[lang]/ for signed-in users, so
// this route is a permanent alias. Kept for any deep links / older clients
// that still point at /dashboard.
export default async function DashboardAlias({
  params,
}: PageProps<"/[lang]/dashboard">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  redirect(localePath(lang as Locale));
}
