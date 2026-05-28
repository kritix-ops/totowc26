"use client";

import { useEffect, useState, useTransition } from "react";
import { AlertCircle, Bell, BellOff, Check } from "lucide-react";
import { clsx } from "clsx";
import type { Locale } from "@/app/[lang]/dictionaries";
import {
  translateError as translateErrorCode,
  type LocalizedTuple,
} from "@/lib/error-i18n";
import { setPushOptIn } from "@/app/[lang]/profile/push-actions";

// Profile-page toggle for push notifications. Manages the browser-side
// permission request + PushManager subscription, then calls the
// `setPushOptIn` server action to persist the flag.
//
// Why both a server flag AND a browser subscription:
//   - The browser subscription is what the push service actually
//     delivers to. Removing it stops delivery.
//   - The flag is the user-facing "pause" the cron checks before
//     calling web-push. Lets the user toggle off without losing
//     browser permission (re-granting is friction).
//
// See _plans/2026-05-28-lock-reminders.md §5.

type Status =
  | "initial"          // hasn't run yet
  | "loading"          // checking permission / subscription
  | "unsupported"      // browser doesn't have PushManager
  | "vapid_missing"    // server hasn't generated VAPID keys
  | "denied"           // user said no to browser permission
  | "off"              // subscription absent OR opt-in flag false
  | "on";              // subscription present AND opt-in flag true

type Props = {
  locale: Locale;
  initialOptIn: boolean;
};

export function PushOptInToggle({ locale, initialOptIn }: Props) {
  const isHebrew = locale === "he";
  const [status, setStatus] = useState<Status>("initial");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (typeof window === "undefined") return;
        if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
          if (!cancelled) setStatus("unsupported");
          return;
        }
        if (Notification.permission === "denied") {
          if (!cancelled) setStatus("denied");
          return;
        }
        // Some setups (this app in dev) skip the global SW registration
        // for HMR sanity. `serviceWorker.ready` would hang forever in
        // that case. Race it against an 8s timeout; on timeout fall back
        // to "off" so the user sees an actionable toggle instead of an
        // ellipsis that never resolves.
        const reg = await waitForActiveSW(8000);
        if (!reg) {
          if (!cancelled) setStatus("off");
          return;
        }
        const sub = await reg.pushManager.getSubscription();
        if (!cancelled) {
          setStatus(sub && initialOptIn ? "on" : "off");
        }
      } catch (err) {
        console.warn("[push toggle init failed]", { err });
        if (!cancelled) setStatus("off");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialOptIn]);

  async function enable() {
    setError(null);
    setStatus("loading");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "off");
        return;
      }
      const res = await fetch("/api/push/public-key");
      const { publicKey } = (await res.json()) as { publicKey: string | null };
      if (!publicKey) {
        setStatus("vapid_missing");
        return;
      }
      // Ensure a SW exists for this scope - the global registrar skips
      // dev. Idempotent: register() returns the existing registration if
      // there is one. Then race ready against 8s so a stuck install
      // can't pin the toggle in "loading".
      try {
        await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      } catch (err) {
        console.warn("[push sw register failed]", { err });
      }
      const reg = await waitForActiveSW(8000);
      if (!reg) {
        setError("subscribe_failed");
        setStatus("off");
        return;
      }
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
      }
      const persist = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      if (!persist.ok) {
        setError("subscribe_failed");
        setStatus("off");
        return;
      }
      startTransition(async () => {
        const r = await setPushOptIn(true);
        if (!r.ok) {
          setError(r.error);
          setStatus("off");
        } else {
          setStatus("on");
        }
      });
    } catch (err) {
      console.warn("[push enable failed]", { err });
      setError("subscribe_failed");
      setStatus("off");
    }
  }

  async function disable() {
    setError(null);
    setStatus("loading");
    try {
      const reg = await waitForActiveSW(5000);
      if (!reg) {
        // Nothing to unsubscribe locally; still flip the server flag.
        startTransition(async () => {
          await setPushOptIn(false);
          setStatus("off");
        });
        return;
      }
      const sub = await reg.pushManager.getSubscription();
      const endpoint = sub?.endpoint;
      if (sub) {
        await sub.unsubscribe();
      }
      if (endpoint) {
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint }),
        });
      }
      startTransition(async () => {
        const r = await setPushOptIn(false);
        if (!r.ok) {
          setError(r.error);
        }
        setStatus("off");
      });
    } catch (err) {
      console.warn("[push disable failed]", { err });
      setError("unsubscribe_failed");
      setStatus("off");
    }
  }

  const isOn = status === "on";
  const blocked =
    status === "unsupported" ||
    status === "denied" ||
    status === "vapid_missing";
  const showSpinner = status === "loading" || pending;

  return (
    <div className="flex flex-col gap-2 px-5 py-4 border-b border-outline-variant min-h-[56px]">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 font-bold text-on-surface">
          {isOn ? (
            <Bell className="h-4 w-4 text-primary" strokeWidth={2} />
          ) : (
            <BellOff className="h-4 w-4 text-on-surface-variant" strokeWidth={2} />
          )}
          {isHebrew ? "התראות push" : "Push notifications"}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={isOn}
          disabled={blocked || showSpinner}
          onClick={() => (isOn ? disable() : enable())}
          className={clsx(
            "min-h-[44px] min-w-[88px] px-3 inline-flex items-center justify-center gap-2 rounded-lg border text-xs font-bold transition-colors",
            isOn
              ? "bg-primary text-on-primary border-primary"
              : "bg-surface-container-lowest text-on-surface-variant border-outline",
            (blocked || showSpinner) && "opacity-60 cursor-not-allowed",
          )}
        >
          <span
            className={clsx(
              "inline-block w-9 h-5 rounded-full relative transition-colors shrink-0",
              isOn ? "bg-on-primary/30" : "bg-outline-variant",
            )}
            aria-hidden
          >
            <span
              className={clsx(
                "absolute top-0.5 w-4 h-4 rounded-full bg-surface-container-lowest transition-all",
                isOn
                  ? isHebrew ? "left-0.5" : "right-0.5"
                  : isHebrew ? "right-0.5" : "left-0.5",
              )}
            />
          </span>
          <span>
            {showSpinner
              ? isHebrew ? "..." : "..."
              : isOn
                ? isHebrew ? "פעיל" : "On"
                : isHebrew ? "כבוי" : "Off"}
          </span>
        </button>
      </div>
      <p className="text-[11px] text-on-surface-variant">
        {statusHint(status, isHebrew)}
      </p>
      {error && (
        <p className="inline-flex items-center gap-1.5 text-xs text-error">
          <AlertCircle className="h-3.5 w-3.5" strokeWidth={2} />
          {translateError(error, isHebrew)}
        </p>
      )}
      {!error && isOn && (
        <p className="inline-flex items-center gap-1.5 text-xs text-secondary">
          <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
          {isHebrew ? "תקבל תזכורת לפני שהימור נסגר" : "You'll get a reminder before each bet locks"}
        </p>
      )}
    </div>
  );
}

