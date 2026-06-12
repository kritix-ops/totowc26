import "server-only";
import { sql } from "drizzle-orm";
import { execFirstRow, execRows } from "@/db/helpers";
import { approvedPotIlsSql } from "@/db/pot";

export type AdminUserRow = {
  id: string;
  email: string | null;
  displayName: string;
  phone: string;
  role: "player" | "live_bets_admin" | "admin";
  avatarUrl: string | null;
  createdAt: string;
  paymentId: string | null;
  paymentMethod: "bit" | "paybox" | null;
  paymentStatus: "pending" | "approved" | "rejected" | null;
  paymentSubmittedAt: string | null;
  betCount: number;
  totalPoints: number;
};

export type AdminUserStats = {
  totalUsers: number;
  approvedCount: number;
  pendingCount: number;
  unpaidCount: number;
  adminCount: number;
  potIls: number;
};

export async function fetchAdminUsers(): Promise<AdminUserRow[]> {
  // totalPoints is the user's live bank balance, computed the same way as
  // the leaderboard (starting_bank + payouts − stakes + adjustments).
  return execRows<AdminUserRow>(sql`
    select
      p.id::text                     as "id",
      u.email                        as "email",
      p.display_name                 as "displayName",
      p.phone                        as "phone",
      p.role::text                   as "role",
      p.avatar_url                   as "avatarUrl",
      p.created_at                   as "createdAt",
      pay.id::text                   as "paymentId",
      pay.method::text               as "paymentMethod",
      pay.status::text               as "paymentStatus",
      pay.submitted_at               as "paymentSubmittedAt",
      coalesce(bet_stats.bet_count, 0)::int    as "betCount",
      (
        (select starting_bank from public.settings where id = 1)::int
        + coalesce((
            select sum(coalesce(mb.points_earned, 0))::int
            from public.match_bets mb where mb.user_id = p.id
          ), 0)
        + coalesce((
            select sum(coalesce(pk.points_earned, 0) - pk.stake_paid)::int
            from public.user_custom_bet_picks pk where pk.user_id = p.id
          ), 0)
        + coalesce((select sum(pa.delta)::int
            from public.point_adjustments pa where pa.user_id = p.id), 0)
      )::int                         as "totalPoints"
    from public.profiles p
    left join auth.users u on u.id = p.id
    left join lateral (
      select id, method, status, submitted_at
      from public.payments
      where user_id = p.id
      order by submitted_at desc
      limit 1
    ) pay on true
    left join lateral (
      select count(*) as bet_count
      from public.match_bets
      where user_id = p.id
    ) bet_stats on true
    where p.is_bot = false
    order by p.created_at desc
  `);
}

export type AdminAdjustmentRow = {
  id: string;
  delta: number;
  reason: string;
  createdAt: string;
  createdByName: string;
};

// All admin point adjustments for a user, newest first.
export async function fetchUserAdjustments(
  userId: string,
): Promise<AdminAdjustmentRow[]> {
  return execRows<AdminAdjustmentRow>(sql`
    select
      pa.id::text                            as "id",
      pa.delta                               as "delta",
      pa.reason                              as "reason",
      pa.created_at                          as "createdAt",
      p.display_name                         as "createdByName"
    from public.point_adjustments pa
    join public.profiles p on p.id = pa.created_by
    where pa.user_id = ${userId}
    order by pa.created_at desc
  `);
}

// Every custom bet that's still open or locked, joined with this user's
// pick if any. Used by /admin/users/[id]/bets so an admin can see what
// the user filled in for each surface (tournament / group / stage / day
// / match) and which surfaces are still missing. Sort priority groups
// scope first (tournament → group → stage → day → match, matching the
// admin's mental ordering of "big picture → granular"), then by
// deadline within each group.
export type AdminUserBetRow = {
  betId: string;
  scope: "match" | "day" | "stage" | "group" | "tournament";
  stage:
    | "group"
    | "r32"
    | "r16"
    | "qf"
    | "sf"
    | "third_place"
    | "final"
    | null;
  groupId: string | null;
  matchId: string | null;
  matchdayId: string | null;
  questionHe: string;
  questionEn: string;
  answerType: "yes_no" | "number" | "multi_choice" | "free_text";
  answerConfig: unknown;
  stakeSnapshot: number;
  payoutSnapshot: number;
  resolvedValue: unknown | null;
  lockAt: string;
  status: "open" | "locked" | "graded";
  // Match-anchored bets carry the matchup for display. NULL for non-match
  // scopes.
  homeCode: string | null;
  awayCode: string | null;
  homeNameHe: string | null;
  homeNameEn: string | null;
  awayNameHe: string | null;
  awayNameEn: string | null;
  kickoffAt: string | null;
  // Pick: null on every column when the user hasn't filled this bet.
  pickId: string | null;
  pickAnswer: unknown | null;
  pickStakePaid: number | null;
  pickPointsEarned: number | null;
  pickWasCorrect: boolean | null;
  pickLocked: boolean | null;
};

