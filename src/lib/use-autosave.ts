"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type AutosaveState = "idle" | "saving" | "saved" | "error";

// Debounced, single-flight autosave for one editable surface (a match-pick
// row, a free-pick card, an admin draft form). The caller drives it
// imperatively via `schedule(value)` on every real user edit — NOT by the
// hook watching a prop — so a server-driven prop refresh (revalidatePath
// landing the value the user already saved) can never re-trigger a write.
//
// Why single-flight matters here: the prior production incident was rapid
// writes piling up and saturating the DB pool. This hook guarantees this
// surface can never contribute to that:
//   • ONE write in flight at a time. Edits that arrive mid-save don't fan
//     out into parallel requests — they update the pending value and fire
//     exactly one follow-up save once the current one settles, with the
//     LATEST value (intermediate steps are skipped). A burst of N edits
//     costs at most 2 writes, never N.
//   • Debounced: edits within `delay` collapse into a single write.
//   • Idempotent by contract: the caller's `save` must be an idempotent
//     upsert, so a retry — or a superseded write the server already applied
//     — can never double-commit.
//
// `status` drives the inline <SaveStatus />: "saving" the moment an edit is
// scheduled (covering both the debounce wait and the request), "saved" once
// durable, "error" on a failed or throwing save (recover via `retry()`).
export function useAutosave<T>({
  save,
  delay = 800,
}: {
  // Persist one value. Resolve true on success, false on a handled failure.
  // A thrown/rejected promise (transport, timeout) counts as a failure.
  save: (value: T) => Promise<boolean>;
  delay?: number;
}): {
  status: AutosaveState;
  schedule: (value: T) => void;
  retry: () => void;
  cancel: () => void;
  flush: () => void;
} {
  const [status, setStatus] = useState<AutosaveState>("idle");

  // Keep the latest save closure without making it a dependency of the
  // memoized callbacks — the hook's identity-stable schedule/retry always
  // call through to the current save. Assigned in an effect (not during
  // render) per the refs lint rule; saves are debounced ≥`delay`, long after
  // the effect has run, so the ref is always current by the time it's read.
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });

  const pendingRef = useRef<{ value: T } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const resaveRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const runSave = useCallback(async () => {
    // Already saving — remember to fire once more afterwards with whatever
    // the latest pending value is by then. This is the coalescing guarantee.
    if (inFlightRef.current) {
      resaveRef.current = true;
      return;
    }
    if (!pendingRef.current) return;

    inFlightRef.current = true;
    try {
      // Loop rather than recurse so edits that land mid-save coalesce into a
      // single follow-up write (never parallel writes), and so the hook
      // doesn't self-reference a useCallback (which the linter rejects).
      for (;;) {
        resaveRef.current = false;
        const pending = pendingRef.current;
        if (!pending) return;

        let ok = false;
        try {
          ok = await saveRef.current(pending.value);
        } catch {
          ok = false;
        }
        if (!mountedRef.current) return;

        // A newer edit arrived during this save → persist the latest next.
        if (resaveRef.current) continue;
        // A fresh debounce timer is still pending → let it fire the next
        // save; keep showing "saving" until that one settles. (Avoids a
        // "saved" flash the next write immediately overrides, and a stale
        // failure the pending retry supersedes.)
        if (timerRef.current !== null) return;

        setStatus(ok ? "saved" : "error");
        return;
      }
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  const schedule = useCallback(
    (value: T) => {
      pendingRef.current = { value };
      setStatus("saving");
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void runSave();
      }, delay);
    },
    [delay, runSave],
  );

  const retry = useCallback(() => {
    if (!pendingRef.current) return;
    setStatus("saving");
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    void runSave();
  }, [runSave]);

  // Fire a pending debounced save immediately (e.g. the user is navigating
  // away and we don't want to lose the last sub-debounce edit). No-op when
  // nothing is queued. The write itself still runs server-side even if the
  // component then unmounts, since the action is already dispatched.
  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      void runSave();
    }
  }, [runSave]);

  // Drop a not-yet-started save and return to idle. Used when an edit is
  // undone before it persists — e.g. deselecting a free-pick option within
  // the debounce window, which should save nothing rather than commit the
  // option the user just abandoned. A save already in flight can't be
  // un-sent, so it's left to finish (the undone edit simply schedules none).
  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!inFlightRef.current) {
      pendingRef.current = null;
      setStatus("idle");
    }
  }, []);

  return { status, schedule, retry, cancel, flush };
}
