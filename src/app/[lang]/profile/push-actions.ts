"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { getUser } from "@/lib/supabase/auth";

// Server action backing the profile-page push toggle. The browser-side
// permission request + pushManager.subscribe() happen client-side in
// PushOptInToggle; this action just flips the persisted preference
// (profiles.push_opt_in) AFTER those succeed. See
// _plans/2026-05-28-lock-reminders.md §5.

export type SetPushOptInResult =
  | { ok: true }
  | { ok: false; error: "unauthorized" | "db" };

export async function setPushOptIn(value: boolean): Promise<SetPushOptInResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauthorized" };
  try {
    await db
      .update(profiles)
      .set({ pushOptIn: value })
      .where(eq(profiles.id, user.id));
    console.info("[push opt-in]", { userId: user.id, value });
    revalidatePath("/[lang]/profile", "page");
    return { ok: true };
  } catch (err) {
    console.error("[push opt-in failed]", { userId: user.id, err });
    return { ok: false, error: "db" };
  }
}
