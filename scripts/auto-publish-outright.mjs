#!/usr/bin/env node
// End-to-end "make every outright bet work" tool:
//
//   1. For each surface in outright_odds_snapshot, find (or create)
//      the matching open custom_bet.
//   2. Compute payoutOverridesByValue with the correct key convention:
//        - team surfaces (champion/runner_up/third/group_*) keyed by
//          team.code (3-letter ISO), translated from snapshot's
//          api_football_team_id.
//        - player surfaces (top_scorer/golden_ball) keyed by
//          api_football_id as string.
//   3. Apply to custom_bets.answer_config in a single UPDATE.
//   4. For unmatched options (long tail), fall back to
//      settings.live_odds_max_payout (default 25) per the plan.
//   5. For groups (group_A..L) where no bet exists, INSERT a new
//      scope='group' draft bet with the four teams as options.
//   6. Audit + report.
//
// Idempotent: re-running is safe. Bets that already have correct
// overrides just get a "no-op" report.
//
// Usage:
//   node --env-file=.env.local scripts/auto-publish-outright.mjs

import postgres from "postgres";

const url = process.env.DIRECT_URL;
if (!url) {
  console.error("DIRECT_URL is not set.");
  process.exit(1);
}

const sql = postgres(url, { prepare: false });

// Outright (tournament/stage/group) payout scale. Mirrors the
// OUTRIGHT_* constants in src/lib/bets/free-pick-scopes.ts. The
// numbers are intentionally NOT read from settings.live_odds_* because
// outright markets are free picks on a tighter scale than live bets;
// reading live-odds settings would re-introduce the 43/60-point
// payouts the new system fixed. See
// _plans/2026-05-31-free-tournament-bets-and-rescaled-payouts.md.
//
// `baseStake` here is the NOTIONAL stake used only in the odds math.
// Custom bets in these scopes charge 0 at submit time regardless.
const oddsConfig = { baseStake: 1, maxPayout: 25, houseEdgePct: 5 };

const SURFACE_TO_QUESTION_PATTERN = {
  champion: /מי תזכה במונדיאל/,
  runner_up: /מי תהיה סגנית/,
  third: /מי תזכה במקום השלישי/,
  top_scorer: /מלך השערים/,
  golden_ball: /כדור הזהב/,
};

const GROUP_SURFACES = ["group_A","group_B","group_C","group_D","group_E","group_F","group_G","group_H","group_I","group_J","group_K","group_L"];

try {
  // ---------- teams lookup (api_football_team_id → code) ----------
  const teamRows = await sql`
    select code, name_en, name_he, flag, group_id, api_football_team_id
    from teams
  `;
  const teamByApiId = new Map();
  const teamsByGroup = new Map();
  for (const t of teamRows) {
    if (t.api_football_team_id != null) teamByApiId.set(Number(t.api_football_team_id), t);
    if (t.group_id) {
      if (!teamsByGroup.has(t.group_id)) teamsByGroup.set(t.group_id, []);
      teamsByGroup.get(t.group_id).push(t);
    }
  }

  // ---------- normalize odds → payout (mirrors src/lib/odds-normalize.ts) ----------
  function normalizePayout(decimalOdds) {
    const stake = Math.max(1, Math.floor(oddsConfig.baseStake));
    const safeOdds = decimalOdds > 1 ? decimalOdds : 1.01;
    const houseFactor = (100 - Math.max(0, Math.min(50, oddsConfig.houseEdgePct))) / 100;
    let payout = Math.floor(stake * safeOdds * houseFactor + 0.5);
    const cap = Math.max(stake + 1, Math.floor(oddsConfig.maxPayout));
    if (payout > cap) payout = cap;
    if (payout < stake + 1) payout = stake + 1;
    return payout;
  }

  // ---------- iterate every surface ----------
  const summary = {};

  // 1) Player surfaces — top_scorer, golden_ball.
  for (const surface of ["top_scorer", "golden_ball"]) {
    const snapshot = await sql`
      select option_id, decimal_odds
      from outright_odds_snapshot
      where surface = ${surface} and option_kind = 'player'
    `;
    const overrides = {};
    for (const row of snapshot) {
      overrides[String(row.option_id)] = normalizePayout(Number(row.decimal_odds));
    }
    const result = await applyOverridesToBet({
      pattern: SURFACE_TO_QUESTION_PATTERN[surface],
      overrides,
      surface,
      keepDynamic: true,
    });
    summary[surface] = result;
  }

  // 2) Tournament-wide team surfaces — champion, runner_up, third.
  for (const surface of ["champion", "runner_up", "third"]) {
    const snapshot = await sql`
      select option_id, decimal_odds
      from outright_odds_snapshot
      where surface = ${surface} and option_kind = 'team'
    `;
    const overrides = {};
    for (const row of snapshot) {
      const team = teamByApiId.get(Number(row.option_id));
      if (!team) continue;
      overrides[team.code] = normalizePayout(Number(row.decimal_odds));
    }
    const result = await applyOverridesToBet({
      pattern: SURFACE_TO_QUESTION_PATTERN[surface],
      overrides,
      surface,
      keepDynamic: false,
    });
    summary[surface] = result;
  }

  // 3) Group bets — create if missing, then publish.
  for (const surface of GROUP_SURFACES) {
    const groupLetter = surface.slice("group_".length);
    const groupTeams = teamsByGroup.get(groupLetter);
    if (!groupTeams || groupTeams.length !== 4) {
      summary[surface] = { error: `expected 4 teams in group ${groupLetter}, got ${groupTeams?.length ?? 0}` };
      continue;
    }
    const snapshot = await sql`
      select option_id, decimal_odds
      from outright_odds_snapshot
      where surface = ${surface} and option_kind = 'team'
    `;
    const oddsByCode = new Map();
    for (const row of snapshot) {
      const team = teamByApiId.get(Number(row.option_id));
      if (team) oddsByCode.set(team.code, Number(row.decimal_odds));
    }
    const overrides = {};
    const options = [];
    for (const t of groupTeams.sort((a,b) => a.code.localeCompare(b.code))) {
      const dec = oddsByCode.get(t.code) ?? null;
      const payout = dec != null ? normalizePayout(dec) : oddsConfig.maxPayout;
      overrides[t.code] = payout;
      options.push({
        value: t.code,
        labelHe: t.name_he,
        labelEn: t.name_en,
        icon: t.flag,
        payoutOverride: payout,
      });
    }
    const result = await upsertGroupBet({
      groupLetter,
      options,
      overrides,
    });
    summary[surface] = result;
  }

  console.info("\n=== SUMMARY ===");
  console.table(summary);
} finally {
  await sql.end({ timeout: 5 });
}

