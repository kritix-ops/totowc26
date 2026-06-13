// Pure helpers for the admin bets management surface's primary "bet
// type" facet (לייב / טורניר / דו-קרב). Kept free of DB / server-only
// imports so the page, the duel-action component, and the unit tests can
// all share one source of truth for the type → scope mapping and the
// label copy.
//
// The facet is a higher-level grouping than the underlying data models:
//   live       → custom_bets with scope match | day
//   tournament → custom_bets with scope stage | group | tournament
//   duel       → the separate `duels` table (its own lifecycle)
//
// Plain 1/X/2 match-result picks are intentionally absent — they are
// auto-generated and graded from the score, not authored/managed here.

export const BET_TYPES = ["live", "tournament", "duel"] as const;
export type BetType = (typeof BET_TYPES)[number];

// Custom-bet scopes, narrowed per family. Mirrors the enum in
// src/db/schema.ts (betScopeEnum) for the two managed-bet families.
export type CustomBetScope =
  | "match"
  | "day"
  | "stage"
  | "group"
  | "tournament";

export type DuelStatus = "open" | "matched" | "settled" | "cancelled";
export type DuelScope = "match" | "day" | "tournament";

// Parse the `?type=` query param. Returns null for an absent/garbage
// value so the caller can apply its own default (the page uses "live").
// Accepts the first entry when the param arrives as an array.
export function parseBetType(
  raw: string | string[] | undefined,
): BetType | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (BET_TYPES as readonly string[]).includes(v ?? "")
    ? (v as BetType)
    : null;
}

// The custom_bets scopes that belong to a given (non-duel) bet type.
// Used both to constrain the list query and to decide which scope
// sub-chips to render. Duel is excluded — it has no custom_bets scope.
export function scopesForBetType(
  type: Exclude<BetType, "duel">,
): CustomBetScope[] {
  return type === "live"
    ? ["match", "day"]
    : ["stage", "group", "tournament"];
}

// True when a custom-bet scope belongs to the selected family. Lets the
// page drop an out-of-family scope sub-filter when the type switches
// (e.g. scope=group while type flips to live) instead of returning an
// empty list.
export function scopeBelongsToType(
  type: Exclude<BetType, "duel">,
  scope: CustomBetScope,
): boolean {
  return scopesForBetType(type).includes(scope);
}

// ---------- label copy (he / en) ----------

export function betTypeLabel(type: BetType, isHebrew: boolean): string {
  const map: Record<BetType, [string, string]> = {
    live: ["לייב", "Live"],
    tournament: ["טורניר", "Tournament"],
    duel: ["דו-קרב", "Duel"],
  };
  return map[type][isHebrew ? 0 : 1];
}

export function duelStatusLabel(status: DuelStatus, isHebrew: boolean): string {
  const map: Record<DuelStatus, [string, string]> = {
    open: ["פתוח", "Open"],
    matched: ["שובץ", "Matched"],
    settled: ["הוכרע", "Settled"],
    cancelled: ["בוטל", "Cancelled"],
  };
  return map[status][isHebrew ? 0 : 1];
}

export function duelScopeLabel(scope: DuelScope, isHebrew: boolean): string {
  const map: Record<DuelScope, [string, string]> = {
    match: ["משחק", "Match"],
    day: ["יום", "Day"],
    tournament: ["טורניר", "Tournament"],
  };
  return map[scope][isHebrew ? 0 : 1];
}

// Chip tone per duel status, matching the public /duels surface so the
// admin sees the same colour language: active=primary, matched=neutral,
// settled=secondary, cancelled=warning.
export function duelStatusTone(
  status: DuelStatus,
): "default" | "primary" | "secondary" | "warning" {
  switch (status) {
    case "open":
      return "primary";
    case "matched":
      return "default";
    case "settled":
      return "secondary";
    case "cancelled":
      return "warning";
  }
}
