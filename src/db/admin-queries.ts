import "server-only";
import { sql } from "drizzle-orm";
import { db } from "./index";

// ---------- sync_runs ----------

export type SyncRunRow = {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  source: "cron" | "admin" | "cli";
  triggeredByName: string | null;
  ok: boolean;
  fetched: number | null;
  inserted: number | null;
  updated: number | null;
  skipped: number | null;
  scoredBets: number | null;
  scoredMatches: number | null;
  scoredSpecials: number | null;
  unknownTeams: string[] | null;
  errorMessage: string | null;
  errorStack: string | null;
};

export async function getRecentSyncRuns(limit = 20): Promise<SyncRunRow[]> {
  const rows = await db.execute<SyncRunRow>(sql`
    select
      r.id::text                  as "id",
      r.started_at                as "startedAt",
      r.finished_at               as "finishedAt",
      r.duration_ms               as "durationMs",
      r.source                    as "source",
      p.display_name              as "triggeredByName",
      r.ok                        as "ok",
      r.fetched                   as "fetched",
      r.inserted                  as "inserted",
      r.updated                   as "updated",
      r.skipped                   as "skipped",
      r.scored_bets               as "scoredBets",
      r.scored_matches            as "scoredMatches",
      r.scored_specials           as "scoredSpecials",
      r.unknown_teams             as "unknownTeams",
      r.error_message             as "errorMessage",
      r.error_stack               as "errorStack"
    from public.sync_runs r
    left join public.profiles p on p.id = r.triggered_by
    order by r.started_at desc
    limit ${limit}
  `);
  return rows as unknown as SyncRunRow[];
}

// ---------- payments ----------

export type AdminPaymentRow = {
  id: string;
  userId: string;
  displayName: string;
  phone: string | null;
  method: "bit" | "paybox";
  amountIls: number;
  status: "pending" | "approved" | "rejected";
  submittedAt: string;
  decidedAt: string | null;
  decidedByName: string | null;
  note: string | null;
};

export async function getPaymentsByStatus(
  status: "pending" | "approved" | "rejected" | "all",
  limit = 50,
): Promise<AdminPaymentRow[]> {
  const rows = await db.execute<AdminPaymentRow>(sql`
    select
      pay.id::text             as "id",
      pay.user_id::text        as "userId",
      payer.display_name       as "displayName",
      payer.phone              as "phone",
      pay.method::text         as "method",
      pay.amount_ils           as "amountIls",
      pay.status::text         as "status",
      pay.submitted_at         as "submittedAt",
      pay.decided_at           as "decidedAt",
      decider.display_name     as "decidedByName",
      pay.note                 as "note"
    from public.payments pay
    join public.profiles payer on payer.id = pay.user_id
    left join public.profiles decider on decider.id = pay.decided_by
    where ${status === "all" ? sql`true` : sql`pay.status = ${status}::payment_status`}
    order by
      case when pay.status = 'pending' then 0 else 1 end,
      pay.submitted_at desc
    limit ${limit}
  `);
  return rows as unknown as AdminPaymentRow[];
}

export type PaymentTotals = {
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
  approvedSumIls: number;
};

// ---------- custom_bets ----------

export type AdminCustomBetRow = {
  id: string;
  scope: "match" | "day" | "stage" | "group" | "tournament";
  status: "draft" | "open" | "locked" | "graded" | "reversed" | "cancelled";
  questionHe: string;
  questionEn: string;
  answerType: "yes_no" | "number" | "multi_choice" | "free_text";
  gradingSource: "auto_balldontlie" | "auto_football_data" | "manual";
  stakeSnapshot: number;
  payoutSnapshot: number;
  lockAt: string;
  matchdayDate: string | null;
  matchLabel: string | null; // "BRA vs GER", null when not match-scoped
  stage: string | null;
  groupId: string | null;
  pickCount: number;
  createdAt: string;
};

