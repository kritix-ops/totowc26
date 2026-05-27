import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight, Smartphone } from "lucide-react";
import { hasLocale, type Locale, getDictionary } from "../../../dictionaries";
import { requireAdmin } from "@/lib/admin";
import { Card } from "@/components/ui";
import { localePath } from "@/lib/paths";
import { getMobileNavConfig } from "@/lib/mobile-nav-server";
import {
  MOBILE_NAV_CATALOG,
  MOBILE_NAV_ITEM_KEYS,
  type MobileNavItemKey,
} from "@/lib/mobile-nav";
import { MobileNavForm } from "./MobileNavForm";

export default async function AdminMobileNavSettingsPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  await requireAdmin(locale);
  const dict = await getDictionary(locale);
  const isHebrew = locale === "he";
  const ChevronBack = isHebrew ? ChevronRight : ChevronLeft;

  const config = await getMobileNavConfig();

  // Pre-compute the label dictionary for every key so the client form
  // does not need access to the locale dictionary loader. Includes the
  // role badge text in the current locale.
  const labels: Record<MobileNavItemKey, string> = MOBILE_NAV_ITEM_KEYS.reduce(
    (acc, key) => {
      acc[key] = dict.nav[MOBILE_NAV_CATALOG[key].dictKey];
      return acc;
    },
    {} as Record<MobileNavItemKey, string>,
  );

  return (
    <section className="px-4 md:px-10 py-6 md:py-10 flex flex-col gap-6 max-w-3xl mx-auto w-full">
      <header className="flex flex-col gap-2">
        <Link
          href={localePath(locale, "admin")}
          className="inline-flex items-center gap-1 text-sm text-on-surface-variant hover:text-primary self-start"
        >
          <ChevronBack className="h-4 w-4" />
          {isHebrew ? "חזרה לניהול" : "Back to admin"}
        </Link>
        <h1 className="font-[family-name:var(--font-display)] text-[24px] leading-8 md:text-[36px] md:leading-[40px] font-bold text-primary inline-flex items-center gap-3">
          <Smartphone className="h-6 w-6 md:h-8 md:w-8" strokeWidth={1.75} />
          {isHebrew ? "תפריט מובייל" : "Mobile navigation"}
        </h1>
        <p className="text-base text-on-surface-variant">
          {isHebrew
            ? "סדר את הפריטים בתפריט התחתון במובייל. גרור כדי לשנות סדר, הסר פריטים שאינך רוצה, וקבע כמה תאים יופיעו בסרגל. פריטים מעל קו החיתוך יוצגו בסרגל; השאר ייפתחו תחת 'עוד'."
            : "Arrange the items in the mobile bottom nav. Drag to reorder, remove items you don't want, and set how many cells appear on the bar. Items above the cutoff line show on the bar; the rest open under 'More'."}
        </p>
      </header>

      <Card className="p-4 md:p-5 bg-tertiary-fixed text-on-tertiary-fixed-variant border border-tertiary-fixed-dim">
        <p className="text-sm leading-relaxed">
          {isHebrew
            ? "התצורה גלובלית — כל המשתמשים במובייל יראו את אותו תפריט. פריטים כמו 'תשלום' מוצגים רק לשחקנים, ו'ניהול' רק למשתמשי אדמין — הסינון מתבצע אוטומטית מעל ההגדרה הזו."
            : "Config is global — every mobile user sees the same nav. Items like 'Pay' show only to players, 'Admin' only to admins — that filtering happens automatically on top of this setting."}
        </p>
      </Card>

      <MobileNavForm
        locale={locale}
        initial={config}
        labels={labels}
        allKeys={[...MOBILE_NAV_ITEM_KEYS]}
        catalog={Object.fromEntries(
          MOBILE_NAV_ITEM_KEYS.map((k) => [
            k,
            { roleGate: MOBILE_NAV_CATALOG[k].roleGate ?? null },
          ]),
        ) as Record<MobileNavItemKey, { roleGate: "player" | "admin" | null }>}
      />
    </section>
  );
}
