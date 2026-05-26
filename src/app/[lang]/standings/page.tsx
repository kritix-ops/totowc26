import { notFound, redirect } from "next/navigation";
import { hasLocale, type Locale } from "../dictionaries";
import { localePath } from "@/lib/paths";

// /standings merged into /tournament. The full live group tables now
// live behind the "tables" tab; we preserve deep links by routing
// straight to that tab.
export default async function StandingsRedirect({
  params,
}: PageProps<"/[lang]/standings">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  redirect(`${localePath(locale, "tournament")}?tab=tables`);
}