function statusHint(status: Status, isHebrew: boolean): string {
  switch (status) {
    case "unsupported":
      return isHebrew
        ? "הדפדפן הזה לא תומך ב-push. נסה Chrome / Firefox / Edge בדסקטופ או אנדרואיד."
        : "This browser doesn't support push. Try Chrome / Firefox / Edge on desktop or Android.";
    case "denied":
      return isHebrew
        ? "הרשאה נדחתה. אפשר לפתוח התראות בהגדרות האתר של הדפדפן."
        : "Permission denied. Allow notifications in your browser site settings.";
    case "vapid_missing":
      return isHebrew
        ? "המערכת עוד לא מוגדרת ל-push. אדמין צריך להריץ pnpm push:vapid."
        : "Server not configured for push. Admin needs to run pnpm push:vapid.";
    case "loading":
      return isHebrew ? "מחבר..." : "Connecting...";
    case "on":
      return isHebrew
        ? "תזכורות פעילות במכשיר הזה. אפשר לכבות בכל רגע."
        : "Active on this device. Turn off whenever you like.";
    case "off":
      return isHebrew
        ? "הפעל כדי לקבל תזכורת לפני שהימור נסגר."
        : "Enable to get a reminder before each bet locks.";
    default:
      return "";
  }
}

// Push-flow errors are unique enough (browser permission + Web Push
// subscribe + server save are three separate failure surfaces) that
// they don't share the COMMON_PLAYER map; they get their own catalog.
const ERROR_MAP = {
  subscribe_failed: [
    "ההרשמה ל-push נכשלה. נסה שוב מאוחר יותר.",
    "Failed to subscribe to push. Try again later.",
  ],
  unsubscribe_failed: [
    "כיבוי ה-push נכשל. ההגדרה נשמרה.",
    "Failed to unsubscribe. Preference still saved.",
  ],
  db: ["שגיאת שמירה", "Save failed"],
  unauthorized: ["יש להתחבר", "Sign in required"],
} as const satisfies Record<string, LocalizedTuple>;

function translateError(code: string, isHebrew: boolean): string {
  return translateErrorCode(code in ERROR_MAP ? code : "db", ERROR_MAP, isHebrew);
}

// Wait for an active service worker, but bail after `timeoutMs` so a
// dev environment that never registers a SW (the global registrar
// skips dev for HMR sanity) doesn't pin the toggle in "loading"
// forever. Returns the registration on success, null on timeout.
async function waitForActiveSW(
  timeoutMs: number,
): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }
  return Promise.race<ServiceWorkerRegistration | null>([
    navigator.serviceWorker.ready,
    new Promise((resolve) => window.setTimeout(() => resolve(null), timeoutMs)),
  ]);
}

// VAPID public keys are base64url. PushManager.subscribe needs a
// BufferSource. We back the Uint8Array with a fresh ArrayBuffer to
// satisfy TS5's strict ArrayBuffer/SharedArrayBuffer split.
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(b64);
  const buf = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i += 1) view[i] = raw.charCodeAt(i);
  return view;
}
