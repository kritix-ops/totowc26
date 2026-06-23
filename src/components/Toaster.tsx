"use client";

import { useSyncExternalStore } from "react";
import { AlertCircle, Check, Info, X } from "lucide-react";
import { clsx } from "clsx";
import { subscribe, getToasts, dismissToast, type Toast } from "@/lib/toast";

// Single render surface for the app-wide toast store (@/lib/toast). Mounted
// once in the root layout. Reads the store via useSyncExternalStore so it
// re-renders the instant any client component fires toast.success/error/info.
//
// Placement: centered just above the fixed bottom nav (lower 80px) on mobile,
// lower on desktop, padded for the iOS safe area. The container is
// pointer-events-none so taps fall through the gaps; each toast re-enables
// its own pointer events. Errors are styled loud and carry their own dismiss
// + optional retry; success/info auto-expire from the store.

// Stable empty array for the server snapshot so useSyncExternalStore doesn't
// loop during SSR/first paint (toasts only ever exist after a client event).
const SERVER_SNAPSHOT: Toast[] = [];

export function Toaster() {
  const toasts = useSyncExternalStore(
    subscribe,
    getToasts,
    () => SERVER_SNAPSHOT,
  );

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed inset-x-0 bottom-24 md:bottom-8 z-[60] flex flex-col items-center gap-2 px-4 pb-[env(safe-area-inset-bottom)] pointer-events-none"
    >
      {toasts.map((toast) => (
        <ToastRow key={toast.id} toast={toast} />
      ))}
    </div>
  );
}

function ToastRow({ toast }: { toast: Toast }) {
  const tone = {
    success:
      "bg-secondary-container text-on-secondary-container border-secondary-fixed",
    error: "bg-error-container text-on-error-container border-error",
    info: "bg-surface-container-highest text-on-surface border-outline-variant",
  }[toast.kind];

  const Icon =
    toast.kind === "success" ? Check : toast.kind === "error" ? AlertCircle : Info;

  return (
    <div
      role="status"
      // Errors interrupt; success/info are polite so a screen reader doesn't
      // talk over the user mid-task for a routine save confirmation.
      aria-live={toast.kind === "error" ? "assertive" : "polite"}
      className={clsx(
        "pointer-events-auto w-full max-w-md inline-flex items-center gap-2.5 rounded-2xl border px-4 py-3 shadow-lg",
        tone,
      )}
    >
      <Icon className="h-5 w-5 shrink-0" strokeWidth={2.25} />
      <span className="flex-1 min-w-0 text-sm font-bold leading-snug">
        {toast.message}
      </span>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            const { onClick } = toast.action!;
            dismissToast(toast.id);
            onClick();
          }}
          className="press-down shrink-0 min-h-11 px-3 inline-flex items-center justify-center rounded-full text-sm font-bold bg-error text-on-error hover:bg-error/90"
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={() => dismissToast(toast.id)}
        aria-label="Dismiss"
        className="press-down shrink-0 h-11 w-11 -me-1.5 inline-flex items-center justify-center rounded-full hover:bg-black/5"
      >
        <X className="h-4 w-4" strokeWidth={2.5} />
      </button>
    </div>
  );
}
