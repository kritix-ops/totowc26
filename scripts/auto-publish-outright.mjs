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
//   4. For unmatched options (long tail), fall back to the curve
//      ceiling (100 for players/teams, 50 for groups) — the deepest
//      longshots pay the max.
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

// Continuous log-odds payout curve. Mirrors buildOutrightCurve in
// src/lib/odds-normalize.ts and the OUTRIGHT_* curve constants in
// src/lib/bets/free-pick-scopes.ts (source of truth — keep in sync). The
// favourite of a surface earns the floor, the longest priced shot earns the
// ceiling, interpolated on ln(odds). Player + champion/runner-up/third
// surfaces span 35→100; group winners span 20→50 normalised within each
// group. Free picks: stake is always 0 at submit. See
// _plans/2026-06-01-tournament-payout-curve.md and
// _plans/2026-07-16-raise-tournament-bet-floor-to-35.md.
const PLAYER_FLOOR = 35;
const GROUP_FLOOR = 20;
const PLAYER_CEILING = 100;
const GROUP_CEILING = 50;

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

  // ---------- odds → payout curve (mirrors buildOutrightCurve) ----------
  // Build one curve per surface from its full set of priced odds so the
  // favourite lands on the floor and the longest shot on the ceiling.
  function buildCurve(allDecimalOdds, floor, ceiling) {
    const valid = allDecimalOdds.filter((o) => Number.isFinite(o) && o > 1);
    const minOdds = valid.length > 0 ? Math.min(...valid) : 0;
    const maxOdds = valid.length > 0 ? Math.max(...valid) : 0;
    const lnMin = Math.log(minOdds);
    const lnSpan = Math.log(maxOdds) - lnMin;
    return (decimalOdds) => {
      // `!(lnSpan > 0)` catches NaN (empty odds → log(0)), 0 (single
      // distinct odds) and negatives; sub-1 odds collapse to the floor.
      if (!(lnSpan > 0) || !Number.isFinite(decimalOdds) || decimalOdds <= 1) {
        return floor;
      }
      const t = (Math.log(decimalOdds) - lnMin) / lnSpan;
      const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
      return Math.round(floor + (ceiling - floor) * clamped);
    };
  }

  // ---------- iterate every surface ----------
  const summary = {};

  // 1) Player surfaces — top_scorer, golden_ball. Curve 35→100; unpriced
  //    players fall back to the ceiling via the bet-level payout_snapshot.
  for (const surface of ["top_scorer", "golden_ball"]) {
    const snapshot = await sql`
      select option_id, decimal_odds
      from outright_odds_snapshot
      where surface = ${surface} and option_kind = 'player'
    `;
    const curve = buildCurve(
      snapshot.map((r) => Number(r.decimal_odds)),
      PLAYER_FLOOR,
      PLAYER_CEILING,
    );
    const overrides = {};
    for (const row of snapshot) {
      overrides[String(row.option_id)] = curve(Number(row.decimal_odds));
    }
    const result = await applyOverridesToBet({
      pattern: SURFACE_TO_QUESTION_PATTERN[surface],
      overrides,
      surface,
      keepDynamic: true,
      fallbackPayout: PLAYER_CEILING,
    });
    summary[surface] = result;
  }

  // 2) Tournament-wide team surfaces — champion, runner_up, third.
  //    Same 35→100 curve as the player surfaces, for consistency.
  for (const surface of ["champion", "runner_up", "third"]) {
    const snapshot = await sql`
      select option_id, decimal_odds
      from outright_odds_snapshot
      where surface = ${surface} and option_kind = 'team'
    `;
    const curve = buildCurve(
      snapshot.map((r) => Number(r.decimal_odds)),
      PLAYER_FLOOR,
      PLAYER_CEILING,
    );
    const overrides = {};
    for (const row of snapshot) {
      const team = teamByApiId.get(Number(row.option_id));
      if (!team) continue;
      overrides[team.code] = curve(Number(row.decimal_odds));
    }
    const result = await applyOverridesToBet({
      pattern: SURFACE_TO_QUESTION_PATTERN[surface],
      overrides,
      surface,
      keepDynamic: false,
      fallbackPayout: PLAYER_CEILING,
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
    // Per-team payout by odds WITHIN the group: the group favourite earns
    // the group floor (20), the longest shot in that group earns the
    // ceiling (50), interpolated on the log-odds curve. The curve is built
    // from this group's four odds only, so it normalises per group — every
    // group's favourite is 20 and its longest shot is 50, ranked by odds
    // in between. Group surfaces keep the 20 floor (unlike tournament
    // surfaces, now 35). Reverses the prior flat per-group payout. See
    // _plans/2026-06-01-tournament-payout-curve.md.
    const curve = buildCurve(
      groupTeams.map((t) => oddsByCode.get(t.code)).filter((d) => d != null),
      GROUP_FLOOR,
      GROUP_CEILING,
    );

    const overrides = {};
    const options = [];
    for (const t of groupTeams.sort((a,b) => a.code.localeCompare(b.code))) {
      const dec = oddsByCode.get(t.code) ?? null;
      const payout = dec != null ? curve(dec) : GROUP_CEILING;
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
      fallbackPayout: GROUP_CEILING,
    });
    summary[surface] = result;
  }

  console.info("\n=== SUMMARY ===");
  console.table(summary);
} finally {
  await sql.end({ timeout: 5 });
}

