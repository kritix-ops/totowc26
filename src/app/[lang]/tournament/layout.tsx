import { notFound } from "next/navigation";
import { hasLocale } from "../dictionaries";
import { gatePage } from "@/lib/page-visibility";

// Visibility gate for the entire /[lang]/tournament segment. Covers
// every tab (summary/news/players/teams/tables). See
// _plans/2026-05-27-page-visibility.md.
export default async function TournamentLayout({
  params,
  children,
}: LayoutProps<"/[lang]/tournament">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  await gatePage("tournament", lang);
  return children;
}
