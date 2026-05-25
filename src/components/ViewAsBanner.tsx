"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, X } from "lucide-react";
import { clsx } from "clsx";
import type { Locale } from "@/app/[lang]/dictionaries";
import type { ViewAsRole } from "@/lib/view-as";
import { clearViewAs } from "@/app/[lang]/admin/view-as-actions";

// Pinned banner shown across every page while an admin is impersonating
// a player role. The X button drops the cookie and reloads the layout
// so the admin is themselves again immediately.
export function ViewAsBanner({
  locale,
  role,
}: {
  locale: Locale;
  role: ViewAsRole;
}) {
  const isHebrew = locale === "he";
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const label =
    role === "paid"
      ? isHebrew
        ? "צופה כמשתמש ששילם"
        : "Viewing as a paid player"
      : isHebrew
        ? "צופה כמשתמש שלא שילם"
        : "Viewing as an unpaid player";

  const handleExit = () => {
    startTransition(async () => {
      await clearViewAs();
      router.refresh();
    });
  };

  return (
    <div
      role="status"
      className={clsx(
        "w-full flex items-center justify-between gap-3 px-4 md:px-16 py-2 border-b text-on-tertiary-fixed-variant bg-tertiary-fixed border-tertiary-fixed-dim",
      )}
    >
      <span className="inline-flex items-center gap-2 min-w-0">
        <Eye className="h-4 w-4 shrink-0" strokeWidth={2} />
        <span className="font-[family-name:var(--font-label)] text-[12px] md:text-[13px] font-bold tracking-[0.05em] truncate">
          {label}
        </span>
      </span>
      <button
        type="button"
        onClick={handleExit}
        disabled={pending}
        className={clsx(
          "press-down inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-full bg-surface text-on-surface font-[family-name:var(--font-label)] text-[12px] font-bold tracking-[0.05em] hover:bg-surface-container transition-colors",
          pending && "opacity-60 cursor-wait",
        )}
      >
        <X className="h-3.5 w-3.5" strokeWidth={2.5} />
        {pending
          ? isHebrew
            ? "יוצא..."
            : "Exiting..."
          : isHebrew
            ? "חזור לאדמין"
            : "Back to admin"}
      </button>
    </div>
  );
}
