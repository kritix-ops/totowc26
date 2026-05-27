// Translates raw API-Football strings (event types, event details,
// position abbreviations, fixture status codes) into our locale via
// the glossary. The API returns English with no `locale` parameter,
// so we maintain these maps here.
//
// Unknown strings fall back to the raw API value so the UI never
// renders an empty cell — better to show "Normal Goal" verbatim
// than nothing, and the missing entry surfaces in code review the
// next time we extend the glossary.

import type { Locale } from "@/app/[lang]/dictionaries";
import { t, type TermKey } from "./index";

// ─── Event types ──────────────────────────────────────────────────────
// API-Football returns one of: "Goal", "Card", "subst", "Var". We
// surface the type alongside the detail so users have a clear label
// even when the detail string is unfamiliar.
const EVENT_TYPE_TO_TERM: Record<string, TermKey> = {
  goal: "goal",
  card: "yellow_card",   // refined by EVENT_DETAIL below for red cards
  subst: "substitution",
  var: "var_review",
};

export function translateEventType(locale: Locale, apiType: string): string {
  const key = EVENT_TYPE_TO_TERM[apiType.toLowerCase()];
  if (key) return t(locale, key);
  return apiType;
}

// ─── Event details ────────────────────────────────────────────────────
// API-Football's `detail` field for a Goal/Card/Subst row. Sample
// values observed: "Normal Goal", "Penalty", "Own Goal",
// "Yellow Card", "Red Card", "Second Yellow card",
// "Substitution 1", "Goal Disallowed - Offside",
// "Penalty Shootout", "Goal cancelled - VAR Decision".
//
// Match is by lowercased substring so future API variations like
// "Goal (penalty)" still resolve.
const EVENT_DETAIL_RULES: Array<{ match: string; key: TermKey }> = [
  { match: "own goal",                key: "own_goal" },
  { match: "penalty shootout",        key: "penalty_shootout" },
  { match: "penalty saved",           key: "penalty_saved" },
  { match: "missed penalty",          key: "penalty_missed" },
  { match: "penalty missed",          key: "penalty_missed" },
  { match: "penalty confirmed",       key: "penalty" },
  { match: "penalty",                 key: "penalty" },
  { match: "normal goal",             key: "goal" },
  { match: "goal disallowed",         key: "var_overturn" },
  { match: "goal cancelled",          key: "var_overturn" },
  { match: "goal confirmed",          key: "var_review" },
  { match: "second yellow",           key: "second_yellow" },
  { match: "yellow card",             key: "yellow_card" },
  { match: "red card",                key: "red_card" },
  { match: "substitution",            key: "substitution" },
  { match: "offside",                 key: "offside" },
];

export function translateEventDetail(locale: Locale, apiDetail: string): string {
  const needle = apiDetail.toLowerCase();
  for (const rule of EVENT_DETAIL_RULES) {
    if (needle.includes(rule.match)) {
      return t(locale, rule.key);
    }
  }
  // Unknown detail string — return the raw English so the cell is
  // still informative. Code review picks this up the next time we
  // extend the glossary.
  return apiDetail;
}

// ─── Position abbreviations ───────────────────────────────────────────
// API-Football returns single letters for lineup position: G / D / M / F.
// Some endpoints return the longer form ("Goalkeeper", "Defender") so
// we accept both.
const POSITION_MAP: Record<string, TermKey> = {
  g: "goalkeeper",
  d: "defender",
  m: "midfielder",
  f: "forward",
  goalkeeper: "goalkeeper",
  defender: "defender",
  midfielder: "midfielder",
  forward: "forward",
  attacker: "forward",
};

export function translatePosition(locale: Locale, apiPosition: string | null | undefined): string {
  if (!apiPosition) return "";
  const key = POSITION_MAP[apiPosition.toLowerCase().trim()];
  if (key) return t(locale, key);
  return apiPosition;
}

// ─── Fixture status codes ─────────────────────────────────────────────
// API-Football's fixture.status.short field. We only care about the
// player-visible ones; everything else returns the raw code so QA can
// see what we missed.
const STATUS_LABELS: Record<string, { he: string; en: string }> = {
  TBD:  { he: "טרם נקבע",   en: "TBD" },
  NS:   { he: "טרם החל",    en: "Not started" },
  "1H": { he: "מחצית 1",    en: "1st half" },
  HT:   { he: "מחצית",      en: "Halftime" },
  "2H": { he: "מחצית 2",    en: "2nd half" },
  ET:   { he: "הארכה",      en: "Extra time" },
  BT:   { he: "הפסקה לפני הארכה", en: "Break before ET" },
  P:    { he: "פנדלים",     en: "Penalties" },
  SUSP: { he: "הושעה",      en: "Suspended" },
  INT:  { he: "הופסק",      en: "Interrupted" },
  FT:   { he: "סיום",       en: "Full time" },
  AET:  { he: "סיום בהארכה", en: "After extra time" },
  PEN:  { he: "סיום בפנדלים", en: "After penalties" },
  PST:  { he: "נדחה",       en: "Postponed" },
  CANC: { he: "בוטל",       en: "Cancelled" },
  ABD:  { he: "ננטש",       en: "Abandoned" },
  AWD:  { he: "תוצאה טכנית", en: "Technical result" },
  WO:   { he: "ויתור",      en: "Walkover" },
  LIVE: { he: "חי",         en: "Live" },
};

export function translateFixtureStatus(locale: Locale, apiStatus: string): string {
  const entry = STATUS_LABELS[apiStatus];
  if (entry) return entry[locale === "he" ? "he" : "en"];
  return apiStatus;
}
