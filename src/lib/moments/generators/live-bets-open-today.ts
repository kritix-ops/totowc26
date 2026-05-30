import "server-only";

import { sql } from "drizzle-orm";
import { Radio } from "lucide-react";
import { execFirstRow } from "@/db/helpers";
import { localePath } from "@/lib/paths";
import type { Generator } from "../types";

// "There are N live/matchday bets open today you haven't picked yet."
//
// "Today" means "matchday date matches the current Asia/Jerusalem
// date." Custom bets with scope IN ('match', 'day') anchor on a
// matchday; this is what the player surfaces in /he/bets/live. We
// count unpicked ones for this user and link to the right surface.
//
// See _plans/2026-05-30-smart-reminders.md §3.2.

type Row = {
  matchday_date: string;
  unpicked_count: number;
  earliest_lock: string | null;
};

export const liveBetsOpenToday: Generator = async (ctx) => {
  const row = await execFirstRow<Row>(sql`
    with today_il as (
      select (now() at time zone 'Asia/Jerusalem')::date as d
    )
    select
      to_char((select d from today_il), 'YYYY-MM-DD') as "matchday_date",
      count(*)::int as "unpicked_count",
      min(cb.lock_at)::text as "earliest_lock"
    from public.custom_bets cb
    join public.matchdays md on md.id = cb.matchday_id
    left join public.user_custom_bet_picks pk
      on pk.user_id = ${ctx.userId}::uuid and pk.custom_bet_id = cb.id
    where cb.scope in ('match', 'day')
      and cb.status = 'open'
      and md.date = (select d from today_il)
      and cb.lock_at > now()
      and pk.id is null
  `);
  if (!row || row.unpicked_count <= 0) return null;

  const isHebrew = ctx.locale === "he";
  const count = row.unpicked_count;

  let minutesToFirstLock: number | null = null;
  if (row.earliest_lock) {
    const diffMs = new Date(row.earliest_lock).getTime() - ctx.now.getTime();
    minutesToFirstLock = Math.max(0, Math.round(diffMs / 60_000));
  }

  // Score 70-90: more bets = more value to surface. Bonus when the
  // first one locks within the next hour.
  let score = 70 + Math.min(20, count * 4);
  if (minutesToFirstLock !== null && minutesToFirstLock <= 60) score += 5;

  return {
    key: `live_bets_open_today:${row.matchday_date}`,
    type: "live_bets_open_today",
    urgency: minutesToFirstLock !== null && minutesToFirstLock <= 60
      ? "critical"
      : "time",
    score,
    icon: Radio,
    title: isHebrew
      ? `${count} הימורי לייב פתוחים להיום`
      : `${count} live bets open today`,
    body: isHebrew
      ? renderHe(count, minutesToFirstLock)
      : renderEn(count, minutesToFirstLock),
    ctaLabel: isHebrew ? "פתח הימורי לייב" : "Open live bets",
    ctaHref: localePath(ctx.locale, `bets/live/${row.matchday_date}`),
  };
};

function renderHe(count: number, minutes: number | null): string {
  const prefix = count === 1
    ? "הימור אחד מחכה לתשובה."
    : `${count} הימורים מחכים לתשובה.`;
  if (minutes === null) return `${prefix} כדאי לסיים לפני המשחק.`;
  if (minutes <= 60) return `${prefix} הראשון נסגר בעוד ${minutes} דקות.`;
  const hours = Math.round(minutes / 60);
  return `${prefix} הראשון נסגר בעוד ${hours} שעות.`;
}

function renderEn(count: number, minutes: number | null): string {
  const prefix = count === 1
    ? "One bet is waiting for your answer."
    : `${count} bets are waiting for your answer.`;
  if (minutes === null) return `${prefix} Tap to take a look.`;
  if (minutes <= 60) return `${prefix} First one locks in ${minutes} min.`;
  const hours = Math.round(minutes / 60);
  return `${prefix} First locks in ${hours}h.`;
}
