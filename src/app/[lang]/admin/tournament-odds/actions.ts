"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  customBets,
  outrightOddsSnapshot,
  teams as teamsTable,
  type OutrightSurface,
} from "@/db/schema";
import { getUser } from "@/lib/supabase/auth";
import { isAdmin } from "@/lib/admin";
import { buildOutrightCurve } from "@/lib/odds-normalize";
import {
  OUTRIGHT_CURVE_FLOOR,
  outrightCurveCeiling,
} from "@/lib/bets/free-pick-scopes";
import type {
  AnswerConfig,
  MultiChoiceConfig,
  MultiChoiceOption,
} from "@/lib/bets/types";

// Server actions for the /admin/tournament-odds editor. Three flows:
//
//   1. updateRowDecimalOdds     - admin tweaks one row's decimal_odds
//                                 (and optionally flips admin_override).
//   2. toggleRowAdminOverride   - admin pins/unpins the Re-fetch lock on
//                                 one row.
//   3. publishSurfaceToBet      - copy the current snapshot into the
//                                 target custom_bets.answer_config and
//                                 bake per-option payoutOverride values
//                                 onto every option, using normalizeOdds
//                                 + the configured settings knobs.
//
// All three require admin. Read-side is exposed via the page itself,
// not a separate action, because the admin lands on the page already.

type ActionResult<T = void> =
  | (T extends void ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string };

async function requireAdmin(): Promise<
  | { ok: true; userId: string }
  | { ok: false; error: "unauth" | "forbidden" }
> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauth" };
  const admin = await isAdmin(user.id);
  if (!admin) return { ok: false, error: "forbidden" };
  return { ok: true, userId: user.id };
}

// Update one snapshot row's decimal_odds. Optional adminOverride flag
// flips on the Re-fetch lock simultaneously (admin's edit is typically
// also an intent to hold the value, so the editor calls this with
// adminOverride=true; the toggle endpoint is for the explicit case).
export async function updateRowDecimalOdds(input: {
  rowId: string;
  decimalOdds: number;
  adminOverride?: boolean;
}): Promise<ActionResult> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  if (
    !Number.isFinite(input.decimalOdds) ||
    input.decimalOdds <= 1.0 ||
    input.decimalOdds > 1000.0
  ) {
    return { ok: false, error: "invalid_decimal_odds" };
  }

  try {
    const adminOverride = input.adminOverride ?? true;
    await db
      .update(outrightOddsSnapshot)
      .set({
        decimalOdds: input.decimalOdds.toFixed(3),
        adminOverride,
      })
      .where(eq(outrightOddsSnapshot.id, input.rowId));
    console.info("[tournament-odds row update]", {
      rowId: input.rowId,
      decimalOdds: input.decimalOdds,
      adminOverride,
    });
    revalidatePath("/[lang]/admin/tournament-odds", "page");
    return { ok: true };
  } catch (err) {
    console.error("[tournament-odds row update] failed", err);
    return { ok: false, error: "db" };
  }
}

// Flip admin_override without touching decimal_odds. Useful when admin
// wants to unfreeze a row so the next Re-fetch overwrites it again.
export async function toggleRowAdminOverride(input: {
  rowId: string;
  adminOverride: boolean;
}): Promise<ActionResult> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  try {
    await db
      .update(outrightOddsSnapshot)
      .set({ adminOverride: input.adminOverride })
      .where(eq(outrightOddsSnapshot.id, input.rowId));
    console.info("[tournament-odds override toggle]", {
      rowId: input.rowId,
      adminOverride: input.adminOverride,
    });
    revalidatePath("/[lang]/admin/tournament-odds", "page");
    return { ok: true };
  } catch (err) {
    console.error("[tournament-odds override toggle] failed", err);
    return { ok: false, error: "db" };
  }
}

