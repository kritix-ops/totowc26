import "server-only";
import { headers } from "next/headers";

// The proxy verifies the Supabase session once per request and forwards
// the result to server components via these request headers. Reading
// them is essentially free (no network, no DB), so server components
// branching on "signed in?" do not pay a second Supabase round-trip.
//
// Trust boundary: the proxy strips inbound copies of these headers from
// the incoming request before setting them, so a client cannot forge a
// user-id. Authorization on actual data still goes through getUser() or
// direct DB queries gated on the userId — this header is only for
// rendering decisions in the shell.
const TOTO_USER_ID_HEADER = "x-toto-user-id";
const TOTO_USER_EMAIL_HEADER = "x-toto-user-email";

export type RequestUser = {
  id: string;
  email: string | null;
};

export async function getRequestUser(): Promise<RequestUser | null> {
  const h = await headers();
  const id = h.get(TOTO_USER_ID_HEADER);
  if (!id) return null;
  const email = h.get(TOTO_USER_EMAIL_HEADER);
  return { id, email };
}

export async function getRequestUserId(): Promise<string | null> {
  const h = await headers();
  return h.get(TOTO_USER_ID_HEADER);
}
