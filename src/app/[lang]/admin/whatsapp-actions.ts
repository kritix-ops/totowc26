"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { getUser } from "@/lib/supabase/auth";
import { isAdmin } from "@/lib/admin";

export type SetWhatsAppGroupUrlResult =
  | { ok: true }
  | { ok: false; error: "unauth" | "forbidden" | "invalid" | "db" };

// Accepts http(s) URLs only; empty string clears the override so the
// profile card hides. Tightened to require a chat.whatsapp.com host so
// a typo can't ship a non-WhatsApp link to every player.
function normalize(url: string): string | null | "invalid" {
  const trimmed = url.trim();
  if (trimmed === "") return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "invalid";
    }
    if (!parsed.hostname.toLowerCase().endsWith("whatsapp.com")) {
      return "invalid";
    }
    return parsed.toString();
  } catch {
    return "invalid";
  }
}

export async function setWhatsAppGroupUrl(
  url: string,
): Promise<SetWhatsAppGroupUrlResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauth" };
  if (!(await isAdmin(user.id))) {
    console.warn("[whatsapp-url denied]", { userId: user.id });
    return { ok: false, error: "forbidden" };
  }

  const next = normalize(url);
  if (next === "invalid") return { ok: false, error: "invalid" };

  try {
    await db
      .update(settings)
      .set({ whatsappGroupUrl: next, updatedAt: new Date() })
      .where(eq(settings.id, 1));
    console.info("[whatsapp-url set]", {
      userId: user.id,
      cleared: next === null,
    });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    console.error("setWhatsAppGroupUrl failed:", err);
    return { ok: false, error: "db" };
  }
}
