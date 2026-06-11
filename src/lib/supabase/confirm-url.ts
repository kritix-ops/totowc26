// Build a confirm URL the admin shares with the invitee. It routes through
// our own /auth/confirm page, NOT Supabase's hosted verify endpoint and
// NOT a GET-time verify. The page renders a "Continue" button and only
// calls verifyOtp on the explicit POST from that button.
//
// Why: WhatsApp, iMessage, Slack, Gmail and most email clients fetch every
// shared URL up front to build a link preview. The Supabase recovery /
// invite token is single-use. A previous version of this code called
// verifyOtp on the initial GET, which meant the preview bot burned the
// token before the human ever clicked, and every link surfaced as
// "expired" to the user. Splitting verification onto an explicit POST
// makes the GET a no-op for bots so the token survives until the human
// actually taps Continue.
//
// Kept in a standalone module (no "server-only" import, no Supabase server
// client import) so it stays unit-testable in vitest without env wiring.
export function buildAuthConfirmUrl({
  origin,
  hashedToken,
  type,
  next,
}: {
  origin: string;
  hashedToken: string;
  type: "recovery" | "invite" | "magiclink";
  next: string;
}): string {
  const u = new URL(`${origin}/auth/confirm`);
  u.searchParams.set("token_hash", hashedToken);
  u.searchParams.set("type", type);
  u.searchParams.set("next", next);
  return u.toString();
}
