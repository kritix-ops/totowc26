// Pure template + vote-share helpers for PoolDigestSection.
//
// The widget itself is a server component and the query lives behind
// real-DB plumbing, so the logic worth covering at unit level is the
// pure projection: how raw counts get turned into the strings and
// percentages a human reads. Extracting them here keeps the React
// component thin and gives the tests a stable target.

export type DigestVote = {
  count: number;
  total: number;
};

export function fillTemplate(
  template: string,
  values: Record<string, string | number>,
): string {
  let out = template;
  for (const [key, value] of Object.entries(values)) {
    out = out.split(`{${key}}`).join(String(value));
  }
  return out;
}

// Percentage of the pool that picked this answer. Returns 0 when the
// total is 0 so the UI never divides by zero. Rounds to the nearest
// integer — the widget displays a single tile per row, not a chart, so
// sub-percent precision is noise.
export function votePercent({ count, total }: DigestVote): number {
  if (total <= 0) return 0;
  return Math.round((count / total) * 100);
}

// True when one pick value swept the entire question. The caller
// surfaces "Everyone picked X" instead of "8/8 picked X" because the
// fraction reads as awkward at 100% consensus.
export function isUnanimous(
  topCount: number,
  total: number,
  altCount: number | null,
): boolean {
  if (total <= 0) return false;
  if (altCount !== null && altCount > 0) return false;
  return topCount === total;
}
