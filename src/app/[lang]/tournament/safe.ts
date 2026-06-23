import "server-only";

// Resilience helper for the tournament zone. Each tab aggregates several
// independent data sources — our own DB plus external sports APIs
// (API-Football, football-data). They used to sit in a single Promise.all,
// so one source throwing rejected the whole batch and dropped the entire
// page into the route error boundary (the "לא הצלחנו לטעון את העמוד"
// screen the user reported). `settle` resolves a single source to a safe
// fallback when it throws, and logs which one broke, so a flaky upstream
// or a slow query degrades to that one card's empty state instead of
// taking down the tab. Wrap each optional source; keep genuinely essential
// reads (e.g. the locale dictionary) as plain awaits.
export async function settle<T>(
  label: string,
  fallback: T,
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (err) {
    console.error(`[tournament] source "${label}" failed; using fallback`, err);
    return fallback;
  }
}
