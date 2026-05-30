import "server-only";

import { sql } from "drizzle-orm";
import { CalendarClock } from "lucide-react";
import { execFirstRow } from "@/db/helpers";
import { localePath } from "@/lib/paths";
import type { Generator, Moment } from "../types";

// "Match X kicks off in <2h, you haven't picked yet."
//
// Pulls the SINGLE most-imminent unpicked scheduled match for this
// user. The Smart Hub never shows two of these at once - the diversity
// penalty in score.ts handles the rare case where ranking math
// promoted a hypothetical second instance. We surface the first one
// because it is the most actionable thing the player can do right now.
//
// See _plans/2026-05-30-smart-reminders.md §3.2.

type Row = {
  match_id: string;
  home_he: string;
  home_en: string;
  away_he: string;
  away_en: string;
  kickoff_at: string;
  minutes_to_kick: number;
};

const HOURS_24 = 24;

export const unpickedMatchImminent: Generator = async (ctx) => {
  const row = await execFirstRow<Row>(sql`
    select
      m.id::text                                                  as "match_id",
      ht.name_he                                                  as "home_he",
      ht.name_en                                                  as "home_en",
      at.name_he                                                  as "away_he",
      at.name_en                                                  as "away_en",
      m.kickoff_at::text                                          as "kickoff_at",
      ceil(extract(epoch from (m.kickoff_at - now())) / 60)::int  as "minutes_to_kick"
    from public.matches m
    join public.teams ht on ht.code = m.home_team
    join public.teams at on at.code = m.away_team
    left join public.match_bets mb
      on mb.user_id = ${ctx.userId}::uuid and mb.match_id = m.id
    where m.status = 'scheduled'
      and m.kickoff_at > now()
      and m.kickoff_at <= now() + (${HOURS_24} || ' hours')::interval
      and mb.id is null
    order by m.kickoff_at asc
    limit 1
  `);
  if (!row) return null;

  const minutes = Math.max(1, row.minutes_to_kick);
  const isHebrew = ctx.locale === "he";
  const home = isHebrew ? row.home_he : row.home_en;
  const away = isHebrew ? row.away_he : row.away_en;
  const matchup = `${home} - ${away}`;
  const urgency: Moment["urgency"] = minutes <= 120 ? "critical" : "time";

  // Score climbs sharply as the lock window closes. 100 minus hours-
  // to-kick gives a smooth ramp 76-100 across the 24h window.
  const hours = minutes / 60;
  const score = Math.min(100, Math.round(100 - hours));

  return {
    key: `unpicked_match:${row.match_id}`,
    type: "unpicked_match_imminent",
    urgency,
    score,
    icon: CalendarClock,
    title: isHebrew
      ? `עוד לא ניחשת על ${matchup}`
      : `You haven't picked ${matchup}`,
    body: isHebrew
      ? renderHe(minutes)
      : renderEn(minutes),
    ctaLabel: isHebrew ? "הימור עכשיו" : "Pick now",
    ctaHref: localePath(ctx.locale, `match/${row.match_id}`),
  };
};

function renderHe(minutes: number): string {
  if (minutes < 60) return `המשחק מתחיל בעוד ${minutes} דקות. השאר לפניך זמן לנחש.`;
  const hours = Math.round(minutes / 60);
  if (hours <= 2) return `המשחק מתחיל בעוד ${hours} שעות. נחש לפני שהשעון רץ.`;
  if (hours <= 12) return `המשחק היום בעוד ${hours} שעות. אל תפספס.`;
  return `המשחק בעוד ${Math.round(hours / 24)} ימים. ניחוש שני סוגרים את ההימור.`;
}

function renderEn(minutes: number): string {
  if (minutes < 60) return `Kickoff in ${minutes} min. Lock in your pick.`;
  const hours = Math.round(minutes / 60);
  if (hours <= 2) return `Kickoff in ${hours}h. Pick before time runs out.`;
  if (hours <= 12) return `Kickoff today in ${hours}h. Don't miss it.`;
  return `Kickoff in ~${Math.round(hours / 24)}d. Worth picking now.`;
}
