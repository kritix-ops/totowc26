import "server-only";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { getUser } from "./supabase/auth";
import { localePath } from "./paths";
import type { Locale } from "@/app/[lang]/dictionaries";

export async function requireAdmin(locale: Locale) {
  const user = await getUser();
  if (!user) redirect(localePath(locale, "login"));

  const [profile] = await db
    .select({ role: profiles.role })
    .from(profiles)
    .where(eq(profiles.id, user.id))
    .limit(1);

  if (!profile || profile.role !== "admin") {
    redirect(localePath(locale));
  }
  return { user, profile };
}
