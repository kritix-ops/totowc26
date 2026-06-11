import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { getSupabaseAdmin, getSupabaseServer } from "@/lib/supabase/server";

// OAuth (PKCE) callback. Handles ?code=... coming back from Google sign-in.
// The browser is the user's actual browser at this point (Google does not
// prefetch the redirect), so it is safe to consume the code on the GET.
//
// Admin-generated email links (recovery / invite / magiclink) DO NOT come
// here. They route through /auth/confirm, which renders a button and only
// calls verifyOtp on the explicit POST. The token there is single-use and
// would otherwise be burned by WhatsApp / iMessage / Slack / Gmail link-
// preview crawlers that fetch every shared URL up front. See
// src/lib/supabase/auth.ts → buildAuthConfirmUrl for the why.
//
// A legacy /auth/callback?token_hash=... link from before the split now
// redirects to /auth/confirm so old in-flight messages still work.
function safeNext(value: string | null, fallback: string): string {
  if (!value) return fallback;
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//")) return fallback;
  if (value.startsWith("/\\")) return fallback;
  return value;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"), "/he/onboarding");

  // Legacy redirect: pre-existing links built against /auth/callback still
  // resolve. We forward to /auth/confirm so the token isn't burned by a
  // preview bot on this GET.
  if (tokenHash && type) {
    const target = new URL(`${origin}/auth/confirm`);
    target.searchParams.set("token_hash", tokenHash);
    target.searchParams.set("type", type);
    target.searchParams.set("next", next);
    return NextResponse.redirect(target.toString());
  }

  const supabase = await getSupabaseServer();

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error("[auth callback] exchangeCodeForSession failed", {
        message: error.message,
      });
      return NextResponse.redirect(`${origin}/he/login?error=invalid_link`);
    }

    // OAuth lets anyone with a Google account hit this endpoint - the
    // pool gate lives here. Only users that already have a profile row
    // (i.e. an approved signup_request that the admin created the auth
    // user for) get a session. Everyone else gets bounced to /signup
    // with their Google identity prefilled so the admin can decide.
    const userId = data.user?.id;
    if (userId) {
      const [profile] = await db
        .select({ id: profiles.id })
        .from(profiles)
        .where(eq(profiles.id, userId))
        .limit(1);

      if (!profile) {
        const email = data.user?.email ?? "";
        const name =
          (data.user?.user_metadata?.full_name as string | undefined) ??
          (data.user?.user_metadata?.name as string | undefined) ??
          "";
        console.warn("[auth callback] oauth user has no profile, bouncing", {
          userId,
          email,
        });

        // Sign the user out of our cookie store and try to remove the
        // auth.users row so a later admin approval can recreate it
        // cleanly. Delete is best-effort: if it fails the approval flow
        // still works because approveSignupRequest reuses an existing
        // auth user by id.
        await supabase.auth.signOut();
        try {
          await getSupabaseAdmin().auth.admin.deleteUser(userId);
        } catch (err) {
          console.error("[auth callback] failed to clean up oauth user", err);
        }

        const url = new URL(`${origin}/he/signup`);
        if (email) url.searchParams.set("email", email);
        if (name) url.searchParams.set("name", name);
        url.searchParams.set("source", "google");
        return NextResponse.redirect(url.toString());
      }
    }

    console.info("[auth callback] exchangeCodeForSession ok", { next });
    return NextResponse.redirect(`${origin}${next}`);
  }

  console.warn("[auth callback] no token_hash or code in query");
  return NextResponse.redirect(`${origin}/he/login?error=invalid_link`);
}
