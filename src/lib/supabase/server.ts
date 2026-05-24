import "server-only";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !anonKey) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local",
  );
}

// For server components, route handlers, and server actions.
export async function getSupabaseServer() {
  const store = await cookies();
  return createServerClient(url!, anonKey!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (toSet) => {
        try {
          toSet.forEach(({ name, value, options }) =>
            store.set(name, value, options as CookieOptions),
          );
        } catch {
          // Called from a Server Component, where we cannot mutate cookies.
          // Token refresh will happen on the next response via proxy.
        }
      },
    },
  });
}

// Service-role client, server-only, bypasses RLS. Use sparingly.
export function getSupabaseAdmin() {
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!serviceKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SECRET_KEY is not set in .env.local",
    );
  }
  return createServerClient(url!, serviceKey, {
    cookies: { getAll: () => [], setAll: () => {} },
  });
}
