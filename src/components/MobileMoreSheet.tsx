"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LogOut, MoreHorizontal } from "lucide-react";
import { clsx } from "clsx";
import type { Locale } from "@/app/[lang]/dictionaries";
import { localePath } from "@/lib/paths";
import { MobileNavIcon } from "@/lib/mobile-nav-icons";
import type { MobileNavItemKey } from "@/lib/mobile-nav";

type SheetItem = {
  key: MobileNavItemKey;
  path: string;
  label: string;
};

type Labels = {
  moreCell: string;
  openSheet: string;
  closeSheet: string;
  logout: string;
};

// The "עוד" trigger in the mobile bottom bar + the bottom-sheet menu it
// opens. Items are admin-controlled (see _plans/2026-05-27-admin-mobile
// -nav-config.md) — this component is dumb about ordering and just
// renders whatever it gets in `items`. Logout stays anchored at the
// bottom of the sheet as a session action, not a nav item, and is not
// configurable.
export function MobileMoreSheet({
  locale,
  items,
  labels,
}: {
  locale: Locale;
  items: SheetItem[];
  labels: Labels;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname() ?? "";
  const sheetRef = useRef<HTMLDivElement | null>(null);

  const triggerActive = items.some((i) => {
    const t = localePath(locale, i.path);
    return pathname === t || pathname.startsWith(t + "/");
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Close the sheet when the route changes (e.g. user hits browser back
  // while the sheet is open). The Link onClick handlers also close it,
  // but those don't fire on a popstate navigation.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setOpen(false); }, [pathname]);

  const close = () => setOpen(false);
  const toggle = () => setOpen((prev) => !prev);

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={labels.openSheet}
        className={clsx(
          "flex flex-col items-center justify-center gap-1 px-1 py-2 min-h-[56px] transition-colors cursor-pointer",
          triggerActive ? "text-primary" : "text-on-surface-variant",
        )}
      >
        <span aria-hidden>
          <MoreHorizontal className="h-5 w-5" strokeWidth={1.75} />
        </span>
        <span className="font-[family-name:var(--font-label)] text-[10px] leading-none font-bold tracking-[0.03em] truncate max-w-full">
          {labels.moreCell}
        </span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[70] md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label={labels.openSheet}
        >
          <button
            type="button"
            aria-label={labels.closeSheet}
            onClick={close}
            className="absolute inset-0 bg-on-surface/40 backdrop-blur-[2px] cursor-pointer"
          />
          <div
            ref={sheetRef}
            className="absolute bottom-0 left-0 right-0 bg-surface-container rounded-t-2xl border-t border-outline-variant shadow-[0_-12px_32px_rgba(28,20,15,0.18)] pb-[env(safe-area-inset-bottom)]"
          >
            <div className="flex justify-center pt-2 pb-1" aria-hidden>
              <span className="h-1 w-10 rounded-full bg-outline-variant" />
            </div>
            <ul className="flex flex-col py-2">
              {items.map((item) => {
                const target = localePath(locale, item.path);
                const active =
                  pathname === target || pathname.startsWith(target + "/");
                return (
                  <li key={item.key}>
                    <Link
                      href={target}
                      onClick={close}
                      className={clsx(
                        "flex items-center gap-3 px-5 min-h-[56px] transition-colors",
                        active
                          ? "bg-primary-fixed text-primary font-bold"
                          : "text-on-surface hover:bg-surface-container-high",
                      )}
                    >
                      <span aria-hidden className="shrink-0">
                        <MobileNavIcon itemKey={item.key} />
                      </span>
                      <span className="text-base">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <form
              action="/auth/signout"
              method="POST"
              className="border-t border-outline-variant"
            >
              <button
                type="submit"
                className="w-full flex items-center gap-3 px-5 min-h-[56px] text-error hover:bg-error-container transition-colors cursor-pointer"
              >
                <LogOut className="h-5 w-5" strokeWidth={1.75} />
                <span className="text-base font-bold">{labels.logout}</span>
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