// Bake the current snapshot for `surface` onto the target custom_bets
// row's MultiChoiceConfig.options[].payoutOverride. Every option in the
// target's answer_config is matched by `value`; rows the snapshot
// doesn't price get the bet's flat payoutSnapshot (the longshot-default).
//
// Rejects if:
//   - bet is already graded / cancelled (immutable)
//   - bet's answerType is not multi_choice
//   - target bet's options array is empty after hydration (sanity)
export async function publishSurfaceToBet(input: {
  surface: OutrightSurface;
  customBetId: string;
}): Promise<ActionResult<{ updated: number; longshot: number }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  try {
    // Outright surfaces price each option on a continuous log-odds curve:
    // the surface favourite earns OUTRIGHT_CURVE_FLOOR (20), the longest
    // priced shot earns the surface ceiling (100 for players + champion /
    // runner-up / third, 50 for group winners), interpolated between.
    // Group surfaces publish one at a time, so the curve normalises per
    // group automatically. See
    // _plans/2026-06-01-tournament-payout-curve.md.
    const curveFloor = OUTRIGHT_CURVE_FLOOR;
    const curveCeiling = outrightCurveCeiling(input.surface);

    const [bet] = await db
      .select({
        id: customBets.id,
        status: customBets.status,
        answerType: customBets.answerType,
        answerConfig: customBets.answerConfig,
        payoutSnapshot: customBets.payoutSnapshot,
      })
      .from(customBets)
      .where(eq(customBets.id, input.customBetId))
      .limit(1);

    if (!bet) return { ok: false, error: "bet_not_found" };
    if (bet.status === "graded" || bet.status === "cancelled") {
      return { ok: false, error: "bet_immutable" };
    }
    if (bet.answerType !== "multi_choice") {
      return { ok: false, error: "not_multi_choice" };
    }

    const config = bet.answerConfig as AnswerConfig | null;
    if (!config || config.kind !== "multi_choice") {
      return { ok: false, error: "invalid_answer_config" };
    }
    const isDynamic = config.dynamicSource != null;
    const options: MultiChoiceOption[] = Array.isArray(config.options)
      ? config.options
      : [];
    // Static bets must have an options array. Dynamic bets keep
    // options=[] by convention (the picker hydrates from the API).
    if (!isDynamic && options.length === 0) {
      return { ok: false, error: "no_options_on_bet" };
    }

    const snapshotRows = await db
      .select({
        optionKind: outrightOddsSnapshot.optionKind,
        optionId: outrightOddsSnapshot.optionId,
        decimalOdds: outrightOddsSnapshot.decimalOdds,
      })
      .from(outrightOddsSnapshot)
      .where(eq(outrightOddsSnapshot.surface, input.surface));

    // Snapshot's option_id is the api_football_id (player) or
    // api_football_team_id (team). The bet's options[].value uses a
    // different key convention depending on the surface:
    //   - dynamicSource=players surfaces (top_scorer, golden_ball)
    //     → value is api_football_id as a string. Direct match.
    //   - static team surfaces (champion, runner_up, third, group_*)
    //     → value is the 3-letter ISO team code (e.g. "ESP").
    //     We translate via the teams table.
    const teamCodeByApiId = new Map<number, string>();
    const hasTeamSnapshot = snapshotRows.some((r) => r.optionKind === "team");
    if (hasTeamSnapshot) {
      const apiIds = snapshotRows
        .filter((r) => r.optionKind === "team")
        .map((r) => r.optionId);
      const teams = await db
        .select({
          code: teamsTable.code,
          apiFootballTeamId: teamsTable.apiFootballTeamId,
        })
        .from(teamsTable);
      for (const t of teams) {
        if (t.apiFootballTeamId == null) continue;
        if (apiIds.includes(t.apiFootballTeamId)) {
          teamCodeByApiId.set(t.apiFootballTeamId, t.code);
        }
      }
    }

    // One curve per surface, fed every priced option's odds so the
    // favourite lands on the floor and the longest shot on the ceiling.
    const allDecimalOdds = snapshotRows
      .map((r) => Number(r.decimalOdds))
      .filter((d) => Number.isFinite(d) && d > 1.0);
    const curve = buildOutrightCurve(allDecimalOdds, {
      floor: curveFloor,
      ceiling: curveCeiling,
    });

    const priceByValue = new Map<string, number>();
    for (const r of snapshotRows) {
      const dec = Number(r.decimalOdds);
      if (!Number.isFinite(dec) || dec <= 1.0) continue;
      const payout = curve(dec);
      if (r.optionKind === "team") {
        const code = teamCodeByApiId.get(Number(r.optionId));
        if (code) priceByValue.set(code, payout);
      } else {
        priceByValue.set(String(r.optionId), payout);
      }
    }

    let updated = 0;
    let longshot = 0;
    let updatedOptions: MultiChoiceOption[] = options;
    const overridesByValue: Record<string, number> = {};

    if (isDynamic) {
      // Dynamic source: cannot enumerate every option here (1,357
      // players don't fit in JSONB), so we only record the priced
      // options in the map. Anything not in the map (the unpriced long
      // tail) falls back to bet.payoutSnapshot at pick time, which we set
      // to the curve ceiling below — the deepest longshots pay the max.
      for (const [value, payout] of priceByValue) {
        overridesByValue[value] = payout;
        updated += 1;
      }
    } else {
      // Static options: enumerate all of them and apply override or
      // longshot default per row. Mirror into overridesByValue so the
      // resolver has a fast lookup either way.
      updatedOptions = options.map((opt) => {
        const priced = priceByValue.get(opt.value);
        if (priced != null) {
          updated += 1;
          overridesByValue[opt.value] = priced;
          return { ...opt, payoutOverride: priced };
        }
        longshot += 1;
        overridesByValue[opt.value] = curveCeiling;
        return { ...opt, payoutOverride: curveCeiling };
      });
    }

    const newConfig: MultiChoiceConfig = {
      ...config,
      options: updatedOptions,
      payoutOverridesByValue: overridesByValue,
    };

    // Bet-level payoutSnapshot is set to the curve ceiling for every
    // outright surface. For dynamic surfaces it is the genuine fallback
    // an unpriced player resolves to; for static surfaces every option
    // carries its own payoutOverride so the fallback never fires, but the
    // card headline ("זכייה / Payout") reads this value — setting it to
    // the ceiling makes the headline an honest "up to X" instead of a
    // stale flat number.
    await db
      .update(customBets)
      .set({ answerConfig: newConfig, payoutSnapshot: curveCeiling })
      .where(eq(customBets.id, input.customBetId));

    console.info("[tournament-odds publish]", {
      surface: input.surface,
      betId: input.customBetId,
      kind: isDynamic ? "dynamic" : "static",
      optionsTotal: isDynamic ? "dynamic" : options.length,
      withOverrideFromSnapshot: updated,
      longshotDefault: isDynamic ? "ceiling" : longshot,
      curveFloor,
      curveCeiling,
    });
    revalidatePath("/[lang]/admin/tournament-odds", "page");
    revalidatePath("/[lang]/admin/bets", "page");
    return { ok: true, data: { updated, longshot } };
  } catch (err) {
    console.error("[tournament-odds publish] failed", err);
    return { ok: false, error: "db" };
  }
}

