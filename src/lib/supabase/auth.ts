import "server-only";
import { cache } from "react";
import { getSupabaseServer } from "./server";

export const getUser = cache(async () => {
  const supabase = await getSupabaseServer();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
});

export const getSession = cache(async () => {
  const supabase = await getSupabaseServer();
  const { data } = await supabase.auth.getSession();
  return data.session;
});

// Build a callback URL that routes the user through our own /auth/callback
// instead of Supabase's hosted verify endpoint. The callback hands the
// hashed token to verifyOtp server-side and writes the session into our
// cookie store so /set-password (and any other guarded route in `next`)
// sees an authenticated user.
export function buildInviteCallbackUrl({
  origin,
  hashedToken,
  type,
  next,
}: {
  origin: string;
  hashedToken: string;
  type: "recovery" | "invite" | "magiclink";
  next: string;
}): string {
  const u = new URL(`${origin}/auth/callback`);
  u.searchParams.set("token_hash", hashedToken);
  u.searchParams.set("type", type);
  u.searchParams.set("next", next);
  return u.toString();
}