// ---------- helpers ----------

async function applyOverridesToBet({ pattern, overrides, surface, keepDynamic }) {
  const bets = await sql`
    select id, question_he, answer_config
    from custom_bets
    where answer_type = 'multi_choice'
    and question_he ~ ${pattern.source}
    and status in ('open','locked','draft')
    order by created_at desc
    limit 1
  `;
  if (bets.length === 0) {
    return { error: `no bet found matching /${pattern.source}/` };
  }
  const bet = bets[0];
  const cfg = bet.answer_config ?? {};
  const isDynamic = cfg.dynamicSource != null;
  let updatedOptions = cfg.options;
  if (!isDynamic && Array.isArray(updatedOptions)) {
    updatedOptions = updatedOptions.map((o) => {
      const payout = overrides[o.value] ?? oddsConfig.maxPayout;
      return { ...o, payoutOverride: payout };
    });
  }
  // Always rebuild payoutOverridesByValue from snapshot — dynamic
  // surfaces store ONLY the priced players, static surfaces also
  // record the longshot defaults for completeness.
  const newConfig = {
    ...cfg,
    options: updatedOptions ?? [],
    payoutOverridesByValue: overrides,
  };
  // For dynamic-source bets (top_scorer / golden_ball), set the
  // bet-level payoutSnapshot to the longshot cap (25) so a pick on
  // a player NOT in payoutOverridesByValue falls back to the
  // longshot default — same as what publishSurfaceToBet writes for
  // unmatched static options. Static surfaces always populate every
  // option in the map, so the fallback is never hit there.
  if (isDynamic) {
    await sql`
      update custom_bets
      set answer_config = ${sql.json(newConfig)},
          payout_snapshot = ${oddsConfig.maxPayout}
      where id = ${bet.id}
    `;
  } else {
    await sql`
      update custom_bets
      set answer_config = ${sql.json(newConfig)}
      where id = ${bet.id}
    `;
  }
  return {
    bet_id: bet.id,
    priced: Object.keys(overrides).length,
    options_on_bet: Array.isArray(updatedOptions) ? updatedOptions.length : "dynamic",
  };
}

async function upsertGroupBet({ groupLetter, options, overrides }) {
  const existing = await sql`
    select id, answer_config
    from custom_bets
    where scope = 'group' and group_id = ${groupLetter}
    and answer_type = 'multi_choice'
    and status in ('open','locked','draft')
    order by created_at desc
    limit 1
  `;
  const cfg = {
    kind: "multi_choice",
    options,
    payoutOverridesByValue: overrides,
  };
  if (existing.length > 0) {
    const bet = existing[0];
    await sql`
      update custom_bets
      set answer_config = ${sql.json(cfg)},
          status = 'open'
      where id = ${bet.id}
    `;
    return { bet_id: bet.id, action: "updated", priced: Object.keys(overrides).length };
  }
  // Compute lock_at = 60 min before first kickoff of this group's
  // first match. Falls back to 2026-06-11 18:00 UTC if no match exists.
  const firstKickoff = await sql`
    select min(kickoff_at) as ko
    from matches
    where group_id = ${groupLetter}
  `;
  const lockAt = firstKickoff[0]?.ko
    ? new Date(new Date(firstKickoff[0].ko).getTime() - 60 * 60_000)
    : new Date("2026-06-11T17:00:00Z");
  // Free-pick scope: charge nothing at submit. Bet-level fallback
  // mirrors the longshot default (cap = 25) so an unmatched-team
  // pick still pays the longshot premium.
  const stakeSnapshot = 0;
  const fallbackPayout = oddsConfig.maxPayout;
  const questionHe = `מי תנצח בקבוצה ${groupLetter}?`;
  const questionEn = `Who wins Group ${groupLetter}?`;
  const ruleHe = `הקבוצה שתסיים במקום הראשון של קבוצה ${groupLetter} בתום שלב הבתים.`;
  const ruleEn = `The team that finishes first in Group ${groupLetter} after the group stage.`;
  const [admin] = await sql`select id from profiles where role = 'admin' limit 1`;
  const ins = await sql`
    insert into custom_bets
      (scope, group_id, question_he, question_en, grading_rule_he, grading_rule_en,
       answer_type, answer_config, stake_snapshot, payout_snapshot,
       grading_source, grading_config, status, lock_at, published_at, created_by)
    values
      ('group', ${groupLetter}, ${questionHe}, ${questionEn}, ${ruleHe}, ${ruleEn},
       'multi_choice', ${sql.json(cfg)}, ${stakeSnapshot}, ${fallbackPayout},
       'manual', null, 'open', ${lockAt.toISOString()}, now(), ${admin?.id ?? null})
    returning id
  `;
  return { bet_id: ins[0].id, action: "created", priced: Object.keys(overrides).length };
}
