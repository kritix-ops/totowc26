import "server-only";

import { sql } from "drizzle-orm";
import { Swords } from "lucide-react";
import { execRows } from "@/db/helpers";
import { localePath } from "@/lib/paths";
import type { Generator } from "../types";

// "X open duels are waiting for a challenger - you could be it."
//
// We do not have a directed-invite model (no joinerId on open duels)
// so this surfaces the pool of open duels the user is eligible to
// join: status='open', deadline future, opener is not the user. The
// pool is small (≤ tens) so a count + the freshest duel's id for the
// CTA is enough.
//
// See _plans/2026-05-30-smart-reminders.md §3.2.

type Row = {
  duel_id: string;
  opener_name: string;
  stake: number;
  question_he: string;
  question_en: string;
  total_count: number;
};

export const pendingDuelInvite: Generator = async (ctx) => {
  const rows = await execRows<Row>(sql`
    with open_for_me as (
      select d.id, d.opener_id, d.stake, d.question_he, d.question_en,
             d.join_deadline_at, d.created_at, p.display_name as "opener_name"
      from public.duels d
      join public.profiles p on p.id = d.opener_id
      where d.status = 'open'
        and d.join_deadline_at > now()
        and d.opener_id <> ${ctx.userId}::uuid
    )
    select
      ofm.id::text         as "duel_id",
      ofm.opener_name      as "opener_name",
      ofm.stake            as "stake",
      ofm.question_he      as "question_he",
      ofm.question_en      as "question_en",
      (select count(*)::int from open_for_me) as "total_count"
    from open_for_me ofm
    order by ofm.created_at desc
    limit 1
  `);
  if (rows.length === 0) return null;
  const r = rows[0];
  const isHebrew = ctx.locale === "he";
  const question = isHebrew ? r.question_he : r.question_en;
  const more = r.total_count - 1;

  // Single fresh duel: name + stake; many: lead with the count.
  const title = isHebrew
    ? r.total_count === 1
      ? `${r.opener_name} פתח/ה דו-קרב על ${r.stake} נק'`
      : `${r.total_count} דו-קרבים פתוחים מחכים לך`
    : r.total_count === 1
      ? `${r.opener_name} opened a ${r.stake}-pt duel`
      : `${r.total_count} open duels waiting for a challenger`;

  const body = isHebrew
    ? r.total_count === 1
      ? truncate(question, 110)
      : `${truncate(question, 80)}${more > 0 ? ` · ועוד ${more}` : ""}`
    : r.total_count === 1
      ? truncate(question, 110)
      : `${truncate(question, 80)}${more > 0 ? ` · and ${more} more` : ""}`;

  // Single duel: deep-link to that duel. Many: hub.
  const href =
    r.total_count === 1
      ? localePath(ctx.locale, `duels/${r.duel_id}`)
      : localePath(ctx.locale, "duels");

  return {
    key:
      r.total_count === 1
        ? `pending_duel_invite:${r.duel_id}`
        : "pending_duel_invite",
    type: "pending_duel_invite",
    urgency: "time",
    score: 90,
    icon: Swords,
    title,
    body,
    ctaLabel: isHebrew
      ? r.total_count === 1
        ? "צפה ועברה"
        : "ראה את כל הדו-קרבים"
      : r.total_count === 1
        ? "View duel"
        : "Browse duels",
    ctaHref: href,
  };
};

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
