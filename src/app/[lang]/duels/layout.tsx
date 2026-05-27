import { notFound } from "next/navigation";
import { hasLocale } from "../dictionaries";
import { gatePage } from "@/lib/page-visibility";

// Visibility gate for the entire /[lang]/duels segment. Covers the
// list page, /new, and /[id] children. See
// _plans/2026-05-27-page-visibility.md.
export default async function DuelsLayout({
  params,
  children,
}: LayoutProps<"/[lang]/duels">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  await gatePage("duels", lang);
  return children;
}
