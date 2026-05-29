"use server";

import { revalidatePath } from "next/cache";
import { setWhatsAppCardDismissedCookie } from "@/lib/whatsapp-dismiss";

// Persists the user's dismissal of the WhatsApp invite card. Called from
// the client close-button handlers on the dashboard and profile cards.
// Stores the *current* URL so the dismissal automatically resets when
// the admin rotates the group invite (see whatsapp-dismiss.ts).
export async function dismissWhatsAppCard(currentUrl: string): Promise<void> {
  if (!currentUrl) return;
  await setWhatsAppCardDismissedCookie(currentUrl);
  // Only the dashboard and profile render the invite card. Narrowed
  // from `revalidatePath("/", "layout")` so the close button doesn't
  // freeze the whole shell behind a transition.
  revalidatePath("/[lang]", "page");
  revalidatePath("/[lang]/profile", "page");
}
