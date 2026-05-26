import "server-only";
import { cookies } from "next/headers";

// Admin-only impersonation cookie. When set, an admin sees the app as
// if they were a regular player in the chosen payment state. The cookie
// is consulted by `getUserAccess`, which is the single source of truth
// the gate and every form pulls from.
//
// Safety: this cookie ONLY downgrades an admin's access. A non-admin
// setting it (via devtools, browser extension, etc.) gains nothing -
// `getUserAccess` requires admin role before honoring it. There is no
// path through this cookie that grants extra privileges.

export const VIEW_AS_COOKIE = "toto_view_as";

export type ViewAsRole = "paid" | "unpaid";

const VALID: ViewAsRole[] = ["paid", "unpaid"];

function isViewAsRole(v: unknown): v is ViewAsRole {
  return typeof v === "string" && VALID.includes(v as ViewAsRole);
}

// Returns the active impersonation, or null when the admin is themselves.
// Cookie reads can fail in static contexts; we treat any error as "no
// impersonation" so the admin sees their normal admin view instead of a
// surprise gate.
export async function getViewAs(): Promise<ViewAsRole | null> {
  try {
    const jar = await cookies();
    const raw = jar.get(VIEW_AS_COOKIE)?.value;
    return isViewAsRole(raw) ? raw : null;
  } catch {
    return null;
  }
}
