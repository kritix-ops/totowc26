"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { X, ArrowUpRight } from "lucide-react";
import { clsx } from "clsx";
import { useRouter } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import type { MomentUrgency } from "@/lib/moments/types";

// One row in the Smart Hub. Two interactive surfaces side by side:
//   - The left "main" area is a Link to the CTA target.
//   - The right "dismiss" button POSTs to /api/moments/dismiss and
//     fades the row out optimistically.
//
// Why two siblings instead of nested clickables: HTML forbids
// nesting <button> inside <a>, and clicking the dismiss button
// inside the link would otherwise navigate before our handler
// runs. Splitting the surfaces gives clean affordances on mobile.
//
// See _plans/2026-05-30-smart-reminders.md §3.1.

type Props = {
  momentKey: string;
  type: string;
  urgency: MomentUrgency;
  icon: LucideIcon;
  title: string;
  body: string;
  ctaLabel: string;
  ctaHref: string;
  dismissLabel: string;
  index: number;
  isHebrew: boolean;
};

export function SmartHubRow({
  momentKey,
  type,
  urgency,
  icon: Icon,
  title,
  body,
  ctaLabel,
  ctaHref,
  dismissLabel,
  index,
  isHebrew,
}: Props) {
  const [hidden, setHidden] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (hidden) return null;

  function handleDismiss() {
    // Optimistic hide so the user gets immediate feedback. We refresh
    // the route on success to keep server state aligned; on failure we
    // restore the row so the user can retry.
    setHidden(true);
    startTransition(async () => {
      try {
        const res = await fetch("/api/moments/dismiss", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ momentKey }),
        });
        if (!res.ok) {
          console.warn("[smart-hub dismiss failed]", {
            momentKey,
            status: res.status,
          });
          setHidden(false);
          return;
        }
        router.refresh();
      } catch (err) {
        console.warn("[smart-hub dismiss network error]", { momentKey, err });
        setHidden(false);
      }
    });
  }

  // Accent stripe — RTL-aware via border-s-4 (Tailwind logical prop).
  // Color encodes urgency at a glance for users who scan rather than
  // read.
  const stripe = stripeClass(urgency);
  const iconTone = iconToneClass(urgency);
  const ctaTone = ctaToneClass(urgency);

  // The parent Suspense boundary already gives the section a natural
  // "fill in" entrance, so we keep the row itself static. `index` is
  // kept on the API surface for future animation work and to give the
  // dismiss handler a stable stacking order even after a row is
  // hidden.
  void index;

  return (
    <div
      data-moment-type={type}
      className={clsx(
        "group relative flex items-stretch overflow-hidden rounded-lg",
        "bg-surface-container-lowest border border-outline-variant",
        "shadow-[0_2px_8px_rgba(28,20,15,0.04)]",
        "hover:bg-surface-container transition-colors",
        stripe,
        pending && "opacity-60",
      )}
    >
      <Link
        href={ctaHref}
        className="press-down flex-1 min-w-0 flex items-start gap-3 p-3 md:p-4 min-h-[80px]"
        aria-label={`${title}: ${ctaLabel}`}
      >
        <span
          className={clsx(
            "shrink-0 w-10 h-10 rounded-full flex items-center justify-center mt-0.5",
            iconTone,
          )}
          aria-hidden
        >
          <Icon className="h-5 w-5" strokeWidth={1.75} />
        </span>
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <h4 className="font-bold text-[14px] md:text-[15px] leading-snug text-on-surface line-clamp-2">
            {title}
          </h4>
          <p className="text-[12px] md:text-[13px] text-on-surface-variant leading-snug line-clamp-2">
            {body}
          </p>
          <span
            className={clsx(
              "mt-1 inline-flex items-center gap-1 self-start font-[family-name:var(--font-label)] text-[11px] font-bold tracking-[0.05em]",
              ctaTone,
            )}
          >
            {ctaLabel}
            <ArrowUpRight
              className="h-3 w-3 transition-transform group-hover:translate-x-0.5"
              strokeWidth={2.5}
            />
          </span>
        </div>
      </Link>
      <button
        type="button"
        onClick={handleDismiss}
        disabled={pending}
        aria-label={dismissLabel}
        className={clsx(
          "shrink-0 w-11 self-stretch flex items-center justify-center",
          "text-on-surface-variant hover:bg-surface-variant hover:text-on-surface",
          "transition-colors border-s border-outline-variant",
          pending && "cursor-not-allowed",
        )}
      >
        <X className="h-4 w-4" strokeWidth={2} />
      </button>
      <span className="sr-only">{isHebrew ? "פעולה מומלצת" : "Recommended action"}</span>
    </div>
  );
}

function stripeClass(urgency: MomentUrgency): string {
  switch (urgency) {
    case "critical":
      return "border-s-4 border-s-error";
    case "time":
      return "border-s-4 border-s-tertiary";
    case "opportunity":
      return "border-s-4 border-s-primary";
    case "info":
    default:
      return "border-s-4 border-s-outline-variant";
  }
}

function iconToneClass(urgency: MomentUrgency): string {
  switch (urgency) {
    case "critical":
      return "bg-error-container text-on-error-container";
    case "time":
      return "bg-tertiary-fixed text-on-tertiary-fixed-variant";
    case "opportunity":
      return "bg-primary-fixed text-on-primary-fixed-variant";
    case "info":
    default:
      return "bg-surface-variant text-on-surface";
  }
}

function ctaToneClass(urgency: MomentUrgency): string {
  switch (urgency) {
    case "critical":
      return "text-error";
    case "time":
      return "text-tertiary";
    case "opportunity":
    case "info":
    default:
      return "text-primary";
  }
}
