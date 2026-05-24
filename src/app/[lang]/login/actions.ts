"use server";

import { redirect } from "next/navigation";
import { getSupabaseServer } from "@/lib/supabase/server";

export type AuthResult =
  | { ok: true; redirectTo: string }
  | { ok: false; error: AuthErrorCode };

export type AuthErrorCode =
  | "invalid_email"
  | "weak_password"
  | "invalid_credentials"
  | "email_taken"
  | "rate_limit"
  | "email_not_confirmed"
  | "unknown";

function mapError(message: string | undefined): AuthErrorCode {
  if (!message) return "unknown";
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) return "invalid_credentials";
  if (m.includes("user already registered") || m.includes("already exists")) {
    return "email_taken";
  }
  if (m.includes("password should be at least") || m.includes("password is too short")) {
    return "weak_password";
  }
  if (m.includes("rate limit") || m.includes("too many")) return "rate_limit";
  if (m.includes("email not confirmed") || m.includes("not confirmed")) {
    return "email_not_confirmed";
  }
  if (m.includes("invalid email")) return "invalid_email";
  return "unknown";
}

function readCredentials(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  return { email, password };
}

export async function signIn(
  locale: "he" | "en",
  formData: FormData,
): Promise<AuthResult> {
  const { email, password } = readCredentials(formData);
  if (!email.includes("@")) return { ok: false, error: "invalid_email" };
  if (password.length < 1) return { ok: false, error: "invalid_credentials" };

  const supabase = await getSupabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, error: mapError(error.message) };
  return { ok: true, redirectTo: `/${locale}/onboarding` };
}

export async function signOutAction(locale: "he" | "en") {
  const supabase = await getSupabaseServer();
  await supabase.auth.signOut();
  redirect(`/${locale}/login`);
}
