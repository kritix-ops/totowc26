import { notFound, redirect } from "next/navigation";
import { hasLocale, type Locale } from "../../dictionaries";
import { localePath } from "@/lib/paths";

// Group rankings moved to /bets/groups under the unified bets surface.
// Redirect keeps existing links + deep links working.
export default async function PlayGroupsRedirect({
  params,
}: PageProps<"/[lang]/play/groups">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  redirect(localePath(locale, "bets/groups"));
}
