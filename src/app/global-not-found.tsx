import Link from "next/link";
import { headers } from "next/headers";
import { Suspense } from "react";
import type { Metadata } from "next";
import { Heebo, Space_Grotesk, Assistant } from "next/font/google";
import {
  getDictionary,
  dirFor,
  type Locale,
} from "./[lang]/dictionaries";
import { AppShell } from "@/components/AppShell";
import { SandboxBanner } from "@/components/SandboxBanner";
import { localePath } from "@/lib/paths";
import "./globals.css";

// Catch-all 404 for routes that don't match anything at all. The
// [lang]/not-found.tsx only fires for notFound() calls inside matched
// segments; truly unmatched URLs (e.g. /he/foo-not-real or /random)
// would otherwise hit Next.js's bare default 404. global-not-found
// bypasses the normal layout chain (per Next 16 docs in
// node_modules/next/dist/docs/.../not-found.md - "Next.js skips
// rendering and directly returns this global page"), so this file
// re-mounts every shell dependency the [lang]/layout normally
// provides: the three font families, globals.css, the SandboxBanner,
// and the AppShell. Without that the 404 lost the header/nav/bottom-
// nav chrome present on every route-level error page, which the QA
// agent flagged on 2026-06-06 as a cosmetic inconsistency.
//
// SplashOverlay / HiddenPageToast / ServiceWorkerRegistrar are
// deliberately omitted - they are bootstrap concerns (PWA splash,
// hidden-page toast routing, SW registration) that a one-shot 404
// landing does not benefit from, and the Next docs explicitly call
// out keeping global-not-found light.
//
// Locale is derived from the proxy-set x-pathname header since this
// file lives outside the [lang] segment and has no route params.

const display = Heebo({
  subsets: ["hebrew", "latin"],
  weight: ["700", "800", "900"],
  variable: "--font-display",
  display: "swap",
});

const displayEn = Space_Grotesk({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-display-en",
  display: "swap",
});

const ui = Assistant({
  subsets: ["hebrew", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-ui",
  display: "swap",
});

export const metadata: Metadata = {
  title: "הדף לא נמצא · טוטו מונדיאל 2026",
  description: "הדף שחיפשת לא קיים.",
};

export default async function GlobalNotFound() {
  const hdrs = await headers();
  const pathname = hdrs.get("x-pathname") ?? "";
  const locale: Locale = pathname.startsWith("/en") ? "en" : "he";
  const isHebrew = locale === "he";
  const dict = await getDictionary(locale);

  return (
    <html
      lang={locale}
      dir={dirFor(locale)}
      className={`${display.variable} ${displayEn.variable} ${ui.variable}`}
    >
      <body className="bg-background text-on-background min-h-screen flex flex-col">
        <SandboxBanner locale={locale} />
        <Suspense fallback={null}>
          <AppShell locale={locale} dict={dict}>
            <div className="flex flex-col items-center justify-center px-4 py-12 min-h-[60vh]">
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
                  href={localePath(locale)}
                  className="inline-flex items-center justify-center min-h-[44px] px-5 py-2 rounded-full bg-primary text-on-primary text-sm font-bold"
                >
                  {isHebrew ? "חזרה לדף הבית" : "Back to home"}
                </Link>
              </div>
            </div>
          </AppShell>
        </Suspense>
      </body>
    </html>
  );
}