// Read helper for the page. Returns rows for one surface sorted by
// payout ascending (favourites first). The page Server Component calls
// this directly inline; kept here so unit tests can import the same
// pure shape.
export async function loadSurfaceRows(surface: OutrightSurface) {
  const rows = await db
    .select({
      id: outrightOddsSnapshot.id,
      optionKind: outrightOddsSnapshot.optionKind,
      optionId: outrightOddsSnapshot.optionId,
      displayName: outrightOddsSnapshot.displayName,
      decimalOdds: outrightOddsSnapshot.decimalOdds,
      source: outrightOddsSnapshot.source,
      adminOverride: outrightOddsSnapshot.adminOverride,
      fetchedAt: outrightOddsSnapshot.fetchedAt,
      notes: outrightOddsSnapshot.notes,
    })
    .from(outrightOddsSnapshot)
    .where(eq(outrightOddsSnapshot.surface, surface))
    .orderBy(sql`${outrightOddsSnapshot.decimalOdds}::numeric asc`);
  return rows;
}

// Cross-surface counts for the surface picker badge.
export async function loadSurfaceCounts() {
  const rows = await db
    .select({
      surface: outrightOddsSnapshot.surface,
      n: sql<number>`count(*)::int`,
    })
    .from(outrightOddsSnapshot)
    .groupBy(outrightOddsSnapshot.surface);
  const out: Record<string, number> = {};
  for (const r of rows) out[r.surface] = Number(r.n);
  return out;
}

// Returns the active multi_choice tournament bets the admin might want
// to publish a snapshot into. Filters to open|locked|draft so we don't
// offer to overwrite an already-graded bet.
export async function loadPublishableBets() {
  const rows = await db
    .select({
      id: customBets.id,
      questionHe: customBets.questionHe,
      questionEn: customBets.questionEn,
      status: customBets.status,
      scope: customBets.scope,
    })
    .from(customBets)
    .where(
      and(
        eq(customBets.answerType, "multi_choice"),
        sql`${customBets.status} in ('draft','open','locked')`,
      ),
    )
    .orderBy(customBets.createdAt);
  return rows;
}
