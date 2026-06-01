"use server";

import { revalidatePath, updateTag } from "next/cache";
import { getUser } from "@/lib/supabase/auth";
import { getUserAccess } from "@/lib/access";
import { bankCacheTag } from "@/lib/bank";
import {
  ALL_CUSTOM_SCOPES,
  SURFACE_SCOPES,
  listFillableCustomBets,
  listFillableLiveBetsForDate,
  listFillableMatches,
  type FillableCustomBet,
} from "@/lib/bets/fillable";
import { randomCustomAnswer, randomMatchScore } from "@/lib/random-picks";
import {
  writeCustomPicksBulk,
  writeMatchPick,
  type WritePrincipal,
} from "@/lib/bets/write-core";

// Server action behind the per-user "Surprise me" button. Fills the caller's
// OPEN, UNFILLED bets on one surface with odds-weighted random picks, never
// overwriting a pick they already made. Every write goes through the shared
// `self`-principal write-core, so the normal gates (access, deadline, status,
// bank) all still apply — unaffordable or already-locked bets are skipped, not
// forced. See _plans/2026-06-01-monkey-bot-and-random-fill.md §Phase 3.

// Which surface the button lives on. "live" is per-date; the rest fill every
// open bet of their scope.
export type FillTarget =
  | { surface: "matches" }
  | { surface: "tournament" }
  | { surface: "groups" }
  | { surface: "live"; date: string };

export type FillRandomResult =
  | { ok: true; filled: number; skipped: number }
  | { ok: false; error: "unauth" | "not_paid" | "db" };

export async function fillRandomPicks(
  target: FillTarget,
): Promise<FillRandomResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauth" };
  const access = await getUserAccess(user.id);
  if (!access.canEdit) return { ok: false, error: "not_paid" };
  const principal: WritePrincipal = { kind: "self", userId: user.id, access };

  try {
    let filled = 0;
    let skipped = 0;

    if (target.surface === "matches") {
      const matches = await listFillableMatches(user.id);
      for (const m of matches) {
        const score = randomMatchScore();
        const res = await writeMatchPick(
          principal,
          { matchId: m.matchId, home: score.home, away: score.away },
          { overwrite: false },
        );
        if (res.status === "filled") filled++;
        else skipped++;
      }
    } else {
      const bets = await loadCustomBets(user.id, target);
      // Build pick answers, dropping bets the generator can't sensibly fill
      // (free_text, unbounded number) — counted as skipped.
      const items: Array<{ customBetId: string; answer: NonNullable<ReturnType<typeof randomCustomAnswer>> }> = [];
      for (const b of bets) {
        const answer = randomCustomAnswer(b.answerType, b.answerConfig);
        if (answer) items.push({ customBetId: b.id, answer });
        else skipped++;
      }
      const results = await writeCustomPicksBulk(principal, items, {
        overwrite: false,
      });
      for (const r of results) {
        if (r.status === "filled") filled++;
        else skipped++;
      }
    }

    // Refresh the caller's bank pill + the bet surfaces. The client also calls
    // router.refresh() so the new picks paint immediately.
    updateTag(bankCacheTag(user.id));
    revalidatePath("/[lang]/bets", "layout");
    revalidatePath("/[lang]/play", "layout");

    return { ok: true, filled, skipped };
  } catch (err) {
    console.error("[fill-random] failed", err);
    return { ok: false, error: "db" };
  }
}

async function loadCustomBets(
  userId: string,
  target: Exclude<FillTarget, { surface: "matches" }>,
): Promise<FillableCustomBet[]> {
  if (target.surface === "live") {
    return listFillableLiveBetsForDate(userId, target.date);
  }
  if (target.surface === "tournament") {
    return listFillableCustomBets(userId, SURFACE_SCOPES.tournament);
  }
  if (target.surface === "groups") {
    return listFillableCustomBets(userId, SURFACE_SCOPES.groups);
  }
  // Defensive: should be unreachable given the union above.
  return listFillableCustomBets(userId, ALL_CUSTOM_SCOPES);
}