// ---------- helpers ----------

async function applyOverridesToBet({ pattern, overrides, surface, keepDynamic, fallbackPayout }) {
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
      const payout = overrides[o.value] ?? fallbackPayout;
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
  // Bet-level payout_snapshot = the curve ceiling for every outright
  // surface. For dynamic bets (top_scorer / golden_ball) it is the
  // genuine fallback an unpriced long-tail player resolves to. For static
  // bets every option carries its own payoutOverride so the fallback never
  // fires, but the card headline ("זכייה") reads this value — the ceiling
  // makes it an honest "up to X" rather than a stale flat number.
  await sql`
    update custom_bets
    set answer_config   = ${sql.json(newConfig)},
        payout_snapshot = ${fallbackPayout}
    where id = ${bet.id}
  `;
  return {
    bet_id: bet.id,
    priced: Object.keys(overrides).length,
    options_on_bet: Array.isArray(updatedOptions) ? updatedOptions.length : "dynamic",
  };
}

async function upsertGroupBet({ groupLetter, options, overrides, fallbackPayout }) {
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
    // payout_snapshot is only a fallback for a pick not in the map; all
    // four teams are enumerated with their own payoutOverride, so it
    // never fires. Set it to the group ceiling as a safe default.
    await sql`
      update custom_bets
      set answer_config   = ${sql.json(cfg)},
          stake_snapshot  = 0,
          payout_snapshot = ${fallbackPayout},
          status          = 'open'
      where id = ${bet.id}
    `;
    return { bet_id: bet.id, action: "updated", priced: Object.keys(overrides).length, fallbackPayout };
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
  // Free-pick scope: charge nothing at submit. Bet-level payout is only
  // the fallback for a pick not in the map (never fires — all four teams
  // are enumerated with their own payoutOverride).
  const stakeSnapshot = 0;
  const questionHe = `מי תנצח בקבוצה ${groupLetter}?`;
  const questionEn = `Who wins Group ${groupLetter}?`;
  const ruleHe = `הקבוצה שתסיים במקום הראשון של קבוצה ${groupLetter} בתום שלב הבתים.`;
  const ruleEn = `The team that finishes first in Group ${groupLetter} after the group stage.`;
  const [admin] = await sql`select id from profiles where role = 'admin' limit 1`;
  // Group winners auto-grade from final match scores via resolveGroupScope
  // in src/lib/sync.ts. The resolver recognises this exact grading_config
  // shape; do not change the source/field strings without updating both
  // sides. Backfill of pre-existing manual rows lives in migration 0040.
  const gradingCfg = { source: "football_data", field: "group_winner" };
  const ins = await sql`
    insert into custom_bets
      (scope, group_id, question_he, question_en, grading_rule_he, grading_rule_en,
       answer_type, answer_config, stake_snapshot, payout_snapshot,
       grading_source, grading_config, status, lock_at, published_at, created_by)
    values
      ('group', ${groupLetter}, ${questionHe}, ${questionEn}, ${ruleHe}, ${ruleEn},
       'multi_choice', ${sql.json(cfg)}, ${stakeSnapshot}, ${fallbackPayout},
       'auto_football_data', ${sql.json(gradingCfg)}, 'open', ${lockAt.toISOString()}, now(), ${admin?.id ?? null})
    returning id
  `;
  return { bet_id: ins[0].id, action: "created", priced: Object.keys(overrides).length };
}
