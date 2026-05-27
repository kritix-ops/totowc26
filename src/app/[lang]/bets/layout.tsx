import { notFound } from "next/navigation";
import { hasLocale } from "../dictionaries";
import { gatePage } from "@/lib/page-visibility";

// Visibility gate for the entire /[lang]/bets segment. The layout
// catches every child route (/[matchId], /live, /tournament, /groups)
// so admin hiding "matches" closes the whole surface, not just the
// landing page. See _plans/2026-05-27-page-visibility.md.
export default async function BetsLayout({
  params,
  children,
}: LayoutProps<"/[lang]/bets">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  await gatePage("bets", lang);
  return children;
}
