"use server";

import { getSupabaseServer } from "@/lib/supabase/server";

export type SetPasswordResult =
  | { ok: true; redirectTo: string }
  | { ok: false; error: "weak" | "mismatch" | "unauth" | "unknown" };

export async function setPasswordAction(
  locale: "he" | "en",
  formData: FormData,
): Promise<SetPasswordResult> {
  const pw = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (pw.length < 6) return { ok: false, error: "weak" };
  if (pw !== confirm) return { ok: false, error: "mismatch" };

  const supabase = await getSupabaseServer();
  const { error } = await supabase.auth.updateUser({ password: pw });
  if (error) {
    if (error.message.toLowerCase().includes("auth")) {
      return { ok: false, error: "unauth" };
    }
    return { ok: false, error: "unknown" };
  }
  return { ok: true, redirectTo: `/${locale}/onboarding` };
}
