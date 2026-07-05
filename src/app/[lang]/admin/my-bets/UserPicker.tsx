"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { Users } from "lucide-react";
import type { Locale } from "../../dictionaries";
import type { AdminSelectableUser } from "../users/queries";

// "Whose bets am I fixing?" picker for the backdate screen. A native <select>
// so it opens the OS picker on mobile (built-in scroll + type-to-search on the
// full roster) and stays a 48px touch target. Changing the selection navigates
// to ?user=<id> — the server component re-reads and loads that user's bets.
// The acting admin is pinned to the top as "me" and the URL param is dropped
// for the self case so the default screen stays clean.
export function UserPicker({
  locale,
  users,
  currentUserId,
  selfUserId,
}: {
  locale: Locale;
  users: AdminSelectableUser[];
  currentUserId: string;
  selfUserId: string;
}) {
  const isHebrew = locale === "he";
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  const meLabel = isHebrew ? "אני" : "Me";
  // Everyone except the acting admin (they're the pinned "me" option).
  const others = users.filter((u) => u.id !== selfUserId);

  function onChange(nextId: string) {
    console.info("[admin backdate] user_picked", { nextId, selfUserId });
    startTransition(() => {
      // Drop the ?user param for the self case so the default screen URL stays
      // clean; otherwise point it at the chosen user.
      if (nextId === selfUserId) {
        router.replace(pathname);
      } else {
        router.replace(`${pathname}?user=${encodeURIComponent(nextId)}`);
      }
    });
  }

  return (
    <label className="flex flex-col gap-1">
      <span className="font-[family-name:var(--font-label)] text-[11px] font-bold uppercase tracking-[0.05em] text-on-surface-variant inline-flex items-center gap-1.5">
        <Users className="h-3.5 w-3.5" strokeWidth={2} />
        {isHebrew ? "של מי ההימורים?" : "Whose bets?"}
      </span>
      <select
        value={currentUserId}
        onChange={(e) => onChange(e.target.value)}
        disabled={pending}
        dir={isHebrew ? "rtl" : "ltr"}
        className="min-h-12 w-full px-3 rounded-lg border border-outline-variant bg-surface text-base text-on-surface focus:outline-none focus:border-primary disabled:opacity-60"
      >
        <option value={selfUserId}>{meLabel}</option>
        {others.map((u) => (
          <option key={u.id} value={u.id}>
            {u.displayName}
          </option>
        ))}
      </select>
    </label>
  );
}
