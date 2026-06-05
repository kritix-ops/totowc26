import Link from "next/link";
import { headers } from "next/headers";
import type { Metadata } from "next";
import "./globals.css";

// Catch-all 404 for routes that don't match anything at all. The
// [lang]/not-found.tsx only fires for notFound() calls inside matched
// segments; truly unmatched URLs (e.g. /he/foo-not-real or /random)
// would otherwise hit Next.js's bare default 404. global-not-found
// bypasses the normal layout chain, so we ship a full <html> shell
// here. Locale is derived from the proxy-set x-pathname header.

export const metadata: Metadata = {
  title: "הדף לא נמצא · טוטו מונדיאל 2026",
  description: "הדף שחיפשת לא קיים.",
};

export default async function GlobalNotFound() {
  const hdrs = await headers();
  const pathname = hdrs.get("x-pathname") ?? "";
  const isHebrew = !pathname.startsWith("/en");

  return (
    <html
      lang={isHebrew ? "he" : "en"}
      dir={isHebrew ? "rtl" : "ltr"}
    >
      <body className="bg-background text-on-background min-h-screen flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md bg-surface-container-low border border-outline rounded-lg p-6 md:p-10 flex flex-col gap-5 items-center text-center shadow-[0_8px_24px_rgba(28,20,15,0.12)]">
          <div className="text-6xl md:text-7xl font-bold text-primary leading-none">
            404
          </div>
          <h1 className="text-2xl md:text-3xl font-bold text-on-surface">
            {isHebrew ? "הדף לא נמצא" : "Page not found"}
          </h1>
          <p className="text-base text-on-surface-variant max-w-sm">
            {isHebrew
              ? "הקישור שגוי או שהדף הוסר. חזרה לדף הבית להמשיך משם."
              : "The link is invalid or the page has moved. Head home to continue."}
          </p>
          <Link
            href={isHebrew ? "/he" : "/en"}
            className="inline-flex items-center justify-center min-h-[44px] px-5 py-2 rounded-full bg-primary text-on-primary text-sm font-bold"
          >
            {isHebrew ? "חזרה לדף הבית" : "Back to home"}
          </Link>
        </div>
      </body>
    </html>
  );
}
