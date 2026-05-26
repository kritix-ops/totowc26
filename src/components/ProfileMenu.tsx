"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BookOpen, LogOut, Shield, User as UserIcon } from "lucide-react";
import type { Locale } from "@/app/[lang]/dictionaries";
import { localePath } from "@/lib/paths";

type Labels = {
  profile: string;
  admin: string;
  rules: string;
  logout: string;
  openMenu: string;
};

export function ProfileMenu({
  locale,
  displayName,
  isAdmin,
  labels,
}: {
  locale: Locale;
  displayName: string;
  isAdmin: boolean;
  labels: Labels;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const isHebrew = locale === "he";
  const initial = (displayName.trim()[0] ?? "?").toUpperCase();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent | TouchEvent) => {
      if (!rootRef.current) return;
      if (e.target instanceof Node && !rootRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = () => {
    setOpen((prev) => {
      const next = !prev;
      if (next) console.info("[profile menu open]", { isAdmin });
      return next;
    });
  };

  const close = () => setOpen(false);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={labels.openMenu}
        className="press-down w-10 h-10 md:w-10 md:h-10 rounded-full bg-primary text-on-primary flex items-center justify-center font-bold text-base ring-2 ring-tertiary-fixed-dim shrink-0 hover:brightness-105 transition-[filter,transform] cursor-pointer"
      >
        {initial}
      </button>

      {open && (
        <div
          role="menu"
          className={`absolute top-full mt-2 ${isHebrew ? "left-0" : "right-0"} z-50 min-w-[220px] bg-surface-container-low border border-outline-variant rounded-xl shadow-[0_12px_32px_rgba(28,20,15,0.16)] overflow-hidden`}
        >
          <div className="px-4 py-3 border-b border-outline-variant">
            <p className="font-bold text-sm text-on-surface truncate">
              {displayName}
            </p>
          </div>

          <Link
            href={localePath(locale, "profile")}
            onClick={close}
            role="menuitem"
            className="flex items-center gap-3 px-4 min-h-[48px] text-on-surface hover:bg-surface-container transition-colors"
          >
            <UserIcon className="h-5 w-5 text-on-surface-variant" strokeWidth={1.75} />
            <span className="font-bold text-sm">{labels.profile}</span>
          </Link>

          {isAdmin && (
            <Link
              href={localePath(locale, "admin")}
              onClick={close}
              role="menuitem"
              className="flex items-center gap-3 px-4 min-h-[48px] text-on-surface hover:bg-surface-container transition-colors border-t border-outline-variant"
            >
              <Shield className="h-5 w-5 text-tertiary" strokeWidth={1.75} />
              <span className="font-bold text-sm">{labels.admin}</span>
            </Link>
          )}

          <Link
            href={localePath(locale, "rules")}
            onClick={close}
            role="menuitem"
            className="flex items-center gap-3 px-4 min-h-[48px] text-on-surface hover:bg-surface-container transition-colors border-t border-outline-variant"
          >
            <BookOpen className="h-5 w-5 text-on-surface-variant" strokeWidth={1.75} />
            <span className="font-bold text-sm">{labels.rules}</span>
          </Link>

          <form action="/auth/signout" method="POST" className="border-t border-outline-variant">
            <button
              type="submit"
              role="menuitem"
              className="w-full flex items-center gap-3 px-4 min-h-[48px] text-error hover:bg-error-container transition-colors cursor-pointer"
            >
              <LogOut className="h-5 w-5" strokeWidth={1.75} />
              <span className="font-bold text-sm">{labels.logout}</span>
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