export async function fetchUserBetsForAdmin(
  userId: string,
): Promise<AdminUserBetRow[]> {
  return execRows<AdminUserBetRow>(sql`
    select
      cb.id::text                       as "betId",
      cb.scope::text                    as "scope",
      cb.stage::text                    as "stage",
      cb.group_id                       as "groupId",
      cb.match_id::text                 as "matchId",
      cb.matchday_id::text              as "matchdayId",
      cb.question_he                    as "questionHe",
      cb.question_en                    as "questionEn",
      cb.answer_type::text              as "answerType",
      cb.answer_config                  as "answerConfig",
      cb.stake_snapshot                 as "stakeSnapshot",
      cb.payout_snapshot                as "payoutSnapshot",
      cb.resolved_value                 as "resolvedValue",
      cb.lock_at::text                  as "lockAt",
      cb.status::text                   as "status",
      m.home_team                       as "homeCode",
      m.away_team                       as "awayCode",
      ht.name_he                        as "homeNameHe",
      ht.name_en                        as "homeNameEn",
      at.name_he                        as "awayNameHe",
      at.name_en                        as "awayNameEn",
      m.kickoff_at::text                as "kickoffAt",
      pk.id::text                       as "pickId",
      pk.answer                         as "pickAnswer",
      pk.stake_paid                     as "pickStakePaid",
      pk.points_earned                  as "pickPointsEarned",
      pk.was_correct                    as "pickWasCorrect",
      pk.locked                         as "pickLocked"
    from public.custom_bets cb
    left join public.user_custom_bet_picks pk
      on pk.custom_bet_id = cb.id and pk.user_id = ${userId}
    left join public.matches m on m.id = cb.match_id
    left join public.teams ht on ht.code = m.home_team
    left join public.teams at on at.code = m.away_team
    where cb.status in ('open', 'locked', 'graded')
    order by
      case cb.scope::text
        when 'tournament' then 1
        when 'stage'      then 2
        when 'group'      then 3
        when 'day'        then 4
        when 'match'      then 5
      end asc,
      cb.lock_at asc
  `);
}

// Every scheduled match + this user's 1/X/2 score pick if any. Same
// purpose as fetchUserBetsForAdmin but for the score surface, which
// lives in match_bets rather than user_custom_bet_picks. Sorted by
// kickoff so the admin can scan chronologically.
export type AdminUserMatchPickRow = {
  matchId: string;
  kickoffAt: string;
  stage:
    | "group"
    | "r32"
    | "r16"
    | "qf"
    | "sf"
    | "third_place"
    | "final";
  groupId: string | null;
  homeCode: string;
  awayCode: string;
  homeNameHe: string;
  homeNameEn: string;
  awayNameHe: string;
  awayNameEn: string;
  homeScoreFinal: number | null;
  awayScoreFinal: number | null;
  matchStatus: string;
  pickId: string | null;
  pickHomeScore: number | null;
  pickAwayScore: number | null;
  pickPointsEarned: number | null;
  pickWasExact: boolean | null;
  pickWasCorrectOutcome: boolean | null;
  pickLocked: boolean | null;
};

export async function fetchUserMatchPicksForAdmin(
  userId: string,
): Promise<AdminUserMatchPickRow[]> {
  return execRows<AdminUserMatchPickRow>(sql`
    select
      m.id::text                          as "matchId",
      m.kickoff_at::text                  as "kickoffAt",
      m.stage::text                       as "stage",
      m.group_id                          as "groupId",
      m.home_team                         as "homeCode",
      m.away_team                         as "awayCode",
      ht.name_he                          as "homeNameHe",
      ht.name_en                          as "homeNameEn",
      at.name_he                          as "awayNameHe",
      at.name_en                          as "awayNameEn",
      m.home_score                        as "homeScoreFinal",
      m.away_score                        as "awayScoreFinal",
      m.status::text                      as "matchStatus",
      mb.id::text                         as "pickId",
      mb.home_score                       as "pickHomeScore",
      mb.away_score                       as "pickAwayScore",
      mb.points_earned                    as "pickPointsEarned",
      mb.was_exact                        as "pickWasExact",
      mb.was_correct_outcome              as "pickWasCorrectOutcome",
      mb.locked                           as "pickLocked"
    from public.matches m
    join public.teams ht on ht.code = m.home_team
    join public.teams at on at.code = m.away_team
    left join public.match_bets mb
      on mb.match_id = m.id and mb.user_id = ${userId}
    order by m.kickoff_at asc
  `);
}

