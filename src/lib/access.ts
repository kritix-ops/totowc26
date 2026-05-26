import "server-only";
import { cache } from "react";
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

// Single source of truth for "can this user perform mutating actions?".
// Admins always can; players need an approved payment row. Cached per
// request so the per-action gate is free after the first call.
//
// Impersonation: if the caller is an admin AND the view-as cookie is set,
// we return the IMPERSONATED access shape. The real-admin role is hidden
// (isAdmin=false) so server actions go through the player path - that's
// the whole point of the preview.
export const getUserAccess = cache(async (userId: string | null | undefined): Promise<UserAccess> => {
  if (!userId) return NO_ACCESS;

  const [profile] = await db
    .select({ role: profiles.role })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);

  const isAdmin = profile?.role === "admin";

  if (isAdmin) {
    const view = await getViewAs();
    if (view === "paid") {
      return { isAdmin: false, isPaid: true, canEdit: true, viewingAs: "paid" };
    }
    if (view === "unpaid") {
      return { isAdmin: false, isPaid: false, canEdit: false, viewingAs: "unpaid" };
    }
  }

  const [paid] = await db
    .select({ id: payments.id })
    .from(payments)
    .where(and(eq(payments.userId, userId), eq(payments.status, "approved")))
    .limit(1);

  const isPaid = !!paid;
  return { isAdmin, isPaid, canEdit: isAdmin || isPaid, viewingAs: null };
});
