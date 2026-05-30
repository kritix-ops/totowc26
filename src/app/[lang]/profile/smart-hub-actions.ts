"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { getUser } from "@/lib/supabase/auth";

// Server actions backing the three Smart-Reminders toggles on the
// profile page. They flip per-user flags only - no browser-side work
// like the push-opt-in flow has - so they share one small file.
//
// See _plans/2026-05-30-smart-reminders.md §3.5.

export type SetSmartFlagResult =
  | { ok: true }
  | { ok: false; error: "unauthorized" | "db" };

// Update one of the three Smart-Reminders flags for the signed-in user.
// `flag` is a discriminator we map to the column server-side so a
// tampered request body cannot poke at columns outside the allowlist.
export async function setSmartFlag(
  flag: "smart_hub_enabled" | "push_lock_reminders" | "push_duel_received",
  value: boolean,
): Promise<SetSmartFlagResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauthorized" };
  try {
    const set =
      flag === "smart_hub_enabled"
        ? { smartHubEnabled: value }
        : flag === "push_lock_reminders"
          ? { pushLockReminders: value }
          : { pushDuelReceived: value };
    await db.update(profiles).set(set).where(eq(profiles.id, user.id));
    console.info("[smart flag updated]", {
      userId: user.id,
      flag,
      value,
    });
    revalidatePath("/[lang]/profile", "page");
    // Smart Hub on the dashboard reads smart_hub_enabled; invalidate
    // the home page too so the next render reflects the new state.
    revalidatePath("/[lang]", "page");
    return { ok: true };
  } catch (err) {
    console.error("[smart flag update failed]", { userId: user.id, flag, err });
    return { ok: false, error: "db" };
  }
}