// Cross-user matrix for /admin/bets-overview. ONE query returns every
// (user, custom_bet) pair where status in ('open','locked'), with the
// user's pick if any. We deliberately do this as a single SQL with
// LEFT JOIN over the cross product instead of N+1 client-side joins —
// pool size is small (tens of users × tens of bets) so the matrix
// payload is tiny.
//
// Bots are excluded so the matrix shows real humans only. Returned
// flat; the page reshapes into a sparse map<userId, map<betId, row>>
// for rendering.
export type AdminBetMatrixCell = {
  userId: string;
  userDisplayName: string;
  betId: string;
  scope: "match" | "day" | "stage" | "group" | "tournament";
  stage:
    | "group"
    | "r32"
    | "r16"
    | "qf"
    | "sf"
    | "third_place"
    | "final"
    | null;
  groupId: string | null;
  questionHe: string;
  questionEn: string;
  answerType: "yes_no" | "number" | "multi_choice" | "free_text";
  answerConfig: unknown;
  lockAt: string;
  status: "open" | "locked";
  homeCode: string | null;
  awayCode: string | null;
  pickAnswer: unknown | null;
  pickLocked: boolean | null;
};

export async function fetchAllUsersBetMatrix(): Promise<AdminBetMatrixCell[]> {
  return execRows<AdminBetMatrixCell>(sql`
    select
      p.id::text                  as "userId",
      p.display_name              as "userDisplayName",
      cb.id::text                 as "betId",
      cb.scope::text              as "scope",
      cb.stage::text              as "stage",
      cb.group_id                 as "groupId",
      cb.question_he              as "questionHe",
      cb.question_en              as "questionEn",
      cb.answer_type::text        as "answerType",
      cb.answer_config            as "answerConfig",
      cb.lock_at::text            as "lockAt",
      cb.status::text             as "status",
      m.home_team                 as "homeCode",
      m.away_team                 as "awayCode",
      pk.answer                   as "pickAnswer",
      pk.locked                   as "pickLocked"
    from public.profiles p
    cross join public.custom_bets cb
    left join public.user_custom_bet_picks pk
      on pk.user_id = p.id and pk.custom_bet_id = cb.id
    left join public.matches m on m.id = cb.match_id
    where p.is_bot = false
      and cb.status in ('open', 'locked')
    order by
      p.display_name asc,
      case cb.scope::text
        when 'tournament' then 1
        when 'stage'      then 2
        when 'group'      then 3
        when 'day'        then 4
        when 'match'      then 5
      end asc,
      cb.lock_at asc
  `);
}

export { fetchPlayerNamesById } from "@/lib/bets/players";

export type AdminUserBasic = {
  id: string;
  displayName: string;
  phone: string;
  role: "player" | "live_bets_admin" | "admin";
};

export async function fetchUserBasic(
  userId: string,
): Promise<AdminUserBasic | null> {
  return execFirstRow<AdminUserBasic>(sql`
    select
      p.id::text       as "id",
      p.display_name   as "displayName",
      p.phone          as "phone",
      p.role::text     as "role"
    from public.profiles p
    where p.id = ${userId}
    limit 1
  `);
}

export async function fetchAdminStats(): Promise<AdminUserStats> {
  const r = await execFirstRow<{
    total_users: number;
    approved_count: number;
    pending_count: number;
    unpaid_count: number;
    admin_count: number;
    pot_ils: number;
  }>(sql`
    with latest as (
      select distinct on (user_id)
        user_id, status
      from public.payments
      order by user_id, submitted_at desc
    )
    select
      (select count(*) from public.profiles where is_bot = false)::int as total_users,
      (select count(*) from latest where status = 'approved')::int as approved_count,
      (select count(*) from latest where status = 'pending')::int as pending_count,
      (select count(*) from public.profiles p
         where p.is_bot = false
           and not exists (select 1 from latest l where l.user_id = p.id))::int as unpaid_count,
      (select count(*) from public.profiles where role = 'admin')::int as admin_count,
      ${approvedPotIlsSql} as pot_ils
  `);

  return {
    totalUsers: Number(r?.total_users ?? 0),
    approvedCount: Number(r?.approved_count ?? 0),
    pendingCount: Number(r?.pending_count ?? 0),
    unpaidCount: Number(r?.unpaid_count ?? 0),
    adminCount: Number(r?.admin_count ?? 0),
    // Canonical deduped pot — same source as the home page and prize split.
    potIls: Number(r?.pot_ils ?? 0),
  };
}
