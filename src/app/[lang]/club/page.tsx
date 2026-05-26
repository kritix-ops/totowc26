import { notFound, redirect } from "next/navigation";
import { hasLocale, type Locale } from "../dictionaries";
import { localePath } from "@/lib/paths";

// /club merged into /tournament as the unified World Cup Zone. The
// page content (recent results, top scorers, group leaders preview,
// teams grid) now lives behind the Summary and Teams tabs.
export default async function ClubRedirect({
  params,
}: PageProps<"/[lang]/club">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  redirect(localePath(locale, "tournament"));
}
