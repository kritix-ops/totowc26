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
