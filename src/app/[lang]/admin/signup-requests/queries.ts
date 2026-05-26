import "server-only";
import { eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { signupRequests, profiles } from "@/db/schema";

export type SignupRequestRow = {
  id: string;
  displayName: string;
  phone: string;
  email: string;
  status: "pending" | "approved" | "rejected";
  createdAt: Date;
  decidedAt: Date | null;
  decidedBy: string | null;
  decidedByName: string | null;
  note: string | null;
  createdUserId: string | null;
};

export async function fetchSignupRequests(
  filter: "pending" | "approved" | "rejected" | "all",
): Promise<SignupRequestRow[]> {
  const decider = profiles;
  const base = db
    .select({
      id: signupRequests.id,
      displayName: signupRequests.displayName,
      phone: signupRequests.phone,
      email: signupRequests.email,
      status: signupRequests.status,
      createdAt: signupRequests.createdAt,
      decidedAt: signupRequests.decidedAt,
      decidedBy: signupRequests.decidedBy,
      decidedByName: decider.displayName,
      note: signupRequests.note,
      createdUserId: signupRequests.createdUserId,
    })
    .from(signupRequests)
    .leftJoin(decider, eq(decider.id, signupRequests.decidedBy));

  const rows =
    filter === "all"
      ? await base.orderBy(desc(signupRequests.createdAt)).limit(200)
      : await base
          .where(eq(signupRequests.status, filter))
          .orderBy(desc(signupRequests.createdAt))
          .limit(200);

  return rows;
}

export async function countPendingSignups(): Promise<number> {
  const rows = await db
    .select({ id: signupRequests.id })
    .from(signupRequests)
    .where(eq(signupRequests.status, "pending"));
  return rows.length;
}
