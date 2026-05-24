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

export const metadata: Metadata = {
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
  },
  formatDetection: { telephone: false },
  openGraph: {
    title: "טוטו מונדיאל 2026",
    description: "טוטו חברים על משחקי המונדיאל 2026",
    images: [{ url: "/icons/og-image.png", width: 1200, height: 630 }],
    type: "website",
  },
};

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
        <AppShell locale={locale} dict={dict}>
          {children}
        </AppShell>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
