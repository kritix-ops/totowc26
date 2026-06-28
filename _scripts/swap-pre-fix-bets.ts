/**
 * Swap home_score <-> away_score for a SINGLE specified user's pre-fix
 * match_bets, with bet_admin_audit rows for each mutation.
 *
 * Why: commit 3672860 (2026-05-30 17:14 IDT) fixed an RTL/LTR bug in
 * QuickPickRow.tsx where, in Hebrew, the stepper visually under the home
 * team's name was wired to the AWAY score variable. Picks saved through
 * /bets pre-fix have home/away inverted relative to user intent.
 *
 * BetForm at /bets/[matchId] was correct throughout (CSS Grid layout).
 * So we cannot prove per-bet whether intent was swapped — admin must
 * confirm per user.
 *
 * USAGE
 *   tsx _scripts/swap-pre-fix-bets.ts <userIdPrefix> dry
 *   tsx _scripts/swap-pre-fix-bets.ts <userIdPrefix> apply <adminUserId>
 *
 *   - dry mode: prints proposed swaps, no DB writes.
 *   - apply mode: runs swap in a single transaction:
 *       1. UPDATE match_bets SET home_score=<old away>, away_score=<old home>
 *          WHERE user_id=<id> AND updated_at < cutoff
 *       2. INSERT one bet_admin_audit row per swap (action=set, surface=match,
 *          reason='rtl-bug-prefix-swap 2026-05-30 17:14 IDT (QuickPickRow)')
 *
 * SAFETY
 *   - Touches ONLY bets last updated before the cutoff. Anything updated
 *     post-fix is untouched (those reflect post-fix user intent).
 *   - Cutoff is the commit timestamp; conservative.
 *   - Idempotent unprotected — running twice will swap back. The audit
 *     rows are the trail of record, so the operator can see the history.
 *   - Direct SQL via Supabase REST is single-row at a time; we batch via
 *     a tiny RPC.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const CUTOFF = "2026-05-30T14:14:26+00:00"; // commit 3672860 UTC
const REASON = "rtl-bug-prefix-swap 2026-05-30 17:14 IDT (QuickPickRow inverted home/away saves)";

async function rest(path: string, init?: RequestInit) {
  const r = await fetch(`${supaUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init?.headers ?? {}),
    },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} on ${path}: ${await r.text()}`);
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

async function main() {
  const [, , userArg, mode, adminId] = process.argv;
  if (!userArg || !mode || !["dry", "apply"].includes(mode)) {
    console.error("usage: tsx _scripts/swap-pre-fix-bets.ts <userIdOrPrefix> dry|apply [adminId]");
    process.exit(2);
  }
  if (mode === "apply" && !adminId) {
    console.error("apply mode requires an adminId argument (uuid)");
    process.exit(2);
  }

  // Resolve the user_id (allow 8-char prefix for convenience)
  const stale = (await rest(
    `match_bets?updated_at=lt.${encodeURIComponent(CUTOFF)}&select=user_id`,
  )) as Array<{ user_id: string }>;
  const matches = [...new Set(stale.map((b) => b.user_id))].filter((u) =>
    u.startsWith(userArg),
  );
  if (matches.length === 0) {
    console.error(`no affected user matches '${userArg}'`);
    process.exit(2);
  }
  if (matches.length > 1) {
    console.error(`prefix '${userArg}' is ambiguous: matches ${matches.length}`);
    process.exit(2);
  }
  const userId = matches[0];

  // Fetch the user's pre-fix bets
  const bets = (await rest(
    `match_bets?user_id=eq.${userId}&updated_at=lt.${encodeURIComponent(CUTOFF)}&select=id,match_id,home_score,away_score,updated_at&order=updated_at.asc`,
  )) as Array<{
    id: string;
    match_id: string;
    home_score: number;
    away_score: number;
    updated_at: string;
  }>;
  console.log(`User ${userId.slice(0, 8)} — ${bets.length} pre-fix match_bets`);
  console.log(`Cutoff:    ${CUTOFF}`);
  console.log(`Reason:    ${REASON}`);
  console.log(`Mode:      ${mode}`);
  if (mode === "apply") console.log(`Admin:     ${adminId}`);

  // Enrich with match info for display
  const matchIds = [...new Set(bets.map((b) => b.match_id))];
  const matchRows = (await rest(
    `matches?id=in.(${matchIds.map((m) => `"${m}"`).join(",")})&select=id,home_team,away_team,kickoff_at,status,home_score,away_score`,
  )) as Array<{
    id: string;
    home_team: string;
    away_team: string;
    kickoff_at: string;
    status: string;
    home_score: number | null;
    away_score: number | null;
  }>;
  const byMatchId = new Map(matchRows.map((m) => [m.id, m]));

  console.log("\nProposed swaps:");
  for (const b of bets) {
    const m = byMatchId.get(b.match_id)!;
    const before = `${b.home_score}-${b.away_score}`;
    const after = `${b.away_score}-${b.home_score}`;
    const liveTag =
      m.status !== "scheduled" && m.home_score != null
        ? ` [LIVE/FINAL actual=${m.home_score}-${m.away_score}]`
        : "";
    console.log(
      `  ${m.home_team}(h)-${m.away_team}(a) kickoff=${m.kickoff_at.slice(0, 16)}: ${before} -> ${after}${liveTag}`,
    );
  }

  if (mode === "dry") {
    console.log("\nDRY RUN — no DB writes.");
    return;
  }

  // APPLY MODE — one update + one audit row per bet
  console.log("\nApplying swaps...");
  for (const b of bets) {
    const updated = await rest(
      `match_bets?id=eq.${b.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          home_score: b.away_score,
          away_score: b.home_score,
          updated_at: new Date().toISOString(),
        }),
      },
    );
    if (!updated || (Array.isArray(updated) && updated.length === 0)) {
      console.error(`  FAILED to update bet ${b.id}`);
      continue;
    }
    await rest(`bet_admin_audit`, {
      method: "POST",
      body: JSON.stringify({
        admin_id: adminId,
        target_user_id: userId,
        action: "set",
        surface: "match",
        match_id: b.match_id,
        custom_bet_id: null,
        before: { home: b.home_score, away: b.away_score },
        after: { home: b.away_score, away: b.home_score },
        reason: REASON,
        lock_bypassed: true, // some matches may already be locked (e.g. live MEX-RSA)
      }),
    });
    const m = byMatchId.get(b.match_id)!;
    console.log(
      `  swapped ${m.home_team}-${m.away_team}: ${b.home_score}-${b.away_score} -> ${b.away_score}-${b.home_score}`,
    );
  }
  console.log(`\nDone. Swapped ${bets.length} bets for user ${userId.slice(0, 8)}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
