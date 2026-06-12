import "server-only";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { getUser } from "./supabase/auth";
import { localePath } from "./paths";
import type { Locale } from "@/app/[lang]/dictionaries";
import {
  type AdminPermissionKey,
  type AdminPermissions,
  hasAnyPermission,
  normalizePermissions,
} from "./admin-paths";

// Authorization model (since 2026-06-12):
//
//   role = 'admin'   → full access to every admin surface
//   role = 'player'  → no admin access UNLESS profiles.permissions
//                      has at least one flag set; then the user gets
//                      scoped access to the matching paths
//
//   The legacy 'live_bets_admin' enum value is no longer assigned by
//   the app (migration 0054 migrated existing rows to player+permissions).
//   The enum value still exists in Postgres; code treats it as 'player'
//   for safety.

export type AdminRole = "admin" | "live_bets_admin";

export type ProfileAccess = {
  role: "player" | "admin" | "live_bets_admin";
  permissions: AdminPermissions;
};

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

// Read the row that drives every admin gate downstream: the role + the
// normalized permission set. Centralised so callers can branch off a
// single object instead of issuing two queries.
export async function getProfileAccess(
  userId: string,
): Promise<ProfileAccess | null> {
  const [row] = await db
    .select({ role: profiles.role, permissions: profiles.permissions })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);
  if (!row) return null;
  return {
    role: row.role,
    permissions: normalizePermissions(row.permissions),
  };
}

// True when the user holds the named permission (or is a full admin).
// Use this in server actions, e.g.
//   if (!(await hasPermission(user.id, "liveBets"))) return forbidden.
export async function hasPermission(
  userId: string,
  permission: AdminPermissionKey,
): Promise<boolean> {
  const access = await getProfileAccess(userId);
  if (!access) return false;
  if (access.role === "admin") return true;
  return access.permissions[permission] === true;
}

// Page-level gate. Bounces if the user has neither full admin nor any
// scoped permission. Returns the role + permission set so the page can
// branch its rendering. The path whitelist is enforced by the admin
// layout, not here — this only ensures the caller is some kind of
// operator. See _plans/2026-06-12-live-bets-admin-role.md (revision 2).
export async function requireAdminAccess(locale: Locale) {
  const user = await getUser();
  if (!user) redirect(localePath(locale, "login"));

  const access = await getProfileAccess(user.id);
  const isFullAdmin = access?.role === "admin";
  const hasScoped = access ? hasAnyPermission(access.permissions) : false;

  if (!isFullAdmin && !hasScoped) {
    console.info("[admin gate] no access", { userId: user.id, role: access?.role });
    redirect(localePath(locale));
  }
  return { user, access: access! };
}

// Re-export the path catalog so callers don't need two imports.
export {
  PERMISSION_PATHS,
  PERMISSION_LABELS,
  ADMIN_PERMISSION_KEYS,
  isPermittedPath,
  grantedPathsFor,
  hasAnyPermission,
  normalizePermissions,
  type AdminPermissions,
  type AdminPermissionKey,
} from "./admin-paths";
