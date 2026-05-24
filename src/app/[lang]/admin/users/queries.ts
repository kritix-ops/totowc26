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
      coalesce(bet_stats.total_points, 0)::int as "totalPoints"
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
      select
        count(*)                                  as bet_count,
        coalesce(sum(points_earned), 0)           as total_points
      from public.match_bets
      where user_id = p.id
    ) bet_stats on true
    order by p.created_at desc
  `);

  return rows as unknown as AdminUserRow[];
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
