import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import type { Locale } from "@/app/[lang]/dictionaries";
import { getActiveDismissals } from "./dismiss";
import { rankAndPick } from "./score";
import { GENERATOR_TIMEOUT_MS, withTimeout } from "./timeout";
import type { Generator, Moment } from "./types";

import { unpickedMatchImminent } from "./generators/unpicked-match-imminent";
import { pendingDuelInvite } from "./generators/pending-duel-invite";
import { liveBetsOpenToday } from "./generators/live-bets-open-today";
import { duelOpportunity } from "./generators/duel-opportunity";
import { positionCatchup } from "./generators/position-catchup";

// Public entry point. Returns at most `limit` Moments tailored to the
// signed-in user, already filtered against their dismissals and
// diversity-ranked. The Smart Hub dashboard card calls this once per
// request inside its Suspense boundary. Returns `null` when the user
// has the Smart Hub disabled - the caller renders nothing in that
// case (instead of an empty card with a stale title).
//
// See _plans/2026-05-30-smart-reminders.md.

const GENERATORS: Generator[] = [
  unpickedMatchImminent,
  pendingDuelInvite,
  liveBetsOpenToday,
  duelOpportunity,
  positionCatchup,
];

export const DEFAULT_LIMIT = 4;

export type BuildResult = {
  moments: Moment[];
  // Used by tests / observability; not rendered.
  enabled: boolean;
  candidateCount: number;
};

export async function buildSmartHub({
  userId,
  locale,
  limit = DEFAULT_LIMIT,
  now = new Date(),
}: {
  userId: string;
  locale: Locale;
  limit?: number;
  now?: Date;
}): Promise<BuildResult> {
  // Per-user opt-out gate. Defaults to true via the column default in
  // migration 0036; an explicit false from the profile toggle short-
  // circuits the rest of the work.
  const [profile] = await db
    .select({ smartHubEnabled: profiles.smartHubEnabled })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);
  if (profile && !profile.smartHubEnabled) {
    return { moments: [], enabled: false, candidateCount: 0 };
  }

  // Fan out every generator + the dismissal read in parallel; the
  // dashboard is the most-glanced surface so trimming sequential
  // round-trips matters even at single-user scale. Each call is
  // wrapped in withTimeout so one slow generator (a DB plan
  // regression, a saturated PgBouncer pool) can never trap the whole
  // Hub in its skeleton state — the timed-out generator drops to its
  // fallback and the rest of the Hub paints normally.
  const ctx = { userId, locale, now };
  const [dismissals, ...settled] = await Promise.all([
    withTimeout(
      getActiveDismissals(userId),
      GENERATOR_TIMEOUT_MS,
      "dismissals",
      new Set<string>(),
    ),
    ...GENERATORS.map((gen) =>
      withTimeout(gen(ctx), GENERATOR_TIMEOUT_MS, gen.name, null),
    ),
  ] as const);

  const raw = settled.filter((m): m is Moment => m !== null);
  const survivors = raw.filter((m) => !dismissals.has(m.key));
  const picked = rankAndPick(survivors, limit);

  console.info("[smart-hub build]", {
    userId,
    candidates: raw.length,
    afterDismiss: survivors.length,
    picked: picked.length,
    pickedKeys: picked.map((m) => m.key),
  });

  return {
    moments: picked,
    enabled: true,
    candidateCount: raw.length,
  };
}
