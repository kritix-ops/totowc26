import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";

export type AdminUserRow = {
  id: string;
  email: string | null;
  displayName: string;
  phone: string;
  role: "player" | "admin";
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
  const rows = await db.execute<AdminUserRow>(sql`
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
            select sum(
              coalesce(mb.points_earned,      0) +
              coalesce(mb.points_btts,        0) +
              coalesce(mb.points_over_25,     0) +
              coalesce(mb.points_ht,          0) -
              coalesce(mb.stake_paid_btts,    0) -
              coalesce(mb.stake_paid_over_25, 0) -
              coalesce(mb.stake_paid_ht,      0)
            )::int from public.match_bets mb where mb.user_id = p.id
          ), 0)
        + coalesce((select sum(coalesce(gp.points_earned, 0) - gp.stake_paid)::int
            from public.group_predictions gp where gp.user_id = p.id), 0)
        + coalesce((select sum(coalesce(bp.points_earned, 0) - bp.stake_paid)::int
            from public.bracket_predictions bp where bp.user_id = p.id), 0)
        + coalesce((select sum(coalesce(sb.points_earned, 0) - sb.stake_paid)::int
            from public.special_bets sb where sb.user_id = p.id), 0)
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
    order by p.created_at desc
  `);

  return rows as unknown as AdminUserRow[];
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
  const rows = await db.execute<AdminAdjustmentRow>(sql`
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
  return rows as unknown as AdminAdjustmentRow[];
}

export type AdminUserBasic = {
  id: string;
  displayName: string;
  phone: string;
  role: "player" | "admin";
};

export async function fetchUserBasic(
  userId: string,
): Promise<AdminUserBasic | null> {
  const rows = await db.execute<AdminUserBasic>(sql`
    select
      p.id::text       as "id",
      p.display_name   as "displayName",
      p.phone          as "phone",
      p.role::text     as "role"
    from public.profiles p
    where p.id = ${userId}
    limit 1
  `);
  const list = rows as unknown as AdminUserBasic[];
  return list[0] ?? null;
}

export async function fetchAdminStats(entryFee: number): Promise<AdminUserStats> {
  const result = await db.execute<{
    total_users: number;
    approved_count: number;
    pending_count: number;
    unpaid_count: number;
    admin_count: number;
  }>(sql`
    with latest as (
      select distinct on (user_id)
        user_id, status
      from public.payments
      order by user_id, submitted_at desc
    )
    select
      (select count(*) from public.profiles)::int as total_users,
      (select count(*) from latest where status = 'approved')::int as approved_count,
      (select count(*) from latest where status = 'pending')::int as pending_count,
      (select count(*) from public.profiles p
         where not exists (select 1 from latest l where l.user_id = p.id))::int as unpaid_count,
      (select count(*) from public.profiles where role = 'admin')::int as admin_count
  `);
  const r = (result as unknown as Array<{
    total_users: number;
    approved_count: number;
    pending_count: number;
    unpaid_count: number;
    admin_count: number;
  }>)[0];

  return {
    totalUsers: Number(r.total_users),
    approvedCount: Number(r.approved_count),
    pendingCount: Number(r.pending_count),
    unpaidCount: Number(r.unpaid_count),
    adminCount: Number(r.admin_count),
    potIls: Number(r.approved_count) * entryFee,
  };
}
