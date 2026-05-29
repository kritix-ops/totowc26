"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { getUser } from "@/lib/supabase/auth";
import { isAdmin } from "@/lib/admin";

export type SetPublicSignupOpenResult =
  | { ok: true }
  | { ok: false; error: "unauth" | "forbidden" | "db" };

export async function setPublicSignupOpen(
  open: boolean,
): Promise<SetPublicSignupOpenResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauth" };
  if (!(await isAdmin(user.id))) {
    console.warn("[public-signup denied]", { userId: user.id });
    return { ok: false, error: "forbidden" };
  }

  try {
    await db
      .update(settings)
      .set({ publicSignupOpen: open, updatedAt: new Date() })
      .where(eq(settings.id, 1));
    console.info("[public-signup toggled]", { userId: user.id, open });
    // Signup page + admin panel both gate on this flag.
    revalidatePath("/[lang]/signup", "page");
    revalidatePath("/[lang]/admin", "page");
    return { ok: true };
  } catch (err) {
    console.error("setPublicSignupOpen failed:", err);
    return { ok: false, error: "db" };
  }
}
