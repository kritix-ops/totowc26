"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Info } from "lucide-react";
import type { Locale } from "@/app/[lang]/dictionaries";
import { HIDEABLE_PAGE_LABELS } from "@/lib/page-visibility-catalog";

// Surfaces a one-shot toast on /[lang] when the page-visibility gate
// redirected a visitor here (URL carries `?hidden=<key>`). After the
// toast fires we strip the query param via history.replaceState so a
// refresh doesn't re-show it. See _plans/2026-05-27-page-visibility.md.

const TOAST_MS = 4500;

function cleanHiddenUrl() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has("hidden")) return;
  url.searchParams.delete("hidden");
  const qs = url.searchParams.toString();
  window.history.replaceState(
    window.history.state,
    "",
    url.pathname + (qs ? `?${qs}` : "") + url.hash,
  );
}

export function HiddenPageToast({ locale }: { locale: Locale }) {
  const isHebrew = locale === "he";
  const searchParams = useSearchParams();
  const hiddenParam = searchParams.get("hidden");
  // Track which key is currently showing. null = no toast. Setting in
  // an effect is the standard React pattern for time-bound visibility;
  // the rule warns about it but the alternative (sync derivation from
  // a changing URL) cannot drive an auto-dismiss.
  const [shownKey, setShownKey] = useState<string | null>(null);

  useEffect(() => {
    if (!hiddenParam) return;
    const known = (
      Object.keys(HIDEABLE_PAGE_LABELS) as Array<
        keyof typeof HIDEABLE_PAGE_LABELS
      >
    ).find((k) => k === hiddenParam);
    if (!known) {
      cleanHiddenUrl();
      return;
    }
    console.info("[page visibility toast]", { key: hiddenParam });
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShownKey(known);
    cleanHiddenUrl();
    const t = window.setTimeout(() => setShownKey(null), TOAST_MS);
    return () => window.clearTimeout(t);
  }, [hiddenParam]);

  if (!shownKey) return null;
  const meta = HIDEABLE_PAGE_LABELS[shownKey as keyof typeof HIDEABLE_PAGE_LABELS];
  const pageLabel = isHebrew ? meta.he : meta.en;
  const visible = true;
  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-24 md:bottom-8 z-50 flex justify-center px-4 pointer-events-none"
    >
      <div
        className="pointer-events-auto inline-flex items-center gap-2 max-w-[90vw] bg-surface-container-highest text-on-surface border border-outline-variant rounded-full px-4 py-2.5 shadow-lg"
        onClick={() => setShownKey(null)}
      >
        <Info className="h-4 w-4 text-primary shrink-0" strokeWidth={2} />
        <span className="text-sm font-bold">
          {isHebrew
            ? `העמוד "${pageLabel}" לא זמין כרגע.`
            : `The "${pageLabel}" page is currently unavailable.`}
        </span>
      </div>
    </div>
  );
}
