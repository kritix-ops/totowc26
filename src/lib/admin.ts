import "server-only";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { getUser } from "./supabase/auth";
import { localePath } from "./paths";
import type { Locale } from "@/app/[lang]/dictionaries";

// Role hierarchy (least → most privileged):
//   player           — regular participant
//   live_bets_admin  — scoped admin: live bets + matchday suggestions +
//                      bets-overview + per-match deadlines, nothing else
//   admin            — full admin
//
// requireAdmin / isAdmin gate the FULL admin surface (strict). The
// live-bets pair (requireLiveBetsAdmin / isLiveBetsAdmin) accepts either
// 'admin' or 'live_bets_admin'. A regular admin is always also a
// live-bets admin (superset). See _plans/2026-06-12-live-bets-admin-role.md.

export type AdminRole = "admin" | "live_bets_admin";

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

export async function isAdmin(userId: string): Promise<boolean> {
  const [profile] = await db
    .select({ role: profiles.role })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);
  return profile?.role === "admin";
}

// Gate for the live-bets admin surface. Lets `admin` and `live_bets_admin`
// through; bounces `player` (and unauthenticated users) home. The caller
// site (page or server action) should still consult LIVE_BETS_ADMIN_PATHS
// or a domain-specific predicate to keep live-bets admins out of pages
// they shouldn't reach — this helper only enforces the role floor.
export async function requireLiveBetsAdmin(locale: Locale) {
  const user = await getUser();
  if (!user) redirect(localePath(locale, "login"));

  const [profile] = await db
    .select({ role: profiles.role })
    .from(profiles)
    .where(eq(profiles.id, user.id))
    .limit(1);

  if (
    !profile ||
    (profile.role !== "admin" && profile.role !== "live_bets_admin")
  ) {
    console.info("[live-bets gate] denied", { userId: user.id, role: profile?.role });
    redirect(localePath(locale));
  }
  return { user, profile: profile as { role: AdminRole } };
}

export async function isLiveBetsAdmin(userId: string): Promise<boolean> {
  const [profile] = await db
    .select({ role: profiles.role })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);
  return profile?.role === "admin" || profile?.role === "live_bets_admin";
}

// Whitelist constants live in admin-paths.ts (no server-only / no
// Supabase) so they can be unit-tested without an env-loaded runtime.
export { LIVE_BETS_ADMIN_PATHS, isLiveBetsAdminPath } from "./admin-paths";
