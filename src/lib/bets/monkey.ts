import "server-only";
import { execFirstRow, sql } from "@/db/helpers";
import {
  ALL_CUSTOM_SCOPES,
  listFillableCustomBets,
  listFillableMatches,
} from "@/lib/bets/fillable";
import { randomCustomAnswer, randomMatchScore } from "@/lib/random-picks";
import {
  writeCustomPicksBulk,
  writeMatchPick,
  type CustomPickInput,
  type WritePrincipal,
} from "@/lib/bets/write-core";

// The monkey bot's fill pass. Driven by /api/cron/monkey (GitHub Actions,
// hourly). Sweeps EVERY open bet the monkey has not picked yet and fills an
// odds-weighted random guess, through the `bot`-principal write-core so the
// deadline/status/never-overwrite invariants and DB idempotency all hold. Two
// concurrent cron runs (GitHub can overlap) are safe: the per-user advisory
// lock serialises the custom-bet batch and the match upsert is
// onConflictDoNothing. See _plans/2026-06-01-monkey-bot-and-random-fill.md.

export type MonkeyFillReport = {
  ok: boolean;
  reason?: "no_monkey";
  matchesFilled: number;
  matchesSkipped: number;
  customFilled: number;
  customSkipped: number;
};

// The monkey is the oldest profile flagged is_bot. We support at most one for
// now; a future persona roster (see plan, "deferred") would iterate instead.
export async function getMonkeyUserId(): Promise<string | null> {
  const row = await execFirstRow<{ id: string }>(sql`
    select id::text as "id"
    from public.profiles
    where is_bot = true
    order by created_at asc
    limit 1
  `);
  return row?.id ?? null;
}

export async function fillMonkeyPicks(): Promise<MonkeyFillReport> {
  const userId = await getMonkeyUserId();
  if (!userId) {
    return {
      ok: false,
      reason: "no_monkey",
      matchesFilled: 0,
      matchesSkipped: 0,
      customFilled: 0,
      customSkipped: 0,
    };
  }
  const principal: WritePrincipal = { kind: "bot", userId };

  // Match scores (1/X/2). One upsert each; onConflictDoNothing makes reruns
  // no-ops.
  let matchesFilled = 0;
  let matchesSkipped = 0;
  const matches = await listFillableMatches(userId);
  for (const m of matches) {
    const score = randomMatchScore();
    const res = await writeMatchPick(
      principal,
      { matchId: m.matchId, home: score.home, away: score.away },
      { overwrite: false },
    );
    if (res.status === "filled") matchesFilled++;
    else matchesSkipped++;
  }

  // Custom bets across every scope, in one advisory-locked batch.
  let customFilled = 0;
  let customSkipped = 0;
  const bets = await listFillableCustomBets(userId, ALL_CUSTOM_SCOPES);
  const items: CustomPickInput[] = [];
  for (const b of bets) {
    const answer = randomCustomAnswer(b.answerType, b.answerConfig);
    if (answer) items.push({ customBetId: b.id, answer });
    else customSkipped++; // free_text / unbounded number
  }
  const results = await writeCustomPicksBulk(principal, items, {
    overwrite: false,
  });
  for (const r of results) {
    if (r.status === "filled") customFilled++;
    else customSkipped++;
  }

  return {
    ok: true,
    matchesFilled,
    matchesSkipped,
    customFilled,
    customSkipped,
  };
}
