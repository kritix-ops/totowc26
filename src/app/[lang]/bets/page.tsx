import { notFound, redirect } from "next/navigation";
import { hasLocale, type Locale } from "../dictionaries";
import { localePath } from "@/lib/paths";

// /bets merged into /play as the single betting hub. The single-match
// form at /bets/[matchId] still lives at its own URL since dozens of
// links point to it; only the listing page redirects.
export default async function BetsRedirect({
  params,
}: PageProps<"/[lang]/bets">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  redirect(localePath(locale, "play"));
}
