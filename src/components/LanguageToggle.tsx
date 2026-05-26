"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { Globe2 } from "lucide-react";

const LOCALES = ["he", "en"] as const;
type LocaleLiteral = (typeof LOCALES)[number];

export function LanguageToggle({
  currentLocale,
  label,
}: {
  currentLocale: LocaleLiteral;
  label: string;
}) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const [, startTransition] = useTransition();

  const switchTo = () => {
    const next: LocaleLiteral = currentLocale === "he" ? "en" : "he";
    const segments = pathname.split("/").filter(Boolean);
    if (LOCALES.includes(segments[0] as LocaleLiteral)) {
      segments[0] = next;
    } else {
      segments.unshift(next);
    }
    const target = "/" + segments.join("/");
    console.info("[language toggle switch]", { from: currentLocale, to: next, target });
    startTransition(() => {
      router.push(target);
    });
  };

  // Mobile: globe icon only (with proper 44×44 touch target). Desktop: icon + text.
  // The icon alone is a universally understood "switch language" affordance, and
  // shrinking the toggle here is what keeps the rest of the header from overflowing
  // off-screen on small viewports.
  return (
    <button
      type="button"
      onClick={switchTo}
      aria-label={label}
      title={label}
      className="inline-flex items-center justify-center gap-1.5 min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-[40px] px-2 md:px-3 rounded-full font-[family-name:var(--font-label)] text-[12px] font-bold tracking-[0.05em] text-primary cursor-pointer hover:bg-surface-container-high transition-colors"
    >
      <Globe2 className="h-4 w-4" strokeWidth={2} aria-hidden />
      <span className="hidden md:inline">{label}</span>
    </button>
  );
}
