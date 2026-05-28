// Hebrew-specific formatting helpers.
//
// Hebrew has special singular/dual/plural rules for time units (דקה /
// שתי דקות / N דקות, שעה / שעתיים / N שעות) that don't fit the generic
// pluralization libraries cleanly. This module is the single source of
// truth for those — push notifications, email reminders and any future
// surface should all funnel through here so the wording stays consistent.

// "ממש עכשיו" / "בעוד דקה" / "בעוד שתי דקות" / "בעוד N דקות" /
// "בעוד שעה" / "בעוד שעתיים" / "בעוד N שעות".
//
// Negative values clamp to "ממש עכשיו"; values under 60 minutes render
// in minutes; values at-or-above 60 are rounded to whole hours so the
// reminder text isn't "in 73 minutes" (correct but jarring).
export function formatMinutesRemainingHe(minutes: number): string {
  if (minutes <= 0) return "ממש עכשיו";
  if (minutes === 1) return "בעוד דקה";
  if (minutes === 2) return "בעוד שתי דקות";
  if (minutes < 60) return `בעוד ${minutes} דקות`;
  const hours = Math.round(minutes / 60);
  if (hours === 1) return "בעוד שעה";
  if (hours === 2) return "בעוד שעתיים";
  return `בעוד ${hours} שעות`;
}
