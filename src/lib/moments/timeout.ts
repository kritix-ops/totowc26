// Per-generator timeout wrapper for the Smart Hub fan-out. The Hub
// awaits Promise.all over every generator, so one slow query (DB plan
// regression, PgBouncer stall, network blip) would otherwise hold the
// whole card in its skeleton state. withTimeout caps each generator's
// wait at GENERATOR_TIMEOUT_MS and resolves to a safe fallback when
// the budget runs out, so the Hub paints with whatever finished in
// time instead of hanging indefinitely.
//
// Defined as a pure helper so it stays testable from vitest without
// touching the DB.

export const GENERATOR_TIMEOUT_MS = 800;

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
  fallback: T,
): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => {
      console.warn("[moments timeout]", { label, ms });
      resolve(fallback);
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        console.error("[moments generator failed]", { label, err });
        resolve(fallback);
      },
    );
  });
}
