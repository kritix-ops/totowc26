"use client";

import { useState, useTransition } from "react";
import { ArrowUpRight, ChevronLeft, ChevronRight, X } from "lucide-react";
import { clsx } from "clsx";
import type { Locale } from "@/app/[lang]/dictionaries";
import { Card } from "./ui";
import { WhatsAppGlyph } from "./WhatsAppGlyph";
import { dismissWhatsAppCard } from "./whatsapp-card-actions";

// Shared WhatsApp invite card used by both the dashboard and the profile
// page. Two visual variants:
//   - "compact"   matches the SpecialsCard shape on the dashboard
//                 (small badge + title + one-line subtitle + arrow)
//   - "spotlight" is the larger profile-page card with a CTA pill
//
// Either variant carries a discreet close (X) button. Clicking X
// optimistically hides the card and fires a server action that
// persists the dismissal as a cookie keyed to the current invite URL,
// so when the admin rotates the group the dismissal resets and the
// new card shows up.
type Props = {
  locale: Locale;
  url: string;
  title: string;
  subtitle: string;
  ctaLabel: string;
  closeLabel: string;
  variant: "compact" | "spotlight";
  initialDismissed: boolean;
};

export function WhatsAppInviteCard({
  locale,
  url,
  title,
  subtitle,
  ctaLabel,
  closeLabel,
  variant,
  initialDismissed,
}: Props) {
  const [dismissed, setDismissed] = useState(initialDismissed);
  const [, startTransition] = useTransition();
  if (dismissed) return null;

  const handleDismiss = (e: React.MouseEvent | React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDismissed(true);
    startTransition(async () => {
      try {
        await dismissWhatsAppCard(url);
      } catch (err) {
        console.error("[whatsapp dismiss failed]", err);
      }
    });
  };

  const isHebrew = locale === "he";
  const Arrow = isHebrew ? ChevronLeft : ChevronRight;

  const closeButton = (
    <button
      type="button"
      onClick={handleDismiss}
      aria-label={closeLabel}
      title={closeLabel}
      className="press-down inline-flex items-center justify-center w-7 h-7 rounded-full text-on-surface-variant hover:text-on-surface hover:bg-surface-variant transition-colors shrink-0"
    >
      <X className="h-3.5 w-3.5" strokeWidth={2.5} />
    </button>
  );

  if (variant === "compact") {
    return (
      <div className="relative">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="press-down group block"
          aria-label={title}
        >
          <Card className="p-5 pe-12 flex items-center gap-4 min-h-[72px] hover:bg-surface-container transition-colors">
            <span
              className="w-11 h-11 rounded-full flex items-center justify-center shrink-0"
              style={{ backgroundColor: "#25D366" }}
              aria-hidden
            >
              <WhatsAppGlyph className="w-6 h-6 text-white" />
            </span>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="font-bold text-base text-on-surface">
                {title}
              </span>
              <span className="text-sm text-on-surface-variant truncate">
                {subtitle}
              </span>
            </div>
            <ArrowUpRight
              className="h-5 w-5 text-primary shrink-0 group-hover:translate-x-0.5 transition-transform"
              strokeWidth={2}
            />
          </Card>
        </a>
        <span
          className={clsx(
            "absolute top-2 z-10",
            isHebrew ? "left-2" : "right-2",
          )}
        >
          {closeButton}
        </span>
      </div>
    );
  }

  return (
    <div className="relative">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="block press-down"
        aria-label={title}
      >
        <Card className="p-4 pe-12 md:p-5 md:pe-14 flex items-center gap-4 hover:bg-surface-container transition-colors min-h-[72px]">
          <span
            className="w-11 h-11 md:w-12 md:h-12 rounded-full flex items-center justify-center shrink-0"
            style={{ backgroundColor: "#25D366" }}
            aria-hidden
          >
            <WhatsAppGlyph className="w-6 h-6 md:w-7 md:h-7 text-white" />
          </span>
          <div className="flex flex-col gap-0.5 min-w-0 flex-1">
            <span className="font-[family-name:var(--font-display)] text-base md:text-lg font-bold text-on-surface leading-tight">
              {title}
            </span>
            <span className="text-xs md:text-sm text-on-surface-variant leading-snug line-clamp-2">
              {subtitle}
            </span>
          </div>
          <span className="inline-flex items-center gap-1 text-xs font-[family-name:var(--font-label)] font-bold tracking-[0.05em] text-primary shrink-0">
            {ctaLabel}
            <Arrow className="h-4 w-4" strokeWidth={2.5} />
          </span>
        </Card>
      </a>
      <span
        className={clsx(
          "absolute top-2 z-10",
          isHebrew ? "left-2" : "right-2",
        )}
      >
        {closeButton}
      </span>
    </div>
  );
}
