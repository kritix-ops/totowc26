import "server-only";
import { sql } from "drizzle-orm";
import { execFirstRow, execRows } from "./helpers";

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
  // Persisted from sync.ts since migration 0025. Null for runs that
  // happened before the migration. Drives the reminder + auto-lock
  // counters in SyncPanel.
  remindersSent: number | null;
  lockedExpiredCustomBets: number | null;
  unknownTeams: string[] | null;
  errorMessage: string | null;
  errorStack: string | null;
  // Which upstream the sync row used. "api-football" on the primary
  // path, "football-data" on the degraded-mode fallback, null for
  // historical rows written before migration 0020.
  provider: "api-football" | "football-data" | null;
};

export async function getRecentSyncRuns(limit = 20): Promise<SyncRunRow[]> {
  return execRows<SyncRunRow>(sql`
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
      r.scored_bets                  as "scoredBets",
      r.scored_matches               as "scoredMatches",
      r.reminders_sent               as "remindersSent",
      r.locked_expired_custom_bets   as "lockedExpiredCustomBets",
      r.unknown_teams                as "unknownTeams",
      r.error_message                as "errorMessage",
      r.error_stack                  as "errorStack",
      r.provider                     as "provider"
    from public.sync_runs r
    left join public.profiles p on p.id = r.triggered_by
    where r.provider is distinct from 'github-backup'
    order by r.started_at desc
    limit ${limit}
  `);
}

// ---------- backup runs (CSV → GitHub) ----------

// Per-row shape for the admin BackupPanel history list. Same physical
// table as sync_runs but a narrower projection: backup runs only fill
// `fetched` (file count) and `inserted` (total row count), so the
// scoredBets / scoredMatches / reminders columns aren't useful here.
export type BackupRunRow = {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  source: string;
  triggeredByName: string | null;
  ok: boolean;
  fileCount: number | null;
  rowCount: number | null;
  errorMessage: string | null;
  errorStack: string | null;
};

export async function getRecentBackupRuns(
  limit = 10,
): Promise<BackupRunRow[]> {
  return execRows<BackupRunRow>(sql`
    select
      r.id::text       as "id",
      r.started_at     as "startedAt",
      r.finished_at    as "finishedAt",
      r.duration_ms    as "durationMs",
      r.source         as "source",
      p.display_name   as "triggeredByName",
      r.ok             as "ok",
      r.fetched        as "fileCount",
      r.inserted       as "rowCount",
      r.error_message  as "errorMessage",
      r.error_stack    as "errorStack"
    from public.sync_runs r
    left join public.profiles p on p.id = r.triggered_by
    where r.provider = 'github-backup'
    order by r.started_at desc
    limit ${limit}
  `);
}

// ---------- team mapping status ----------

// How many teams still need their api_football_team_id set. Drives the
// banner inside SyncPanel — until this is 0, the API-Football fixture
// sync (post-PR 2) cannot resolve every fixture's home/away pair.
export type TeamMappingStatus = {
  totalTeams: number;
  mapped: number;
  unmapped: number;
  unmappedSample: string[]; // codes, capped so the banner stays compact
};

