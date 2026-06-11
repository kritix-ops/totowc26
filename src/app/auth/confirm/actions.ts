"use server";

import { redirect } from "next/navigation";
import type { EmailOtpType } from "@supabase/supabase-js";
import { getSupabaseServer } from "@/lib/supabase/server";

// Server action invoked by the Continue button on /auth/confirm. This is
// the only place that actually consumes the one-time token, and only as
// a POST. Link-preview crawlers that GET the page never reach this code.
//
// We accept token_hash + type via the form payload (the page round-trips
// them from the URL into hidden inputs). On success we set the Supabase
// session cookies and navigate to `next`. On failure we send the user to
// /login with a localised error code so they can ask the admin for a new
// link instead of staring at a blank page.
export async function confirmAuthAction(formData: FormData): Promise<void> {
  const tokenHash = String(formData.get("token_hash") ?? "");
  const type = String(formData.get("type") ?? "") as EmailOtpType;
  const nextRaw = String(formData.get("next") ?? "/he/onboarding");

  // Same safeNext rules as the old callback: only allow absolute same-
  // origin paths so a hostile share can't redirect into another site.
  const next = safeNext(nextRaw, "/he/onboarding");

  if (!tokenHash || !type) {
    console.warn("[auth confirm] missing token_hash or type on POST", {
      hasTokenHash: !!tokenHash,
      hasType: !!type,
    });
    redirect("/he/login?error=invalid_link");
  }

  const supabase = await getSupabaseServer();
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type,
  });

  if (error) {
    console.error("[auth confirm] verifyOtp failed", {
      type,
      message: error.message,
    });
    redirect("/he/login?error=invalid_link");
  }

  console.info("[auth confirm] verifyOtp ok", { type, next });
  redirect(next);
}

function safeNext(value: string | null, fallback: string): string {
  if (!value) return fallback;
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//")) return fallback;
  if (value.startsWith("/\\")) return fallback;
  return value;
}
