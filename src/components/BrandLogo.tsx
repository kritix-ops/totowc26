import Image from "next/image";
import type { Locale } from "@/app/[lang]/dictionaries";

// Hero banner logo. Locale picks the right variant. `size` is the rendered
// height; the width auto-scales from the source's intrinsic ratio.
export function BrandLogo({
  locale,
  size = "header",
  className,
}: {
  locale: Locale;
  size?: "header" | "hero" | "lg" | "xl";
  className?: string;
}) {
  const isHebrew = locale === "he";
  const src = isHebrew
    ? "/logo/toto_mundial_2026_hebrew.png"
    : "/logo/toto_mundial_2026_english.png";
  const alt = isHebrew ? "טוטו מונדיאל 2026" : "Toto Mundial 2026";

  // Source PNGs are roughly 440×126, so width = height × 3.5
  const intrinsic = { w: 1320, h: 378 };

  const heightClass = {
    header: "h-9 md:h-11",
    hero: "h-16 md:h-24",
    lg: "h-28 md:h-40",
    xl: "h-20 sm:h-24 md:h-32 lg:h-40",
  }[size];

  const sizesAttr = {
    header: "(max-width: 768px) 140px, 180px",
    hero: "(max-width: 768px) 220px, 360px",
    lg: "(max-width: 768px) 320px, 560px",
    xl: "(max-width: 640px) 280px, (max-width: 1024px) 440px, 620px",
  }[size];

  return (
    <Image
      src={src}
      alt={alt}
      width={intrinsic.w}
      height={intrinsic.h}
      priority={size !== "header"}
      sizes={sizesAttr}
      className={`${heightClass} w-auto select-none ${className ?? ""}`}
    />
  );
}
