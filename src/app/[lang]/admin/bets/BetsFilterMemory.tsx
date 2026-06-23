"use client";

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BETS_FILTER_STORAGE_KEY } from "@/lib/bets/admin-bet-filters";

// Behavioural island (renders nothing) that makes /admin/bets "remember"
// the admin's last filter set. The list is a pure URL-state server
// component, so all this does is bridge that URL to localStorage:
//
//   • on a fresh visit with NO filter params, restore the saved query
//     string so the admin lands back where they left off (the user asked
//     for auto-restore);
//   • on every filter change, save the current query string.
//
// The detail round-trip carries filters in a ?return= param for a flash-
// free back button; this localStorage net is the universal fallback for
// any other way back in (top nav, refresh, a deeper sub-page).
export function BetsFilterMemory() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Run the restore decision exactly once, before any save can clobber a
  // saved value with the empty default of a blank first render.
  const didInit = useRef(false);
  const skipNextSave = useRef(false);
  // Last value actually written, so re-renders that don't change the query
  // (Next can hand back a fresh searchParams object) don't re-write or
  // re-log identical state.
  const lastSaved = useRef<string | null>(null);

  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    if (searchParams.toString() !== "") return; // arrived with filters → keep
    const saved = window.localStorage.getItem(BETS_FILTER_STORAGE_KEY);
    if (saved && saved !== "") {
      console.info("[admin bets memory] restore", { saved });
      // The save effect fires on this same mount with the still-empty
      // params; skip that one write so it doesn't erase `saved` before the
      // replaced URL re-renders and saves itself.
      skipNextSave.current = true;
      router.replace(`?${saved}`, { scroll: false });
    }
  }, [router, searchParams]);

  useEffect(() => {
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    const current = searchParams.toString();
    if (current === lastSaved.current) return;
    lastSaved.current = current;
    window.localStorage.setItem(BETS_FILTER_STORAGE_KEY, current);
    console.info("[admin bets memory] save", { current });
  }, [searchParams]);

  return null;
}
