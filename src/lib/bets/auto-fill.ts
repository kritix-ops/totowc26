import "server-only";
import { execRows, sql } from "@/db/helpers";
import { type StageKey } from "@/db/schema";
import { FREE_PICK_SCOPES } from "@/lib/bets/free-pick-scopes";
import { getDeadlineContext, resolveMatchScoreLock } from "@/lib/deadlines";
import { randomCustomAnswer, randomMatchScore } from "@/lib/random-picks";
import {
  writeCustomPicksBulk,
  writeMatchPick,
  type CustomPickInput,
  type WriteOpts,
  type WritePrincipal,
} from "@/lib/bets/write-core";

// Deadline auto-fill safety net. When a bet's pick deadline has passed and a
// PAID participant never picked, fill an odds-weighted random pick on their
// behalf so they aren't left with a dead bet. Covers match scores (games) +
// tournament / stage / group bets. Deliberately NOT live bets (the day/match
// custom scopes) and NOT duels.
//
// Runs on the 30-minute news cron. The write-core's `allowAfterDeadline` grace
// path lets it write a pick after the deadline, while every other guard still
// holds inside the locked write: a match that already kicked off is skipped, a
// graded bet is skipped, existing picks are never overwritten, and the bank is
// still respected. See _plans/2026-06-01-monkey-bot-and-random-fill.md.

export type AutoFillReport = {
  paidUsers: number;
  matchPicksFilled: number;
  customPicksFilled: number;
  skipped: number;
};

// Grace options: never overwrite a real pick; allowed to write past the
// deadline (that is the whole point of this pass).
const GRACE: WriteOpts = { overwrite: false, allowAfterDeadline: true };

export async function autoFillPastDeadline(): Promise<AutoFillReport> {
  const paidIds = await listPaidParticipantIds();
  const report: AutoFillReport = {
    paidUsers: paidIds.length,
    matchPicksFilled: 0,
    customPicksFilled: 0,
    skipped: 0,
  };
  if (paidIds.length === 0) return report;

  // Compute the due sets once (the same for every user), then fill each user's
  // gaps. Most ticks these are empty, so the per-user work is near zero.
  const dueMatchIds = await computeDueMatchIds();
  const dueCustom = await computeDueCustomBets();
  if (dueMatchIds.length === 0 && dueCustom.ids.length === 0) return report;

  for (const userId of paidIds) {
    const principal: WritePrincipal = { kind: "system", userId };

    if (dueMatchIds.length > 0) {
      const missing = await missingMatchIdsForUser(userId, dueMatchIds);
      for (const matchId of missing) {
        const { home, away } = randomMatchScore();
        const res = await writeMatchPick(principal, { matchId, home, away }, GRACE);
        if (res.status === "filled") report.matchPicksFilled++;
        else report.skipped++;
      }
    }

    if (dueCustom.ids.length > 0) {
      const missingIds = await missingCustomIdsForUser(userId, dueCustom.ids);
      const items: CustomPickInput[] = [];
      for (const id of missingIds) {
        const meta = dueCustom.byId.get(id);
        if (!meta) continue;
        const answer = randomCustomAnswer(meta.answerType, meta.answerConfig);
        if (answer) items.push({ customBetId: id, answer });
        else report.skipped++; // free_text / unbounded number
      }
      if (items.length > 0) {
        const results = await writeCustomPicksBulk(principal, items, GRACE);
        for (const r of results) {
          if (r.status === "filled") report.customPicksFilled++;
          else report.skipped++;
        }
      }
    }
  }
  return report;
}

// Real competitors: a profile with an approved payment, excluding the bot.
// Mirrors the participant definition used by the pot / reminders / duel
// notifications.
async function listPaidParticipantIds(): Promise<string[]> {
  const rows = await execRows<{ id: string }>(sql`
    select distinct p.id::text as "id"
    from public.profiles p
    join public.payments pay
      on pay.user_id = p.id and pay.status = 'approved'
    where p.is_bot = false
  `);
  return rows.map((r) => r.id);
}

