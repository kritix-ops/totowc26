import Link from "next/link";
import { headers } from "next/headers";
import { ChevronLeft, ChevronRight, Home } from "lucide-react";
import { Card } from "@/components/ui";

// Catch-all not-found for any path under /[lang] that no nested
// not-found.tsx already handles. Without this the framework falls back
// to an unstyled "404 / This page could not be found" page, which the
// 2026-06-05 QA run flagged as a low-severity branding hole. Locale is
// derived from the proxy-set x-pathname header (proxy.ts) so the page
// renders Hebrew on /he and English on /en even though notFound() pages
// receive no params.

export default async function LangNotFound() {
  const hdrs = await headers();
  const pathname = hdrs.get("x-pathname") ?? "";
  const isHebrew = !pathname.startsWith("/en");
  const Chev = isHebrew ? ChevronRight : ChevronLeft;
  const homeHref = isHebrew ? "/he" : "/en";

  return (
    <section className="px-4 md:px-16 py-12 md:py-20 flex flex-col gap-6 max-w-3xl mx-auto w-full pb-24 md:pb-12">
      <Card className="p-6 md:p-10 flex flex-col gap-5 items-center text-center">
        <div className="font-[family-name:var(--font-display)] text-6xl md:text-7xl font-bold text-primary leading-none">
          404
        </div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl md:text-3xl font-bold text-on-surface">
          {isHebrew ? "הדף לא נמצא" : "Page not found"}
        </h1>
        <p className="text-base text-on-surface-variant max-w-md">
          {isHebrew
            ? "הקישור שגוי או שהדף הוסר. אפשר לחזור לדף הבית ולהמשיך משם."
            : "The link is invalid or the page has moved. Head back to the home page to continue."}
        </p>
        <Link
          href={homeHref}
          className="press-down inline-flex items-center gap-2 min-h-[44px] px-5 py-2 rounded-full bg-primary text-on-primary text-sm font-bold"
        >
          <Home className="h-4 w-4" strokeWidth={2} />
          {isHebrew ? "חזרה לדף הבית" : "Back to home"}
          <Chev className="h-4 w-4" strokeWidth={2} />
        </Link>
      </Card>
    </section>
  );
}