// List all custom bets for the admin surface. Filterable by status/scope —
// passing null on a filter means "no filter on this dimension".
export async function listCustomBets(opts: {
  status?: AdminCustomBetRow["status"] | null;
  scope?: AdminCustomBetRow["scope"] | null;
  limit?: number;
} = {}): Promise<AdminCustomBetRow[]> {
  const status = opts.status ?? null;
  const scope = opts.scope ?? null;
  const limit = opts.limit ?? 100;
  const rows = await db.execute<AdminCustomBetRow>(sql`
    select
      cb.id::text                                 as "id",
      cb.scope::text                              as "scope",
      cb.status::text                             as "status",
      cb.question_he                              as "questionHe",
      cb.question_en                              as "questionEn",
      cb.answer_type::text                        as "answerType",
      cb.grading_source::text                     as "gradingSource",
      cb.stake_snapshot                           as "stakeSnapshot",
      cb.payout_snapshot                          as "payoutSnapshot",
      cb.lock_at                                  as "lockAt",
      md.date::text                               as "matchdayDate",
      case when cb.match_id is not null
        then m.home_team || ' vs ' || m.away_team
        else null end                             as "matchLabel",
      cb.stage::text                              as "stage",
      cb.group_id                                 as "groupId",
      coalesce((
        select count(*)::int from public.user_custom_bet_picks pk
        where pk.custom_bet_id = cb.id
      ), 0)                                       as "pickCount",
      cb.created_at                               as "createdAt"
    from public.custom_bets cb
    left join public.matchdays md on md.id = cb.matchday_id
    left join public.matches   m  on m.id  = cb.match_id
    where
      (${status}::text is null or cb.status::text = ${status}) and
      (${scope}::text  is null or cb.scope::text  = ${scope})
    order by
      case cb.status
        when 'draft'     then 0
        when 'open'      then 1
        when 'locked'    then 2
        when 'graded'    then 3
        when 'reversed'  then 4
        when 'cancelled' then 5
      end asc,
      cb.lock_at asc nulls last,
      cb.created_at desc
    limit ${limit}
  `);
  return rows as unknown as AdminCustomBetRow[];
}

// One-bet detail for the edit / grade view. Returns the bet row joined
// with every pick + the player's display name so the grade page can
// render the picks table without a second roundtrip. answerConfig +
// resolvedValue + answer are returned as raw JSONB; caller casts via
// the AnswerConfig / ResolvedValue / PickAnswer types from
// src/lib/bets/types.ts.
export type AdminCustomBetPickRow = {
  pickId: string;
  userId: string;
  displayName: string;
  answer: unknown;
  stakePaid: number;
  pointsEarned: number | null;
  wasCorrect: boolean | null;
  locked: boolean;
  createdAt: string;
};

export type AdminCustomBetDetail = {
  id: string;
  scope: "match" | "day" | "stage" | "group" | "tournament";
  status: "draft" | "open" | "locked" | "graded" | "reversed" | "cancelled";
  questionHe: string;
  questionEn: string;
  gradingRuleHe: string;
  gradingRuleEn: string;
  answerType: "yes_no" | "number" | "multi_choice" | "free_text";
  answerConfig: unknown;
  stakeSnapshot: number;
  payoutSnapshot: number;
  gradingSource: "auto_balldontlie" | "auto_football_data" | "manual";
  gradingConfig: unknown;
  resolvedValue: unknown;
  lockAt: string;
  publishedAt: string | null;
  gradedAt: string | null;
  matchId: string | null;
  matchdayId: string | null;
  matchdayDate: string | null;
  matchLabel: string | null;
  stage: string | null;
  groupId: string | null;
  createdAt: string;
  picks: AdminCustomBetPickRow[];
};

export async function getAdminCustomBetDetail(
  id: string,
): Promise<AdminCustomBetDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;

  const betRows = await db.execute<Omit<AdminCustomBetDetail, "picks">>(sql`
    select
      cb.id::text                                 as "id",
      cb.scope::text                              as "scope",
      cb.status::text                             as "status",
      cb.question_he                              as "questionHe",
      cb.question_en                              as "questionEn",
      cb.grading_rule_he                          as "gradingRuleHe",
      cb.grading_rule_en                          as "gradingRuleEn",
      cb.answer_type::text                        as "answerType",
      cb.answer_config                            as "answerConfig",
      cb.stake_snapshot                           as "stakeSnapshot",
      cb.payout_snapshot                          as "payoutSnapshot",
      cb.grading_source::text                     as "gradingSource",
      cb.grading_config                           as "gradingConfig",
      cb.resolved_value                           as "resolvedValue",
      cb.lock_at                                  as "lockAt",
      cb.published_at                             as "publishedAt",
      cb.graded_at                                as "gradedAt",
      cb.match_id::text                           as "matchId",
      cb.matchday_id::text                        as "matchdayId",
      md.date::text                               as "matchdayDate",
      case when cb.match_id is not null
        then m.home_team || ' vs ' || m.away_team
        else null end                             as "matchLabel",
      cb.stage::text                              as "stage",
      cb.group_id                                 as "groupId",
      cb.created_at                               as "createdAt"
    from public.custom_bets cb
    left join public.matchdays md on md.id = cb.matchday_id
    left join public.matches   m  on m.id  = cb.match_id
    where cb.id = ${id}::uuid
    limit 1
  `);
  const bet = (betRows as unknown as Array<Omit<AdminCustomBetDetail, "picks">>)[0];
  if (!bet) return null;

  const pickRows = await db.execute<AdminCustomBetPickRow>(sql`
    select
      pk.id::text          as "pickId",
      pk.user_id::text     as "userId",
      p.display_name       as "displayName",
      pk.answer            as "answer",
      pk.stake_paid        as "stakePaid",
      pk.points_earned     as "pointsEarned",
      pk.was_correct       as "wasCorrect",
      pk.locked            as "locked",
      pk.created_at        as "createdAt"
    from public.user_custom_bet_picks pk
    join public.profiles p on p.id = pk.user_id
    where pk.custom_bet_id = ${id}::uuid
    order by pk.created_at asc
  `);

  return {
    ...bet,
    picks: pickRows as unknown as AdminCustomBetPickRow[],
  };
}

