"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getUser } from "@/lib/supabase/auth";
import { isAdmin } from "@/lib/admin";
import { VIEW_AS_COOKIE, type ViewAsRole } from "@/lib/view-as";

export type SetViewAsResult =
  | { ok: true }
  | { ok: false; error: "unauth" | "forbidden" };

// Cookie tuned for a single browser session: not httpOnly so the client
// could in theory read it (we don't need that), 1-day max so it doesn't
// linger forever, sameSite Lax so it survives normal navigation.
const COOKIE_BASE = {
  path: "/",
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge: 60 * 60 * 24, // 1 day
};

export async function setViewAs(role: ViewAsRole): Promise<SetViewAsResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauth" };
  if (!(await isAdmin(user.id))) {
    console.warn("[view-as denied]", { userId: user.id, attempted: role });
    return { ok: false, error: "forbidden" };
  }
  const jar = await cookies();
  jar.set(VIEW_AS_COOKIE, role, COOKIE_BASE);
  console.info("[view-as set]", { userId: user.id, role });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function clearViewAs(): Promise<SetViewAsResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauth" };
  // Non-admins shouldn't be able to set it, but clearing is harmless. Still
  // gate so the log line means something.
  if (!(await isAdmin(user.id))) {
    return { ok: false, error: "forbidden" };
  }
  const jar = await cookies();
  jar.delete(VIEW_AS_COOKIE);
  console.info("[view-as cleared]", { userId: user.id });
  revalidatePath("/", "layout");
  return { ok: true };
}
