import { notFound } from "next/navigation";
import { hasLocale, type Locale } from "../dictionaries";
import { requireAdmin } from "@/lib/admin";

export default async function AdminLayout({
  params,
  children,
}: LayoutProps<"/[lang]/admin">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  await requireAdmin(lang as Locale);
  return children;
}
