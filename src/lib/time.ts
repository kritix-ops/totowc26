// Time constants + tiny helpers.
//
// The point of the helpers below is grep-ability and intent-clarity:
// `daysFromNow(60)` reads as "60 days from now"; `Date.now() + 60 * 24
// * 60 * 60 * 1000` reads as "math". Same value, very different review
// experience.
//
// Pure-JS, no env or React dependencies, safe to import from server +
// client.

export const MS_PER_SECOND = 1000;
export const MS_PER_MINUTE = 60 * MS_PER_SECOND;
export const MS_PER_HOUR = 60 * MS_PER_MINUTE;
export const MS_PER_DAY = 24 * MS_PER_HOUR;

// Epoch millis `n` days into the future. Used by fallback "no upstream
// kickoff yet, pick a sensible far-out lock" branches.
export function daysFromNow(n: number): number {
  return Date.now() + n * MS_PER_DAY;
}

// Epoch millis `n` hours into the future.
export function hoursFromNow(n: number): number {
  return Date.now() + n * MS_PER_HOUR;
}
