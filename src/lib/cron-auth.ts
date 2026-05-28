import "server-only";
import type { NextRequest } from "next/server";

// Vercel sends `Authorization: Bearer ${CRON_SECRET}` on every cron
// firing. Header-only check: we used to accept `?secret=` for browser-
// triggered runs but that leaked the secret into access logs and the
// URL bar history. Shared by every /api/cron/* route so the auth shape
// stays in lock-step across them.
export function isAuthorizedCron(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return request.headers.get("authorization") === `Bearer ${expected}`;
}
