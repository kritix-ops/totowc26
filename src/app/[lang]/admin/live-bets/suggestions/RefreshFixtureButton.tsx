"use client";

import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { clsx } from "clsx";
import type { Locale } from "../../../dictionaries";
import { usePendingAction } from "@/lib/use-pending-action";
import { refreshOddsForFixture } from "./actions";

// "Refresh odds" affordance per fixture. fetches the latest /odds
// response from API-Football (busting the 60s wrapper cache via
// revalidatePath on the server) and triggers a router refresh.

export function RefreshFixtureButton({
  matchId,
  locale,
}: {
  matchId: string;
  locale: Locale;
}) {
  const router = useRouter();
  const isHebrew = locale === "he";
  const { pending, run } = usePendingAction();

  const click = () => {
    void run(async () => {
      await refreshOddsForFixture(matchId);
      router.refresh();
    });
  };

  return (
    <button
      type="button"
      onClick={click}
      disabled={pending}
      aria-label={isHebrew ? "רענן יחסים" : "Refresh odds"}
      className={clsx(
        "h-9 w-9 inline-flex items-center justify-center rounded-md bg-surface-container-low text-on-surface hover:bg-surface-container",
        pending && "opacity-60 cursor-not-allowed",
      )}
    >
      <RefreshCw
        className={clsx("h-4 w-4", pending && "animate-spin")}
        strokeWidth={1.75}
      />
    </button>
  );
}