// Scheduled matches whose pick deadline has passed but which have NOT kicked
// off yet (the grace window). Deadline is the per-match cascade, resolved in
// JS because it is not a single column.
async function computeDueMatchIds(): Promise<string[]> {
  const rows = await execRows<{
    id: string;
    kickoff_at: string;
    stage: string;
    lock_at_override: string | null;
    matchday_offset: number | null;
  }>(sql`
    select
      m.id::text as "id",
      m.kickoff_at as "kickoff_at",
      m.stage::text as "stage",
      m.lock_at_override as "lock_at_override",
      md.lock_offset_override_minutes as "matchday_offset"
    from public.matches m
    left join public.matchdays md
      on md.date = (m.kickoff_at at time zone 'Asia/Jerusalem')::date
    where m.status = 'scheduled' and m.kickoff_at > now()
  `);
  const context = await getDeadlineContext();
  const now = Date.now();
  const due: string[] = [];
  for (const r of rows) {
    const resolved = resolveMatchScoreLock(
      {
        matchId: r.id,
        kickoffAt: new Date(r.kickoff_at),
        stage: r.stage as StageKey,
        lockAtOverride: r.lock_at_override ? new Date(r.lock_at_override) : null,
        matchdayLockOffsetMinutes: r.matchday_offset,
      },
      context,
    );
    if (resolved.effectiveLockAt.getTime() <= now) due.push(r.id);
  }
  return due;
}

type DueCustomMeta = {
  answerType: "yes_no" | "number" | "multi_choice" | "free_text";
  answerConfig: unknown;
};

// Tournament / stage / group bets whose deadline has passed and which are not
// yet graded. For these scopes the effective lock IS lock_at (resolveCustomBetLock
// is a pure pass-through), so the filter is a plain lock_at <= now(). Live
// scopes (day, match) and any graded/cancelled bet are excluded.
async function computeDueCustomBets(): Promise<{
  ids: string[];
  byId: Map<string, DueCustomMeta>;
}> {
  const scopeList = sql.join(
    FREE_PICK_SCOPES.map((s) => sql`${s}`),
    sql`, `,
  );
  const rows = await execRows<{
    id: string;
    answerType: DueCustomMeta["answerType"];
    answerConfig: unknown;
  }>(sql`
    select
      cb.id::text          as "id",
      cb.answer_type::text as "answerType",
      cb.answer_config     as "answerConfig"
    from public.custom_bets cb
    where cb.scope::text in (${scopeList})
      and cb.status in ('open', 'locked')
      and cb.lock_at <= now()
  `);
  const byId = new Map<string, DueCustomMeta>();
  const ids: string[] = [];
  for (const r of rows) {
    ids.push(r.id);
    byId.set(r.id, { answerType: r.answerType, answerConfig: r.answerConfig });
  }
  return { ids, byId };
}

async function missingMatchIdsForUser(
  userId: string,
  dueIds: string[],
): Promise<string[]> {
  const idList = sql.join(
    dueIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const rows = await execRows<{ id: string }>(sql`
    select m.id::text as "id"
    from public.matches m
    where m.id in (${idList})
      and not exists (
        select 1 from public.match_bets mb
        where mb.match_id = m.id and mb.user_id = ${userId}
      )
  `);
  return rows.map((r) => r.id);
}

async function missingCustomIdsForUser(
  userId: string,
  dueIds: string[],
): Promise<string[]> {
  const idList = sql.join(
    dueIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const rows = await execRows<{ id: string }>(sql`
    select cb.id::text as "id"
    from public.custom_bets cb
    where cb.id in (${idList})
      and not exists (
        select 1 from public.user_custom_bet_picks pk
        where pk.custom_bet_id = cb.id and pk.user_id = ${userId}
      )
  `);
  return rows.map((r) => r.id);
}
