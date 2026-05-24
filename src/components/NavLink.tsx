"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { localePath } from "@/lib/paths";
import type { Locale } from "@/app/[lang]/dictionaries";
import { clsx } from "clsx";

function useIsActive(locale: Locale, path: string, exact?: boolean) {
  const pathname = usePathname() ?? "";
  const target = localePath(locale, path);
  if (exact) return pathname === target;
  return pathname === target || pathname.startsWith(target + "/");
}

export function NavLink({
  locale,
  path,
  label,
  exact,
}: {
  locale: Locale;
  path: string;
  label: string;
  exact?: boolean;
}) {
  const active = useIsActive(locale, path, exact);
  return (
    <Link
      href={localePath(locale, path)}
      className={clsx(
        "h-full flex items-center px-2 transition-colors hover:bg-surface-container-high",
        active
          ? "text-primary font-bold border-b-2 border-primary"
          : "text-on-surface-variant",
      )}
    >
      {label}
    </Link>
  );
}

export function BottomNavLink({
  locale,
  path,
  label,
  icon,
  exact,
}: {
  locale: Locale;
  path: string;
  label: string;
  icon: React.ReactNode;
  exact?: boolean;
}) {
  const active = useIsActive(locale, path, exact);
  return (
    <Link
      href={localePath(locale, path)}
      className={clsx(
        "flex flex-col items-center justify-center gap-1 px-1 py-2 min-h-[56px] transition-colors",
        active ? "text-primary" : "text-on-surface-variant",
      )}
    >
      <span aria-hidden>{icon}</span>
      <span className="font-[family-name:var(--font-label)] text-[10px] leading-none font-bold tracking-[0.03em] truncate max-w-full">
        {label}
      </span>
    </Link>
  );
}
