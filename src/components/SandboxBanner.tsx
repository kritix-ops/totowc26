import { FlaskConical } from "lucide-react";
import type { Locale } from "@/app/[lang]/dictionaries";
import { isSandbox } from "@/lib/env";

// Persistent strip pinned to the very top of every page in the sandbox
// deployment. Returns null on production so it costs nothing there.
// Lives above the view-as banner (z-[70] vs z-[60]) so when both are
// shown the admin always sees "you are in sandbox" first.
//
// Safety lens (CLAUDE.md rule 10): if the admin ever has prod and
// sandbox open in different tabs the danger is forgetting which one
// they're acting on. A visually distinct, always-present banner makes
// that confusion impossible.
export function SandboxBanner({ locale }: { locale: Locale }) {
  if (!isSandbox()) return null;
  const isHebrew = locale === "he";
  const label = isHebrew
    ? "סביבת סאנדבוקס – שינויים כאן לא נראים בפרודקשן"
    : "Sandbox environment – changes here are invisible to production";
  return (
    <div
      role="status"
      className="fixed top-0 left-0 right-0 z-[70] h-10 flex items-center justify-center gap-2 px-4 bg-tertiary text-on-tertiary border-b border-tertiary-fixed-dim"
    >
      <FlaskConical className="h-4 w-4 shrink-0" strokeWidth={2.5} />
      <span className="font-[family-name:var(--font-label)] text-[12px] md:text-[13px] font-bold tracking-[0.05em] truncate">
        {label}
      </span>
    </div>
  );
}

// Pixel height of the banner when shown. AppShell uses this to push the
// header / other top banners down. Keep in sync with the `h-10` class above.
export const SANDBOX_BANNER_HEIGHT_PX = 40;
