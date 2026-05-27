import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { payments, profiles } from "@/db/schema";
import { getViewAs, type ViewAsRole } from "./view-as";

export type UserAccess = {
  isAdmin: boolean;
  isPaid: boolean;
  canEdit: boolean;
  // When non-null, this user is actually an admin currently impersonating
  // a player role for preview. UI uses it to render the "viewing as"
  // banner; server actions don't need it - `canEdit` already reflects the
  // impersonated state.
  viewingAs: ViewAsRole | null;
};

const NO_ACCESS: UserAccess = {
  isAdmin: false,
  isPaid: false,
  canEdit: false,
  viewingAs: null,
};

// Cache tag used by mutations (payment approve/reject, role change,
// onboarding completion) to invalidate this user's access. Existing
// revalidatePath("/", "layout") calls also drop the entry from the
// Data Cache, so adding revalidateTag is additive precision rather
// than required correctness.
export function accessCacheTag(userId: string): string {
  return `access:${userId}`;
}

// The DB-only base of getUserAccess: admin role + isPaid flag. Pure
// data, no cookies, so it can live in the cross-request Data Cache.
// Refreshed by revalidatePath OR an explicit revalidateTag from any
// payment/role mutation.
function getBaseAccess(userId: string) {
  const cached = unstable_cache(
    async () => {
      const [profile] = await db
        .select({ role: profiles.role })
        .from(profiles)
        .where(eq(profiles.id, userId))
        .limit(1);
      const isAdmin = profile?.role === "admin";

      const [paid] = await db
        .select({ id: payments.id })
        .from(payments)
        .where(and(eq(payments.userId, userId), eq(payments.status, "approved")))
        .limit(1);
      const isPaid = !!paid;
      return { isAdmin, isPaid };
    },
    ["base-access", userId],
    { tags: [accessCacheTag(userId)], revalidate: 300 },
  );
  return cached();
}

// Single source of truth for "can this user perform mutating actions?".
// Admins always can; players need an approved payment row. Cached per
// request so the per-action gate is free after the first call.
//
// Impersonation: if the caller is an admin AND the view-as cookie is set,
// we return the IMPERSONATED access shape. The real-admin role is hidden
// (isAdmin=false) so server actions go through the player path - that's
// the whole point of the preview.
//
// The base (role + isPaid) is read from the cross-request Data Cache
// via getBaseAccess; the cookie part runs every time because cookies
// are request-scoped and not cacheable.
export const getUserAccess = cache(async (userId: string | null | undefined): Promise<UserAccess> => {
  if (!userId) return NO_ACCESS;

  const { isAdmin, isPaid } = await getBaseAccess(userId);

  if (isAdmin) {
    const view = await getViewAs();
    if (view === "paid") {
      return { isAdmin: false, isPaid: true, canEdit: true, viewingAs: "paid" };
    }
    if (view === "unpaid") {
      return { isAdmin: false, isPaid: false, canEdit: false, viewingAs: "unpaid" };
    }
  }

  return { isAdmin, isPaid, canEdit: isAdmin || isPaid, viewingAs: null };
});
