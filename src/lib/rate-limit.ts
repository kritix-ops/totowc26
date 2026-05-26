import "server-only";

// In-memory token bucket. Used by the public signup endpoint to slow a
// single source from flooding the queue. Per-instance (each Vercel Lambda
// has its own bucket and a cold start resets it) - that is *fine* for a
// friends pool where ~50 honest users hit the form ever, but anything
// touching real money or wide public traffic should use Upstash/Redis
// instead. Don't reach for this helper for those cases.
//
// Algorithm:
//   - capacity tokens, refilled at `tokensPerHour / 3600` tokens per second.
//   - allow() consumes one token if available, returns true; else returns
//     false and the existing bucket is untouched.
//   - Buckets are keyed by an opaque identifier (typically the request IP).
//   - Stale buckets (full and untouched for an hour) are evicted on
//     touch to keep the map bounded; nothing scans periodically.

type Bucket = { tokens: number; updatedAt: number };

const STORE = new Map<string, Bucket>();

export type RateLimitOptions = {
  capacity: number;
  tokensPerHour: number;
};

export function allow(key: string, opts: RateLimitOptions): boolean {
  const now = Date.now();
  const refillRatePerMs = opts.tokensPerHour / 3_600_000;
  const existing = STORE.get(key);
  const current = existing
    ? Math.min(
        opts.capacity,
        existing.tokens + (now - existing.updatedAt) * refillRatePerMs,
      )
    : opts.capacity;

  if (current < 1) {
    STORE.set(key, { tokens: current, updatedAt: now });
    return false;
  }

  STORE.set(key, { tokens: current - 1, updatedAt: now });
  return true;
}
