"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { getUser } from "@/lib/supabase/auth";
import { isAdmin } from "@/lib/admin";

export type SetPayboxUrlResult =
  | { ok: true }
  | { ok: false; error: "unauth" | "forbidden" | "invalid" | "db" };

// Accepts http(s) URLs only. Empty string clears the override so the UI
// reverts to the marketing-page fallback. Anything else is rejected so a
// typo doesn't silently break the "Open Paybox" button.
function normalize(url: string): string | null | "invalid" {
  const trimmed = url.trim();
  if (trimmed === "") return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "invalid";
    }
    return parsed.toString();
  } catch {
    return "invalid";
  }
}

export async function setPayboxUrl(url: string): Promise<SetPayboxUrlResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauth" };
  if (!(await isAdmin(user.id))) {
    console.warn("[paybox-url denied]", { userId: user.id });
    return { ok: false, error: "forbidden" };
  }

  const next = normalize(url);
  if (next === "invalid") return { ok: false, error: "invalid" };

  try {
    await db
      .update(settings)
      .set({ payboxUrl: next, updatedAt: new Date() })
      .where(eq(settings.id, 1));
    console.info("[paybox-url set]", {
      userId: user.id,
      cleared: next === null,
    });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    console.error("setPayboxUrl failed:", err);
    return { ok: false, error: "db" };
  }
}
