// Client-safe promise timeout. Used to bound a server-action call from the
// client so a hung request can never leave a save button stuck on "שומר…"
// forever — the await rejects after SAVE_TIMEOUT_MS and the caller shows a
// retryable error instead. For `fetch`, prefer an AbortController (it also
// cancels the in-flight request); use this for server actions, which the
// client cannot abort. See _plans/2026-06-10-db-pool-saturation-fix.md.
//
// No "server-only" / "use client" pin: this is a plain helper safe to import
// from either side.

// How long the client waits on a single save before giving up. Generous on
// purpose: only a genuine hang should trip it, not a merely-slow save. Saves
// are idempotent upserts, so a retry after a false-timeout cannot double-write.
export const SAVE_TIMEOUT_MS = 20_000;

export class TimeoutError extends Error {
  constructor(message = "timed out") {
    super(message);
    this.name = "TimeoutError";
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new TimeoutError()), ms);
    promise.then(
      (value) => {
        clearTimeout(id);
        resolve(value);
      },
      (err) => {
        clearTimeout(id);
        reject(err);
      },
    );
  });
}
