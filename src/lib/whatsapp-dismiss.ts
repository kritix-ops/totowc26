import "server-only";
import { cookies } from "next/headers";

// Per-device dismissal of the WhatsApp invite card. Stored as a plain
// cookie so the server can hide the card on first paint (no flash) and
// every render can re-check the state without a DB call. A 1-year TTL
// matches typical "I dismissed this UI hint, don't show it again" UX.
//
// Cookie value is the URL itself (not just "1") so when the admin
// rotates the group invite, the dismissal automatically resets and the
// new card shows up - users shouldn't be locked out of an updated link
// by an old dismissal.

const COOKIE_NAME = "tm_whatsapp_card_dismissed";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export async function isWhatsAppCardDismissed(currentUrl: string | null): Promise<boolean> {
  if (!currentUrl) return false;
  const c = await cookies();
  return c.get(COOKIE_NAME)?.value === currentUrl;
}

export async function setWhatsAppCardDismissedCookie(currentUrl: string): Promise<void> {
  const c = await cookies();
  c.set(COOKIE_NAME, currentUrl, {
    maxAge: ONE_YEAR_SECONDS,
    sameSite: "lax",
    path: "/",
  });
}