// Matches that haven't kicked off yet — used by the admin form when scope
// is "match" or "day" (the matchday anchor derives from the match's date).
export type AdminAnchorMatch = {
  id: string;
  kickoffAt: string;
  homeCode: string;
  homeNameHe: string;
  homeNameEn: string;
  awayCode: string;
  awayNameHe: string;
  awayNameEn: string;
  stage: string;
  groupId: string | null;
};

export async function listAnchorMatches(limit = 200): Promise<AdminAnchorMatch[]> {
  const rows = await db.execute<AdminAnchorMatch>(sql`
    select
      m.id::text       as "id",
      m.kickoff_at     as "kickoffAt",
      m.home_team      as "homeCode",
      ht.name_he       as "homeNameHe",
      ht.name_en       as "homeNameEn",
      m.away_team      as "awayCode",
      at.name_he       as "awayNameHe",
      at.name_en       as "awayNameEn",
      m.stage::text    as "stage",
      m.group_id       as "groupId"
    from public.matches m
    join public.teams ht on ht.code = m.home_team
    join public.teams at on at.code = m.away_team
    where m.status = 'scheduled'
    order by m.kickoff_at asc
    limit ${limit}
  `);
  return rows as unknown as AdminAnchorMatch[];
}

// Distinct upcoming matchday dates (Asia/Jerusalem) across all scheduled
// matches. Drives the day-scope picker so the admin can author a bet for
// "today" / "tomorrow" without typing a date manually.
export type AdminAnchorDay = {
  date: string;        // YYYY-MM-DD
  matchCount: number;
  earliestKickoff: string;
};

export async function listAnchorDays(): Promise<AdminAnchorDay[]> {
  const rows = await db.execute<AdminAnchorDay>(sql`
    select
      to_char((m.kickoff_at at time zone 'Asia/Jerusalem')::date, 'YYYY-MM-DD') as "date",
      count(*)::int                       as "matchCount",
      min(m.kickoff_at)::text             as "earliestKickoff"
    from public.matches m
    where m.status = 'scheduled'
    group by (m.kickoff_at at time zone 'Asia/Jerusalem')::date
    order by (m.kickoff_at at time zone 'Asia/Jerusalem')::date asc
  `);
  return rows as unknown as AdminAnchorDay[];
}

export async function getPaymentTotals(): Promise<PaymentTotals> {
  const rows = await db.execute<{
    pending_count: number;
    approved_count: number;
    rejected_count: number;
    approved_sum: number;
  }>(sql`
    select
      count(*) filter (where status = 'pending')::int   as pending_count,
      count(*) filter (where status = 'approved')::int  as approved_count,
      count(*) filter (where status = 'rejected')::int  as rejected_count,
      coalesce(sum(amount_ils) filter (where status = 'approved'), 0)::int
                                                        as approved_sum
    from public.payments
  `);
  const r = (rows as unknown as Array<{
    pending_count: number;
    approved_count: number;
    rejected_count: number;
    approved_sum: number;
  }>)[0];
  return {
    pendingCount: Number(r.pending_count),
    approvedCount: Number(r.approved_count),
    rejectedCount: Number(r.rejected_count),
    approvedSumIls: Number(r.approved_sum),
  };
}
