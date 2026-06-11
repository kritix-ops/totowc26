import "server-only";
import { cache } from "react";
import { getSupabaseServer } from "./server";

export const getUser = cache(async () => {
  const supabase = await getSupabaseServer();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
});

export { buildAuthConfirmUrl } from "./confirm-url";
