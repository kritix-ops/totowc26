"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { BookOpen, Globe2, LogOut, Shield, User as UserIcon } from "lucide-react";
import type { Locale } from "@/app/[lang]/dictionaries";
import { localePath } from "@/lib/paths";
import { WhatsAppGlyph } from "./WhatsAppGlyph";

type Labels = {
  profile: string;
  admin: string;
  rules: string;
  language: string;
  languageOther: string;
  logout: string;
  openMenu: string;
  whatsapp: string;
};

const LOCALES = ["he", "en"] as const;

export function ProfileMenu({
  locale,
  displayName,
  isAdmin,
  whatsappGroupUrl,
  labels,
}: {
  locale: Locale;
  displayName: string;
  isAdmin: boolean;
  whatsappGroupUrl: string | null;
  labels: Labels;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const [, startTransition] = useTransition();
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

  const switchLanguage = () => {
    const next: Locale = locale === "he" ? "en" : "he";
    const segments = pathname.split("/").filter(Boolean);
    if (LOCALES.includes(segments[0] as Locale)) {
      segments[0] = next;
    } else {
      segments.unshift(next);
    }
    const target = "/" + segments.join("/");
    console.info("[profile menu language switch]", { from: locale, to: next, target });
    setOpen(false);
    startTransition(() => {
      router.push(target);
    });
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={labels.openMenu}
        className="press-down w-11 h-11 rounded-full bg-primary text-on-primary flex items-center justify-center font-bold text-base ring-2 ring-tertiary-fixed-dim shrink-0 hover:brightness-105 transition-[filter,transform] cursor-pointer"
      >
        {initial}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute top-full mt-2 end-0 z-50 min-w-[220px] bg-surface-container-low border border-outline-variant rounded-xl shadow-[0_12px_32px_rgba(28,20,15,0.16)] overflow-hidden"
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

          {whatsappGroupUrl && (
            <a
              href={whatsappGroupUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={close}
              role="menuitem"
              className="flex items-center gap-3 px-4 min-h-[48px] text-on-surface hover:bg-surface-container transition-colors border-t border-outline-variant"
            >
              <span
                className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                style={{ backgroundColor: "#25D366" }}
                aria-hidden
              >
                <WhatsAppGlyph className="w-3.5 h-3.5 text-white" />
              </span>
              <span className="font-bold text-sm">{labels.whatsapp}</span>
            </a>
          )}

          <button
            type="button"
            onClick={switchLanguage}
            role="menuitem"
            className="w-full flex items-center gap-3 px-4 min-h-[48px] text-on-surface hover:bg-surface-container transition-colors border-t border-outline-variant cursor-pointer"
          >
            <Globe2 className="h-5 w-5 text-on-surface-variant" strokeWidth={1.75} />
            <span className="font-bold text-sm">{labels.language}</span>
            <span className="ms-auto font-[family-name:var(--font-label)] text-[12px] font-bold tracking-[0.05em] text-on-surface-variant">
              {labels.languageOther}
            </span>
          </button>

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
