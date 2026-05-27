import { notFound, redirect } from "next/navigation";
import { hasLocale, type Locale } from "../../dictionaries";
import { localePath } from "@/lib/paths";

// /play/[date] moved into /bets/live/[date] under the unified Bets
// tab strip. Redirect keeps existing bookmarks and deep links
// working through the cutover.
export default async function PlayDateRedirect({
  params,
}: PageProps<"/[lang]/play/[date]">) {
  const { lang, date } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  redirect(localePath(locale, `bets/live/${date}`));
}
