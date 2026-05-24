"use client";

import { useEffect, useState } from "react";
import { Smartphone, Download, Share, X } from "lucide-react";
import { Card, LabelCaps } from "./ui";

const DISMISS_KEY = "toto:install-hint:dismissed";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

// Banner that helps players install the PWA on their home screen.
//
// Visible only when:
//   - The app is NOT already running as a standalone PWA
//   - The user hasn't tapped the dismiss X this session
//   - One of: Android/Chrome fired `beforeinstallprompt`, OR the browser is
//     iOS Safari (no programmatic prompt — we explain the share-sheet flow).
export function InstallHint({ locale }: { locale: "he" | "en" }) {
  const isHebrew = locale === "he";
  const [installEvent, setInstallEvent] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setIsStandalone(
      window.matchMedia("(display-mode: standalone)").matches ||
        // iOS Safari uses this older flag instead of display-mode.
        (window.navigator as Navigator & { standalone?: boolean }).standalone ===
          true,
    );
    const ua = window.navigator.userAgent || "";
    setIsIOS(/iPad|iPhone|iPod/.test(ua));
    setDismissed(window.localStorage.getItem(DISMISS_KEY) === "1");

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstallEvent(null);
      setIsStandalone(true);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (isStandalone || dismissed) return null;
  // Show only when we have an Android prompt OR we're on iOS Safari.
  if (!installEvent && !isIOS) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Storage unavailable — fine, the state still hides the card.
    }
  };

  const install = async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    const result = await installEvent.userChoice;
    if (result.outcome === "accepted") {
      setInstallEvent(null);
    }
  };

  return (
    <Card className="p-4 md:p-5 flex items-start gap-3 relative">
      <button
        type="button"
        onClick={dismiss}
        aria-label={isHebrew ? "סגור" : "Dismiss"}
        className={`absolute top-1 ${isHebrew ? "left-1" : "right-1"} min-w-[40px] min-h-[40px] flex items-center justify-center text-on-surface-variant hover:text-on-surface`}
      >
        <X className="h-4 w-4" strokeWidth={2} />
      </button>
      <div className="w-10 h-10 rounded-full bg-primary-fixed flex items-center justify-center text-on-primary-fixed-variant shrink-0">
        <Smartphone className="h-5 w-5" strokeWidth={1.75} />
      </div>
      <div className="flex flex-col gap-2 min-w-0 flex-1">
        <div className="flex flex-col gap-0.5">
          <LabelCaps>{isHebrew ? "טיפ" : "Tip"}</LabelCaps>
          <h3 className="font-bold text-base text-on-surface">
            {isHebrew
              ? "התקן את הטוטו כאפליקציה"
              : "Install Toto as an app"}
          </h3>
          <p className="text-sm text-on-surface-variant">
            {installEvent
              ? isHebrew
                ? "מהיר יותר, פתיחה ישירה מהמסך הראשי, בלי דפדפן."
                : "Faster, opens straight from your home screen, no browser bar."
              : isHebrew
                ? "ב-Safari: לחץ על כפתור השיתוף ואז 'הוסף למסך הבית'."
                : "In Safari: tap the share button, then 'Add to Home Screen'."}
          </p>
        </div>
        {installEvent ? (
          <button
            type="button"
            onClick={install}
            className="press-down self-start inline-flex items-center gap-1.5 min-h-[40px] px-4 rounded-full bg-primary text-on-primary font-[family-name:var(--font-label)] text-[12px] font-bold tracking-[0.05em] hover:bg-surface-tint transition-colors"
          >
            <Download className="h-4 w-4" strokeWidth={2} />
            {isHebrew ? "התקן" : "Install"}
          </button>
        ) : isIOS ? (
          <div className="inline-flex items-center gap-1.5 text-xs text-on-surface-variant">
            <Share className="h-3.5 w-3.5" strokeWidth={2} />
            <span>{isHebrew ? "→ הוסף למסך הבית" : "→ Add to Home Screen"}</span>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
