"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Single source of truth for "run a server action and show a pending
// state on a button". Replaces the `useTransition` pattern that every
// save button used to use.
//
// Why this exists — the bug it kills:
//   `useTransition` keeps `isPending` true until the server action AND
//   the revalidation it triggers (revalidatePath / cookie set, etc.)
//   have re-rendered the page. On a page with no Suspense boundary the
//   whole route re-fetches inside that transition, and — per the Next
//   docs — "the client dispatches and awaits Server Functions one at a
//   time". So a second click queues behind the first transition while
//   it is still settling its revalidation refetch, and the button sits
//   on "Saving…" forever. That is the "only the first save worked"
//   report. See _plans/2026-05-29-save-button-hang-fix.md.
//
// What this does instead — the official event-handler pattern from
// node_modules/next/dist/docs/.../07-mutating-data.md (the
// `incrementLike` example): `await` the action directly, drive the UI
// from its return value, and flip `pending` off in a `finally`. The
// promise resolves on the action's RESPONSE, not on the revalidation
// re-render, so the button releases the instant the row is durable.
// The revalidation still happens server-side and refreshes data in the
// background; the button just no longer waits on it.
//
// Guarantees:
//   • `pending` is ALWAYS cleared once the action settles — success,
//     business-level failure, or a thrown/rejected transport error (the
//     `finally`). The button can never get stuck on "Saving…".
//   • A transport-level throw (offline, 500) is caught here so callers
//     can safely `void run(...)` without producing an unhandled
//     rejection, and it is logged for diagnosis. Business failures
//     (`{ ok: false }`) are NOT thrown — callers handle those inside
//     `fn` (e.g. setError) as usual.
//   • Re-entrant clicks are ignored while one run is in flight (the
//     `inFlight` ref guards the very first synchronous instant, before
//     React has even committed `pending = true`).
//   • If the component unmounts mid-flight (e.g. a revalidation swapped
//     the row out), we skip the trailing setState so React doesn't warn
//     and stale state can't leak back in.
export function usePendingAction(): {
  pending: boolean;
  run: (fn: () => Promise<void>) => Promise<void>;
} {
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async (fn: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    try {
      await fn();
    } catch (err) {
      // Only transport-level failures reach here — every server action
      // returns a typed { ok: false } for expected errors. Log so a
      // stuck-looking save has a console trail; the button still resets.
      console.error("[pending-action] server action threw", err);
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(false);
    }
  }, []);

  return { pending, run };
}
