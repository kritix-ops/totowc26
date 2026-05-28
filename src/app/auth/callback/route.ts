import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { getSupabaseAdmin, getSupabaseServer } from "@/lib/supabase/server";

// Email-link callback. Handles two flows depending on what's in the
// query string:
//
//   1) ?token_hash=...&type=...
//      Admin-generated invite / recovery / magic links. We build these
//      URLs ourselves from generateLink({}).properties.hashed_token so
//      the verification step happens server-side via verifyOtp and the
//      session lands in our cookie store. Bypasses Supabase's hosted
//      auth/v1/verify endpoint which is configured for PKCE and can't
//      satisfy the code_verifier requirement on admin-issued links.
//
//   2) ?code=...
//      Browser-initiated PKCE flow (OAuth, password reset triggered by
//      the user from /login, etc). Standard exchangeCodeForSession path.
// Reject anything that could resolve into a different origin once joined
// with our origin. Plain absolute paths starting with a single "/" are
// safe; protocol-relative "//evil.com", schemed "https://evil.com" and
// non-prefixed "evil.com" all get scrubbed back to the default.
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
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"), "/he/onboarding");

  const supabase = await getSupabaseServer();

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });
    if (!error) {
      console.info("[auth callback] verifyOtp ok", { type, next });
      return NextResponse.redirect(`${origin}${next}`);
    }
    console.error("[auth callback] verifyOtp failed", {
      type,
      message: error.message,
    });
    return NextResponse.redirect(`${origin}/he/login?error=invalid_link`);
  }

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
