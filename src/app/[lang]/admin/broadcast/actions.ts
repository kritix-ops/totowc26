"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { eq } from "drizzle-orm";
import { isAdmin } from "@/lib/admin";
import { getUser } from "@/lib/supabase/auth";
import {
  notifyUsers,
  type NotifyResult,
  type NotifyTarget,
} from "@/lib/notifications";

// Server action behind /admin/broadcast. Stores the announcement in
// the in-app feed for every recipient and (when push=true) fires a
// web-push to every opted-in subscription they own.
//
// Target shapes match notifyUsers' contract:
//   { kind: "user", userId }     - one person
//   { kind: "all-opted-in" }     - everyone with push_opt_in=true
//   { kind: "all-players" }      - every profile (feed-only by default
//                                  unless `push: true` is sent)

export type BroadcastTarget =
  | { kind: "user"; userId: string }
  | { kind: "all-opted-in" }
  | { kind: "all-players" };

export type BroadcastPayload = {
  title: string;
  body: string;
  url?: string;
  target: BroadcastTarget;
  push: boolean;
};

export type SendBroadcastResult =
  | { ok: true; result: NotifyResult }
  | { ok: false; error: "unauthorized" | "forbidden" | "invalid" | "db" };

export async function sendBroadcast(
  payload: BroadcastPayload,
): Promise<SendBroadcastResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauthorized" };
  if (!(await isAdmin(user.id))) return { ok: false, error: "forbidden" };

  const title = payload.title?.trim();
  const body = payload.body?.trim();
  if (!title || !body) return { ok: false, error: "invalid" };
  if (title.length > 200 || body.length > 1000) {
    return { ok: false, error: "invalid" };
  }
  const url = payload.url?.trim() || undefined;

  // Validate target shape.
  let target: NotifyTarget;
  if (payload.target.kind === "user") {
    if (!payload.target.userId || typeof payload.target.userId !== "string") {
      return { ok: false, error: "invalid" };
    }
    // Confirm the user exists; better to fail fast than insert into
    // a phantom recipient. cheap to check.
    const [exists] = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.id, payload.target.userId))
      .limit(1);
    if (!exists) return { ok: false, error: "invalid" };
    target = { kind: "user", userId: payload.target.userId };
  } else if (payload.target.kind === "all-opted-in") {
    target = { kind: "all-opted-in" };
  } else if (payload.target.kind === "all-players") {
    target = { kind: "all-players" };
  } else {
    return { ok: false, error: "invalid" };
  }

  try {
    const result = await notifyUsers(target, {
      kind: "announcement",
      title,
      body,
      url,
      push: payload.push,
      createdBy: user.id,
    });
    console.info("[admin broadcast]", {
      adminId: user.id,
      target: target.kind,
      title: title.slice(0, 50),
      ...result,
    });
    revalidatePath("/[lang]/notifications", "page");
    return { ok: true, result };
  } catch (err) {
    console.error("[admin broadcast] failed:", err);
    return { ok: false, error: "db" };
  }
}
