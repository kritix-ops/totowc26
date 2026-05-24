"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";

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
    startTransition(() => {
      router.push(target);
    });
  };

  return (
    <button
      type="button"
      onClick={switchTo}
      aria-label="Toggle language"
      className="font-[family-name:var(--font-label)] text-[12px] font-bold tracking-[0.05em] text-primary cursor-pointer hover:bg-surface-container-high transition-colors px-2 py-1 rounded"
    >
      {label}
    </button>
  );
}
