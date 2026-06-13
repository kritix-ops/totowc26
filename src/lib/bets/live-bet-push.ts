// Pure text builder for the live-bet push notification. Kept free of DB
// and server-only imports so the admin composer (live preview) and the
// server action share one source of truth for the wording, and so it is
// unit-testable.
//
// The push answers the admin's request: "match name + how many live bets
// went up". One entry per selected bet is passed in; the builder groups
// by anchor (a match or a matchday), counts per group, and produces a
// title (total summary) plus a body that lists each anchor with its count.

export type LiveBetPushAnchor = {
  // Stable grouping key — the match id or the matchday date. Bets that
  // share a key are counted together.
  key: string;
  // Human label for the anchor: a matchup ("ברזיל נגד גרמניה") or a day
  // ("יום 13.6"). Already localized by the caller.
  label: string;
};

export type LiveBetPushText = { title: string; body: string };

// Minimal shape needed to derive an anchor from a live bet, with the
// team names already resolved to the target locale by the caller. Kept
// here (not coupled to the DB row type) so both the server action and
// the client preview build identical anchors from one code path.
export type LiveBetAnchorRow = {
  scope: "match" | "day";
  matchId: string | null;
  homeName: string | null;
  awayName: string | null;
  matchdayDate: string | null;
};

// Format a YYYY-MM-DD calendar date as "D.M". String math only — building
// a Date would risk shifting the day across the Asia/Jerusalem boundary,
// and a matchday anchor is a pure calendar date with no instant.
export function formatDayLabel(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return isoDate;
  return `${Number(m[3])}.${Number(m[2])}`;
}

// Derive the grouping key + display label for a live bet's anchor. Match
// bets group by fixture and read "{home} נגד {away}"; day bets group by
// date and read "יום {D.M}". Falls back to a generic label when the join
// data is missing so a push never renders a blank anchor.
export function liveBetAnchor(
  row: LiveBetAnchorRow,
  locale: "he" | "en",
): LiveBetPushAnchor {
  const isHebrew = locale === "he";
  if (row.scope === "match" && row.matchId) {
    const home = row.homeName ?? "";
    const away = row.awayName ?? "";
    const label =
      home && away
        ? isHebrew
          ? `${home} נגד ${away}`
          : `${home} vs ${away}`
        : isHebrew
          ? "משחק"
          : "Match";
    return { key: `m:${row.matchId}`, label };
  }
  const day = row.matchdayDate ? formatDayLabel(row.matchdayDate) : "";
  const label = day
    ? isHebrew
      ? `יום ${day}`
      : `Matchday ${day}`
    : isHebrew
      ? "יום משחקים"
      : "Matchday";
  return { key: `d:${row.matchdayDate ?? "day"}`, label };
}

// Build the push title + body from one anchor entry per selected bet.
// Returns null when nothing is selected so the caller can disable send.
// Grouping preserves first-seen order so the body reads in the order the
// admin sees the list.
export function buildLiveBetPushText(
  anchors: LiveBetPushAnchor[],
  locale: "he" | "en",
): LiveBetPushText | null {
  if (anchors.length === 0) return null;
  const isHebrew = locale === "he";

  // Group by key, keeping insertion order and a count per group.
  const order: string[] = [];
  const byKey = new Map<string, { label: string; count: number }>();
  for (const a of anchors) {
    const existing = byKey.get(a.key);
    if (existing) {
      existing.count += 1;
    } else {
      byKey.set(a.key, { label: a.label, count: 1 });
      order.push(a.key);
    }
  }

  const total = anchors.length;
  const title = isHebrew
    ? total === 1
      ? "הימור לייב חדש"
      : `${total} הימורי לייב חדשים`
    : total === 1
      ? "New live bet"
      : `${total} new live bets`;

  const groups = order.map((k) => byKey.get(k)!);
  // Single anchor: the count already lives in the title, so the body is
  // just the match / day name. Multiple anchors: one line each with its
  // own count so the player sees the split.
  const body =
    groups.length === 1
      ? groups[0].label
      : groups
          .map((g) => `${g.label} — ${g.count}`)
          .join("\n");

  return { title, body };
}
