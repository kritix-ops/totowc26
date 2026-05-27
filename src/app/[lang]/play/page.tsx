import { notFound, redirect } from "next/navigation";
import { hasLocale, type Locale } from "../dictionaries";
import { localePath } from "@/lib/paths";

// /play moved into the unified Bets surface as the "Live bets" tab.
// The real page now lives at /bets/live; this redirect keeps existing
// bookmarks, deep links, and PWA shortcuts working.
export default async function PlayRedirect({
  params,
}: PageProps<"/[lang]/play">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  redirect(localePath(locale, "bets/live"));
}