export async function getTeamMappingStatus(): Promise<TeamMappingStatus> {
  const r = await execFirstRow<{
    total: number;
    mapped: number;
    unmapped: number;
    sample: string[] | null;
  }>(sql`
    select
      count(*)::int                                                  as "total",
      count(*) filter (where api_football_team_id is not null)::int  as "mapped",
      count(*) filter (where api_football_team_id is null)::int      as "unmapped",
      coalesce(
        (
          select array_agg(code order by code)
          from (
            select code
            from public.teams
            where api_football_team_id is null
            order by code asc
            limit 8
          ) s
        ),
        array[]::text[]
      ) as "sample"
    from public.teams
  `);
  return {
    totalTeams: Number(r?.total ?? 0),
    mapped: Number(r?.mapped ?? 0),
    unmapped: Number(r?.unmapped ?? 0),
    unmappedSample: r?.sample ?? [],
  };
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
  return execRows<AdminPaymentRow>(sql`
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
  gradingSource: "auto_api_football" | "auto_football_data" | "manual";
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

// List all custom bets for the admin surface. Filterable by status/scope -
// passing null on a filter means "no filter on this dimension".
export async function listCustomBets(opts: {
  status?: AdminCustomBetRow["status"] | null;
  scope?: AdminCustomBetRow["scope"] | null;
  limit?: number;
} = {}): Promise<AdminCustomBetRow[]> {
  const status = opts.status ?? null;
  const scope = opts.scope ?? null;
  const limit = opts.limit ?? 100;
  return execRows<AdminCustomBetRow>(sql`
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
}

// Surface bets that share an identical (scope, anchor, question_he)
// triplet with at least one other active bet. Powers /admin/bets/duplicates,
// where the admin reviews and cancels the extra copies that publishing a
// tournament-suggestions template twice creates. We restrict to non-terminal
// statuses (draft / open / locked) because graded / cancelled / reversed
// rows already settled and do not pollute the player-facing surfaces.
//
// `dedupKey` is the grouping key the page renders side-by-side. `groupSize`
// is the number of rows that share it (always >= 2 here).
export type AdminDuplicateBetRow = AdminCustomBetRow & {
  dedupKey: string;
  groupSize: number;
};

export async function listDuplicateCustomBets(): Promise<AdminDuplicateBetRow[]> {
  return execRows<AdminDuplicateBetRow>(sql`
    with active as (
      select
        cb.id,
        cb.scope,
        cb.status,
        cb.question_he,
        cb.question_en,
        cb.answer_type,
        cb.grading_source,
        cb.stake_snapshot,
        cb.payout_snapshot,
        cb.lock_at,
        cb.created_at,
        cb.match_id,
        cb.matchday_id,
        cb.stage,
        cb.group_id,
        (
          cb.scope::text
          || '|' || coalesce(cb.match_id::text,    '')
          || '|' || coalesce(cb.matchday_id::text, '')
          || '|' || coalesce(cb.stage::text,       '')
          || '|' || coalesce(cb.group_id,          '')
          || '|' || cb.question_he
        ) as dedup_key
      from public.custom_bets cb
      where cb.status in ('draft', 'open', 'locked')
    ),
    grp as (
      select dedup_key, count(*)::int as n
      from active
      group by dedup_key
      having count(*) > 1
    )
    select
      a.id::text                                 as "id",
      a.scope::text                              as "scope",
      a.status::text                             as "status",
      a.question_he                              as "questionHe",
      a.question_en                              as "questionEn",
      a.answer_type::text                        as "answerType",
      a.grading_source::text                     as "gradingSource",
      a.stake_snapshot                           as "stakeSnapshot",
      a.payout_snapshot                          as "payoutSnapshot",
      a.lock_at                                  as "lockAt",
      md.date::text                              as "matchdayDate",
      case when a.match_id is not null
        then m.home_team || ' vs ' || m.away_team
        else null end                            as "matchLabel",
      a.stage::text                              as "stage",
      a.group_id                                 as "groupId",
      coalesce((
        select count(*)::int from public.user_custom_bet_picks pk
        where pk.custom_bet_id = a.id
      ), 0)                                      as "pickCount",
      a.created_at                               as "createdAt",
      a.dedup_key                                as "dedupKey",
      grp.n                                      as "groupSize"
    from active a
    join grp on grp.dedup_key = a.dedup_key
    left join public.matchdays md on md.id = a.matchday_id
    left join public.matches   m  on m.id  = a.match_id
    order by a.dedup_key asc, a.created_at asc
  `);
}

// Cheap counter for the /admin/bets banner. Counts the rows above without
// pulling them — same predicate, just COUNT(*).
export async function countDuplicateCustomBets(): Promise<number> {
  const r = await execFirstRow<{ n: number }>(sql`
    with active as (
      select
        (
          cb.scope::text
          || '|' || coalesce(cb.match_id::text,    '')
          || '|' || coalesce(cb.matchday_id::text, '')
          || '|' || coalesce(cb.stage::text,       '')
          || '|' || coalesce(cb.group_id,          '')
          || '|' || cb.question_he
        ) as dedup_key
      from public.custom_bets cb
      where cb.status in ('draft', 'open', 'locked')
    ),
    grp as (
      select dedup_key, count(*)::int as n
      from active
      group by dedup_key
      having count(*) > 1
    )
    select coalesce(sum(n), 0)::int as "n" from grp
  `);
  return Number(r?.n ?? 0);
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
  gradingSource: "auto_api_football" | "auto_football_data" | "manual";
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

  const bet = await execFirstRow<Omit<AdminCustomBetDetail, "picks">>(sql`
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
  if (!bet) return null;

  const picks = await execRows<AdminCustomBetPickRow>(sql`
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

  return { ...bet, picks };
}

// Matches that haven't kicked off yet - used by the admin form when scope
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
  return execRows<AdminAnchorMatch>(sql`
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
  return execRows<AdminAnchorDay>(sql`
    select
      to_char((m.kickoff_at at time zone 'Asia/Jerusalem')::date, 'YYYY-MM-DD') as "date",
      count(*)::int                       as "matchCount",
      min(m.kickoff_at)::text             as "earliestKickoff"
    from public.matches m
    where m.status = 'scheduled'
    group by (m.kickoff_at at time zone 'Asia/Jerusalem')::date
    order by (m.kickoff_at at time zone 'Asia/Jerusalem')::date asc
  `);
}

export async function getPaymentTotals(): Promise<PaymentTotals> {
  const r = await execFirstRow<{
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
  return {
    pendingCount: Number(r?.pending_count ?? 0),
    approvedCount: Number(r?.approved_count ?? 0),
    rejectedCount: Number(r?.rejected_count ?? 0),
    approvedSumIls: Number(r?.approved_sum ?? 0),
  };
}

// ---------- live-bet suggestions ----------
//
// Surfaces feeding /[lang]/admin/live-bets/suggestions. The page pulls
// every fixture on a given Asia/Jerusalem date plus the list of dates
// that have at least one upcoming fixture, so the admin can flick
// between matchdays without manually editing the query string.

export type LiveBetsFixtureRow = {
  id: string;
  apiFootballFixtureId: number | null;
  kickoffAt: string;
  homeCode: string;
  homeNameHe: string;
  homeNameEn: string;
  awayCode: string;
  awayNameHe: string;
  awayNameEn: string;
  status: "scheduled" | "live" | "final";
};

export async function listFixturesForDate(
  date: string,
): Promise<LiveBetsFixtureRow[]> {
  // Accept only YYYY-MM-DD so we can interpolate safely below.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
  return execRows<LiveBetsFixtureRow>(sql`
    select
      m.id::text                   as "id",
      m.api_football_fixture_id    as "apiFootballFixtureId",
      m.kickoff_at::text           as "kickoffAt",
      m.home_team                  as "homeCode",
      ht.name_he                   as "homeNameHe",
      ht.name_en                   as "homeNameEn",
      m.away_team                  as "awayCode",
      at.name_he                   as "awayNameHe",
      at.name_en                   as "awayNameEn",
      m.status::text               as "status"
    from public.matches m
    join public.teams ht on ht.code = m.home_team
    join public.teams at on at.code = m.away_team
    where (m.kickoff_at at time zone 'Asia/Jerusalem')::date = ${date}::date
    order by m.kickoff_at asc
  `);
}

export type LiveBetsDateRow = {
  date: string;
  fixtureCount: number;
};

// Every Asia/Jerusalem date that has at least one scheduled or live
// fixture, ordered earliest first. Drives the date picker on the
// suggestions page.
export async function listLiveBetsDates(): Promise<LiveBetsDateRow[]> {
  return execRows<LiveBetsDateRow>(sql`
    select
      to_char((m.kickoff_at at time zone 'Asia/Jerusalem')::date,
              'YYYY-MM-DD')                          as "date",
      count(*)::int                                  as "fixtureCount"
    from public.matches m
    where m.status in ('scheduled', 'live')
    group by (m.kickoff_at at time zone 'Asia/Jerusalem')::date
    order by 1 asc
  `);
}

// ---------- player translation review queue ----------
//
// One row per player, with everything the /admin/players review UI
// needs to surface (English + Hebrew names, source / confidence /
// verdict / reason, the locked flag, team metadata for the chip).
// Ordering keys the queue: rejects first, then flagged, then
// approved by confidence ascending (lowest confidence near the top
// so admin attention lands where it adds the most value), then
// unreviewed rows. NULL nameHe rows surface alongside their parent
// verdict bucket — usually 'reject' (LLM said the candidate was
// wrong) or no verdict yet.

export type AdminPlayerReviewRow = {
  id: string;
  apiFootballId: number;
  teamCode: string;
  teamNameHe: string;
  teamNameEn: string;
  teamFlag: string;
  nameEn: string;
  nameHe: string | null;
  position: string | null;
  jerseyNumber: number | null;
  photoUrl: string | null;
  nameHeSource: string | null;
  nameHeConfidence: number | null;
  nameHeReviewVerdict: "approved" | "flag" | "reject" | null;
  nameHeReviewReason: string | null;
  nameHeReviewedAt: string | null;
  nameHeAdminLocked: boolean;
};

export async function listPlayersForReview(opts?: {
  verdict?: "approved" | "flag" | "reject" | "unreviewed" | "all";
  teamCode?: string | null;
  limit?: number;
}): Promise<AdminPlayerReviewRow[]> {
  const verdict = opts?.verdict ?? "all";
  const teamCode = opts?.teamCode ?? null;
  const limit = Math.min(Math.max(opts?.limit ?? 500, 1), 2000);

  // We sort by a manually-computed bucket so the four verdict
  // groups have a stable, intuitive order independent of how
  // Postgres collates the verdict strings alphabetically.
  return execRows<AdminPlayerReviewRow>(sql`
    select
      p.id::text                       as "id",
      p.api_football_id                as "apiFootballId",
      p.team_code                      as "teamCode",
      t.name_he                        as "teamNameHe",
      t.name_en                        as "teamNameEn",
      t.flag                           as "teamFlag",
      p.name_en                        as "nameEn",
      p.name_he                        as "nameHe",
      p.position                       as "position",
      p.jersey_number                  as "jerseyNumber",
      p.photo_url                      as "photoUrl",
      p.name_he_source                 as "nameHeSource",
      p.name_he_confidence             as "nameHeConfidence",
      p.name_he_review_verdict         as "nameHeReviewVerdict",
      p.name_he_review_reason          as "nameHeReviewReason",
      p.name_he_reviewed_at::text      as "nameHeReviewedAt",
      p.name_he_admin_locked           as "nameHeAdminLocked"
    from public.players p
    join public.teams t on t.code = p.team_code
    where
      (
        ${verdict}::text = 'all'
        or (${verdict}::text = 'unreviewed' and p.name_he_review_verdict is null)
        or p.name_he_review_verdict = ${verdict}::text
      )
      and (${teamCode}::text is null or p.team_code = ${teamCode}::text)
    order by
      case
        when p.name_he_review_verdict = 'reject'   then 0
        when p.name_he_review_verdict = 'flag'     then 1
        when p.name_he_review_verdict is null      then 2
        when p.name_he_review_verdict = 'approved' then 3
        else 4
      end asc,
      coalesce(p.name_he_confidence, -1) asc,
      p.team_code asc,
      p.jersey_number nulls last,
      p.name_en asc
    limit ${limit}
  `);
}

export async function getPlayerReviewCounts(): Promise<{
  reject: number;
  flag: number;
  approved: number;
  unreviewed: number;
  total: number;
}> {
  const r = await execFirstRow<{
    reject: number;
    flag: number;
    approved: number;
    unreviewed: number;
    total: number;
  }>(sql`
    select
      count(*) filter (where name_he_review_verdict = 'reject')::int   as "reject",
      count(*) filter (where name_he_review_verdict = 'flag')::int     as "flag",
      count(*) filter (where name_he_review_verdict = 'approved')::int as "approved",
      count(*) filter (where name_he_review_verdict is null)::int      as "unreviewed",
      count(*)::int                                                      as "total"
    from public.players
  `);
  return {
    reject: Number(r?.reject ?? 0),
    flag: Number(r?.flag ?? 0),
    approved: Number(r?.approved ?? 0),
    unreviewed: Number(r?.unreviewed ?? 0),
    total: Number(r?.total ?? 0),
  };
}
