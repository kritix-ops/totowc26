import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { getSupabaseServer } from "@/lib/supabase/server";

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
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/he/onboarding";

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
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      console.info("[auth callback] exchangeCodeForSession ok", { next });
      return NextResponse.redirect(`${origin}${next}`);
    }
    console.error("[auth callback] exchangeCodeForSession failed", {
      message: error.message,
    });
  }

  console.warn("[auth callback] no token_hash or code in query");
  return NextResponse.redirect(`${origin}/he/login?error=invalid_link`);
}
