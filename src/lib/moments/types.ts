import type { LucideIcon } from "lucide-react";
import type { Locale } from "@/app/[lang]/dictionaries";

// Each Smart Hub row is a Moment. Generators produce Moment | null and
// the ranker mixes them. Keep this file tiny - it is imported by every
// generator and by the Smart Hub component, so any heavy import here
// becomes a server-bundle weight tax on the dashboard.
//
// See _plans/2026-05-30-smart-reminders.md.

export type MomentType =
  | "unpicked_match_imminent"
  | "pending_duel_invite"
  | "live_bets_open_today"
  | "duel_opportunity"
  | "position_catchup";

export type MomentUrgency = "critical" | "time" | "opportunity" | "info";

export type Moment = {
  // Stable identifier for this specific moment. Used as the dismissal
  // key, so it must be deterministic across renders for the same
  // underlying state. Shape "<type>" or "<type>:<scoped-id>". Validated
  // by the CHECK constraint in migration 0036.
  key: string;
  type: MomentType;
  urgency: MomentUrgency;
  // 0-100, ranker input. Generators set a baseline; the ranker layers
  // diversity / recency adjustments on top.
  score: number;
  icon: LucideIcon;
  title: string;
  body: string;
  ctaLabel: string;
  ctaHref: string;
};

// Context passed to every generator. now() is injected so tests can
// freeze the clock; production callers pass new Date().
export type MomentContext = {
  userId: string;
  locale: Locale;
  now: Date;
};

export type Generator = (ctx: MomentContext) => Promise<Moment | null>;
