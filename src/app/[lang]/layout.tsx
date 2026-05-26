import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import {
  Heebo,
  Space_Grotesk,
  Assistant,
  Inter,
} from "next/font/google";
import {
  getDictionary,
  hasLocale,
  dirFor,
  LOCALES,
  type Locale,
} from "./dictionaries";
import { AppShell } from "@/components/AppShell";
import { ServiceWorkerRegistrar } from "@/components/ServiceWorkerRegistrar";
import { SplashOverlay } from "@/components/SplashOverlay";
import {
  APPLE_SPLASH_SCREENS,
  SPLASH_LOCALES_AVAILABLE,
} from "@/lib/apple-splash-screens";
import "../globals.css";

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

const labelFont = Inter({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-label",
  display: "swap",
});

export async function generateStaticParams() {
  return LOCALES.map((lang) => ({ lang }));
}

export async function generateMetadata({
  params,
}: LayoutProps<"/[lang]">): Promise<Metadata> {
  const { lang } = await params;
  const locale: Locale = hasLocale(lang) ? (lang as Locale) : "he";
  // Per-locale apple-touch-startup-image entries. Falls back to Hebrew if
  // the English source poster hasn't been generated yet, since iOS' choice
  // of splash is tied to whichever document the user added to home-screen
  // from — an English installer with no English splash is better off with
  // Hebrew letterboxing than a blank white screen.
  const startupImage =
    APPLE_SPLASH_SCREENS[locale]?.length > 0
      ? APPLE_SPLASH_SCREENS[locale]
      : APPLE_SPLASH_SCREENS.he;
  return {
    title: {
      default: "טוטו מונדיאל 2026",
      template: "%s · טוטו מונדיאל 2026",
    },
    description: "טוטו חברים על משחקי המונדיאל 2026",
    applicationName: "טוטו מונדיאל 2026",
    manifest: "/manifest.webmanifest",
    appleWebApp: {
      capable: true,
      title: "טוטו מונדיאל",
      statusBarStyle: "default",
      startupImage,
    },
    formatDetection: { telephone: false },
    openGraph: {
      title: "טוטו מונדיאל 2026",
      description: "טוטו חברים על משחקי המונדיאל 2026",
      images: [{ url: "/icons/og-image.png", width: 1200, height: 630 }],
      type: "website",
    },
  };
}

export const viewport: Viewport = {
  themeColor: "#A13217",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
  params,
}: LayoutProps<"/[lang]">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const dict = await getDictionary(locale);

  return (
    <html
      lang={locale}
      dir={dirFor(locale)}
      className={`${display.variable} ${displayEn.variable} ${ui.variable} ${labelFont.variable}`}
    >
      <body className="bg-background text-on-background min-h-screen flex flex-col">
        <SplashOverlay
          locale={SPLASH_LOCALES_AVAILABLE.includes(locale) ? locale : "he"}
        />
        <AppShell locale={locale} dict={dict}>
          {children}
        </AppShell>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
