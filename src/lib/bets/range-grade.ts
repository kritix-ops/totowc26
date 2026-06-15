// Maps a numeric result (total goals, corners, winning margin, ...) onto a
// multi_choice RANGE option so bets like "how many goals? 0-1 / 2-3 / 4+"
// auto-grade instead of dropping to the manual queue.
//
// Why this exists: the auto-grade resolver in sync.ts knows how to turn a
// final score into a NUMBER (total_goals -> 5) and how to pick a categorical
// multi_choice winner for match result (W/D/L) and exact halftime score. It
// had no path for a multi_choice whose options are numeric RANGES, so those
// bets silently skipped forever. See the live-bet "כמה שערים ייכבשו במשחק?"
// regression: a 5-goal game never resolved to its "4+" option.
//
// Pure module (no IO) so the resolver and its tests can import it freely.
//
// Safety first (bets are sacred): a number is only mapped when EXACTLY ONE
// option's range contains it. Zero matches or an ambiguous overlap returns
// null, which the caller turns into "skip" -> the bet falls back to manual
// grading rather than risk crediting the wrong outcome.

export type RangeOption = {
  value: string;
  labelHe?: string;
  labelEn?: string;
};

export type ParsedRange = { min: number; max: number };

// Parse one range token into an inclusive [min, max] interval, or null when
// the text is not a recognised range shape. Tokens come from an option's
// `value` first ("0-1", "2-3", "4+", "4plus") and fall back to its localized
// label ("0 to 1 goals", "4 goals or more", "0 עד 1 שערים", "4 שערים או יותר")
// when the value itself carries no numbers (e.g. a key like "high").
const NUM = "(\\d+(?:\\.\\d+)?)";

export function parseRangeToken(raw: string): ParsedRange | null {
  const s = raw.trim().toLowerCase();
  if (s.length === 0) return null;

  // "N+" / "N plus" / "Nplus" / "N goals or more" / "N שערים או יותר" /
  // "N ומעלה" -> [N, ∞). \D*? lets a word sit between the number and the
  // keyword ("4 goals or more") without ever skipping across another digit.
  const over = new RegExp(
    `${NUM}\\D*?(?:\\+|plus|or more|or above|or over|או יותר|ומעלה)`,
  ).exec(s);
  if (over) return { min: Number(over[1]), max: Infinity };

  // "under N" / "below N" / "N or less" / "N or fewer" / "N ומטה" / "N או פחות"
  // -> (-∞, N]. Listed for completeness; the generator rarely emits it.
  const under = new RegExp(
    `(?:under|below|less than|fewer than|פחות מ)\\s*${NUM}`,
  ).exec(s);
  if (under) return { min: -Infinity, max: Number(under[1]) };
  const orLess = new RegExp(
    `${NUM}\\D*?(?:or less|or fewer|ומטה|או פחות)`,
  ).exec(s);
  if (orLess) return { min: -Infinity, max: Number(orLess[1]) };

  // "N-M" / "N–M" / "N to M" / "N עד M" -> [N, M]
  const range = new RegExp(`${NUM}\\s*(?:[-–]|to|עד)\\s*${NUM}`).exec(s);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    return { min: Math.min(a, b), max: Math.max(a, b) };
  }

  // bare "N" -> exact [N, N]
  const exact = new RegExp(`^${NUM}$`).exec(s);
  if (exact) {
    const n = Number(exact[1]);
    return { min: n, max: n };
  }

  return null;
}

// Resolve an option's range from its value, falling back to its English then
// Hebrew label. Returns null when none of them parse.
function optionRange(o: RangeOption): ParsedRange | null {
  return (
    parseRangeToken(o.value) ??
    (o.labelEn ? parseRangeToken(o.labelEn) : null) ??
    (o.labelHe ? parseRangeToken(o.labelHe) : null)
  );
}

// Given the option list and a measured number, return the `value` of the one
// option whose range contains it. Returns null when nothing matches or more
// than one option matches (ambiguous -> caller should grade manually).
export function matchRangeOption(
  options: RangeOption[],
  n: number,
): string | null {
  if (!Number.isFinite(n)) return null;
  const hits = options.filter((o) => {
    const r = optionRange(o);
    return r !== null && n >= r.min && n <= r.max;
  });
  return hits.length === 1 ? hits[0].value : null;
}
